"""Verwaltung über die Kommandozeile.

Passwort setzen (z. B. Administrator-Passwort vergessen):
    docker compose exec backend python -m app.cli set-password admin

Das Passwort wird verdeckt abgefragt (oder per --stdin aus einer Pipe gelesen).
Bestehende Anmeldesitzungen des Benutzers werden dabei beendet.
"""

from __future__ import annotations

import argparse
import getpass
import sys

from sqlalchemy import delete, select

from . import models as m
from .db import session_scope
from .security import MIN_PASSWORD_LENGTH as MIN_LENGTH
from .security import hash_password


def set_password(login: str, password: str) -> None:
    if len(password) < MIN_LENGTH:
        raise SystemExit(f"Passwort zu kurz (mindestens {MIN_LENGTH} Zeichen).")
    with session_scope() as db:
        user = db.scalar(select(m.User).where(m.User.login == login))
        if user is None:
            raise SystemExit(f"Benutzer '{login}' nicht gefunden.")
        user.password_hash = hash_password(password)
        user.active = True
        db.execute(delete(m.AuthSession).where(m.AuthSession.user_id == user.id))
        db.commit()
    print(f"Passwort für '{login}' gesetzt. Bestehende Sitzungen wurden beendet.")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="NEXUS Monitor – Verwaltung")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("set-password", help="Passwort eines Benutzers setzen (aktiviert das Konto)")
    p.add_argument("login")
    p.add_argument("--stdin", action="store_true", help="Passwort aus der Standardeingabe lesen")
    args = parser.parse_args(argv)

    if args.command == "set-password":
        if args.stdin:
            password = sys.stdin.readline().rstrip("\n")
        else:
            password = getpass.getpass("Neues Passwort: ")
            if password != getpass.getpass("Wiederholen: "):
                raise SystemExit("Die Eingaben stimmen nicht überein.")
        set_password(args.login, password)


if __name__ == "__main__":
    main()
