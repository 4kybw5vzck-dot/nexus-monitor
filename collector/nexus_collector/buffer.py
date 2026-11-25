"""Lokaler Puffer für Messergebnisse (SQLite).

Ergebnisse landen zuerst hier und werden erst nach Bestätigung durch die Zentrale
gelöscht. So gehen bei WAN-Ausfall oder Neustart keine Messwerte verloren. Ist der
Puffer voll, werden die ältesten Einträge verworfen.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading


class ResultBuffer:
    def __init__(self, directory: str, max_rows: int = 500_000) -> None:
        os.makedirs(directory, exist_ok=True)
        self.path = os.path.join(directory, "results.sqlite3")
        self.max_rows = max_rows
        self._lock = threading.Lock()
        self._db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=NORMAL")
        self._db.execute("CREATE TABLE IF NOT EXISTS results (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)")
        self.dropped = 0

    def add_many(self, items: list[dict]) -> None:
        if not items:
            return
        with self._lock:
            self._db.execute("BEGIN")
            self._db.executemany("INSERT INTO results (payload) VALUES (?)", [(json.dumps(i),) for i in items])
            excess = self._count_locked() - self.max_rows
            if excess > 0:
                self._db.execute("DELETE FROM results WHERE id IN (SELECT id FROM results ORDER BY id LIMIT ?)", (excess,))
                self.dropped += excess
            self._db.execute("COMMIT")

    def peek(self, limit: int) -> list[tuple[int, dict]]:
        with self._lock:
            rows = self._db.execute("SELECT id, payload FROM results ORDER BY id LIMIT ?", (limit,)).fetchall()
        return [(i, json.loads(p)) for i, p in rows]

    def remove_upto(self, last_id: int) -> None:
        with self._lock:
            self._db.execute("DELETE FROM results WHERE id <= ?", (last_id,))

    def _count_locked(self) -> int:
        return self._db.execute("SELECT count(*) FROM results").fetchone()[0]

    def count(self) -> int:
        with self._lock:
            return self._count_locked()

    def close(self) -> None:
        with self._lock:
            self._db.close()
