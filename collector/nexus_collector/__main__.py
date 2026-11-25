"""Start:  python -m nexus_collector   (Konfiguration über Umgebungsvariablen, siehe config.py)"""

from __future__ import annotations

import asyncio
import logging
import signal
import sys

from .config import Settings
from .engine import Engine


def main() -> None:
    settings = Settings.from_env()
    logging.basicConfig(level=settings.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # pysnmp/asyncssh protokollieren sehr ausführlich
    logging.getLogger("asyncssh").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    if len(settings.token) < 20:
        logging.error("NEXUS_COLLECTOR_TOKEN fehlt oder ist zu kurz (mindestens 20 Zeichen)")
        sys.exit(2)

    async def runner() -> None:
        engine = Engine(settings)
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, engine.stop_event.set)
        await engine.run()

    asyncio.run(runner())


if __name__ == "__main__":
    main()
