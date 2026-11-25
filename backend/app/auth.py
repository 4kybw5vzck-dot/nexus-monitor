"""Anmeldung: lokale Benutzer, Sitzungs-Token (Bearer), Rollenprüfung."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from datetime import timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from . import models as m
from . import schemas as s
from .config import get_settings
from .db import get_db
from .security import new_token, token_hash, verify_password
from .services import utcnow

router = APIRouter(prefix="/api/auth", tags=["Anmeldung"])

# --- einfacher Schutz gegen Passwort-Raten (je Login und je Client-Adresse) ---
_MAX_FAILURES = 5
_WINDOW_SEC = 300
_failures: dict[str, deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def _blocked(key: str) -> bool:
    now = time.monotonic()
    with _lock:
        q = _failures[key]
        while q and now - q[0] > _WINDOW_SEC:
            q.popleft()
        return len(q) >= _MAX_FAILURES


def _record_failure(key: str) -> None:
    with _lock:
        _failures[key].append(time.monotonic())


def reset_failures() -> None:
    with _lock:
        _failures.clear()


def user_to_api(u: m.User) -> s.User:
    return s.User(id=u.id, name=u.name, login=u.login, role=u.role, email=u.email,
                  last_login=u.last_login, active=u.active, has_password=u.password_hash is not None)


def current_user(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> m.User:
    unauthorized = HTTPException(
        status.HTTP_401_UNAUTHORIZED, "Nicht angemeldet oder Sitzung abgelaufen",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not authorization or not authorization.lower().startswith("bearer "):
        raise unauthorized
    session = db.get(m.AuthSession, token_hash(authorization[7:].strip()))
    if session is None or session.expires_at <= utcnow() or not session.user.active:
        raise unauthorized
    return session.user


def require_roles(*roles: str):
    def check(user: m.User = Depends(current_user)) -> m.User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Keine Berechtigung für diese Aktion")
        return user

    return check


@router.post("/login", response_model=s.LoginResponse)
def login(body: s.LoginRequest, request: Request, db: Session = Depends(get_db)) -> s.LoginResponse:
    client = request.client.host if request.client else "?"
    keys = (f"login:{body.login.lower()}", f"ip:{client}")
    if any(_blocked(k) for k in keys):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Zu viele Fehlversuche – bitte einige Minuten warten")
    user = db.scalar(select(m.User).where(m.User.login == body.login))
    ok = verify_password(body.password, user.password_hash if user else None)
    if not ok or user is None or not user.active:
        for k in keys:
            _record_failure(k)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Benutzername oder Passwort falsch")

    now = utcnow()
    expires = now + timedelta(hours=get_settings().session_hours)
    token = new_token()
    db.execute(delete(m.AuthSession).where(m.AuthSession.user_id == user.id, m.AuthSession.expires_at <= now))
    db.add(m.AuthSession(token_hash=token_hash(token), user_id=user.id, expires_at=expires))
    user.last_login = now
    db.commit()
    return s.LoginResponse(token=token, expires_at=expires, user=user_to_api(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> None:
    if authorization and authorization.lower().startswith("bearer "):
        db.execute(delete(m.AuthSession).where(m.AuthSession.token_hash == token_hash(authorization[7:].strip())))
        db.commit()


@router.get("/me", response_model=s.User)
def me(user: m.User = Depends(current_user)) -> s.User:
    return user_to_api(user)
