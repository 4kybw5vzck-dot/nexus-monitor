"""Benutzerverwaltung (Administratoren) und eigenes Passwort ändern (alle)."""

from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from . import models as m
from . import schemas as s
from .auth import current_user, require_roles, user_to_api
from .db import get_db
from .security import MIN_PASSWORD_LENGTH, hash_password, token_hash, verify_password

router = APIRouter(prefix="/api", tags=["Benutzer"])
admin_only = require_roles("Administrator")

_LOGIN_RE = re.compile(r"^[A-Za-z0-9._@-]{2,100}$")


def _check_password(pw: str) -> None:
    if len(pw) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Passwort zu kurz (mindestens {MIN_PASSWORD_LENGTH} Zeichen)")


def _end_sessions(db: Session, user_id: str, keep_hash: str | None = None) -> None:
    q = delete(m.AuthSession).where(m.AuthSession.user_id == user_id)
    if keep_hash:
        q = q.where(m.AuthSession.token_hash != keep_hash)
    db.execute(q)


def _active_admins(db: Session) -> int:
    return db.scalar(
        select(func.count()).select_from(m.User).where(
            m.User.role == "Administrator", m.User.active.is_(True), m.User.password_hash.is_not(None)
        )
    ) or 0


def _would_remove_last_admin(db: Session, user: m.User) -> bool:
    is_effective_admin = user.role == "Administrator" and user.active and user.password_hash is not None
    return is_effective_admin and _active_admins(db) <= 1


def _get(db: Session, user_id: str) -> m.User:
    user = db.get(m.User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Benutzer nicht gefunden")
    return user


@router.post("/users", response_model=s.User, status_code=status.HTTP_201_CREATED, dependencies=[Depends(admin_only)])
def create_user(body: s.UserCreate, db: Session = Depends(get_db)):
    login = body.login.strip()
    if not _LOGIN_RE.match(login):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Anmeldename: 2–100 Zeichen, nur Buchstaben, Ziffern und . _ @ -")
    if db.scalar(select(m.User).where(func.lower(m.User.login) == login.lower())):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Anmeldename „{login}“ ist bereits vergeben")
    if body.password:
        _check_password(body.password)
    user = m.User(
        id=f"usr-{uuid.uuid4().hex[:12]}", login=login, name=body.name.strip(), email=body.email.strip(),
        role=body.role, active=body.active, password_hash=hash_password(body.password) if body.password else None,
    )
    db.add(user)
    db.commit()
    return user_to_api(user)


@router.patch("/users/{user_id}", response_model=s.User)
def update_user(user_id: str, body: s.UserUpdate, db: Session = Depends(get_db), me: m.User = Depends(admin_only)):
    user = _get(db, user_id)
    demote = body.role is not None and body.role != "Administrator"
    deactivate = body.active is False
    if (demote or deactivate) and _would_remove_last_admin(db, user):
        raise HTTPException(status.HTTP_409_CONFLICT, "Der letzte aktive Administrator kann nicht herabgestuft oder deaktiviert werden")
    if user.id == me.id and deactivate:
        raise HTTPException(status.HTTP_409_CONFLICT, "Das eigene Konto kann nicht deaktiviert werden")
    if user.id == me.id and demote:
        raise HTTPException(status.HTTP_409_CONFLICT, "Die eigene Rolle kann nicht herabgestuft werden")
    if body.name is not None:
        user.name = body.name.strip()
    if body.email is not None:
        user.email = body.email.strip()
    if body.role is not None:
        user.role = body.role
    if body.active is not None:
        user.active = body.active
        if not body.active:
            _end_sessions(db, user.id)
    db.commit()
    return user_to_api(user)


@router.post("/users/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(admin_only)])
def set_user_password(user_id: str, body: s.PasswordSet, db: Session = Depends(get_db)):
    user = _get(db, user_id)
    _check_password(body.password)
    user.password_hash = hash_password(body.password)
    _end_sessions(db, user.id)
    db.commit()


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: str, db: Session = Depends(get_db), me: m.User = Depends(admin_only)):
    user = _get(db, user_id)
    if user.id == me.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Das eigene Konto kann nicht gelöscht werden")
    if _would_remove_last_admin(db, user):
        raise HTTPException(status.HTTP_409_CONFLICT, "Der letzte aktive Administrator kann nicht gelöscht werden")
    db.delete(user)
    db.commit()


@router.post("/auth/password", status_code=status.HTTP_204_NO_CONTENT)
def change_own_password(
    body: s.PasswordChange,
    authorization: str = Header(),
    db: Session = Depends(get_db),
    me: m.User = Depends(current_user),
):
    """Eigenes Passwort ändern. Andere Sitzungen des Benutzers werden beendet, die aktuelle bleibt."""
    user = db.get(m.User, me.id)
    assert user is not None
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Aktuelles Passwort ist falsch")
    _check_password(body.new_password)
    if body.new_password == body.current_password:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Das neue Passwort muss sich vom bisherigen unterscheiden")
    user.password_hash = hash_password(body.new_password)
    _end_sessions(db, user.id, keep_hash=token_hash(authorization[7:].strip()))
    db.commit()


__all__ = ["router", "user_to_api"]
