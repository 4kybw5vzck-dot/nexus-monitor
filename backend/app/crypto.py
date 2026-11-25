"""Verschlüsselung der Zugangsdaten (Zugangsprofile).

Fernet (AES-128-CBC + HMAC-SHA256) mit einem Schlüssel, der per HKDF aus
NEXUS_SECRET_KEY abgeleitet wird. Wird NEXUS_SECRET_KEY geändert, lassen sich
gespeicherte Zugangsdaten nicht mehr entschlüsseln und müssen neu eingegeben werden.
"""

from __future__ import annotations

import base64
import json

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from .config import get_settings

MIN_SECRET_KEY_LENGTH = 16


class SecretKeyMissing(RuntimeError):
    """NEXUS_SECRET_KEY fehlt oder ist zu kurz."""


class SecretUnreadable(RuntimeError):
    """Gespeicherte Zugangsdaten passen nicht zum aktuellen NEXUS_SECRET_KEY."""


def _fernet() -> Fernet:
    secret = get_settings().secret_key
    if len(secret) < MIN_SECRET_KEY_LENGTH:
        raise SecretKeyMissing(
            f"NEXUS_SECRET_KEY fehlt oder ist kürzer als {MIN_SECRET_KEY_LENGTH} Zeichen – "
            "Zugangsdaten können nicht verschlüsselt gespeichert werden"
        )
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=b"nexus-monitor", info=b"credential-profiles").derive(
        secret.encode()
    )
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_secret(data: dict) -> bytes:
    return _fernet().encrypt(json.dumps(data, separators=(",", ":")).encode())


def decrypt_secret(token: bytes | None) -> dict:
    if not token:
        return {}
    try:
        return json.loads(_fernet().decrypt(bytes(token)))
    except InvalidToken:
        raise SecretUnreadable(
            "Zugangsdaten lassen sich nicht entschlüsseln (NEXUS_SECRET_KEY geändert?) – bitte im Zugangsprofil neu eingeben"
        ) from None


def secret_key_configured() -> bool:
    return len(get_settings().secret_key) >= MIN_SECRET_KEY_LENGTH
