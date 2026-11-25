"""Passwort-Hashing und Sitzungs-Token – nur mit der Python-Standardbibliothek.

- Passwörter: scrypt (hashlib), zufälliges Salz je Passwort.
  Format: scrypt$<n>$<r>$<p>$<salt-hex>$<hash-hex>
- Sitzungen: zufälliges Token (256 Bit) für den Client; in der Datenbank steht
  nur dessen SHA-256-Hash. Abmelden oder Ablauf löscht die Sitzung serverseitig.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

_N, _R, _P, _DKLEN = 2**14, 8, 1, 32
MIN_PASSWORD_LENGTH = 10


def hash_password(password: str) -> str:
    if not password:
        raise ValueError("Leeres Passwort")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=_DKLEN)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored or not password:
        # Gleiche Rechenzeit wie eine echte Prüfung (erschwert das Erraten von Konten)
        hashlib.scrypt(b"x", salt=b"0" * 16, n=_N, r=_R, p=_P, dklen=_DKLEN)
        return False
    try:
        algo, n, r, p, salt_hex, hash_hex = stored.split("$")
        if algo != "scrypt":
            return False
        digest = hashlib.scrypt(
            password.encode(), salt=bytes.fromhex(salt_hex), n=int(n), r=int(r), p=int(p), dklen=len(hash_hex) // 2
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest.hex(), hash_hex)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def generate_password(length: int = 20) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))
