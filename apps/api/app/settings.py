"""All server settings in one place, read from environment variables (see .env.example)."""
from __future__ import annotations

import os
from pathlib import Path


def _load_dotenv() -> None:
    """Read the repo-root .env for local development. Real environment variables win."""
    path = Path(__file__).resolve().parents[3] / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:disha@localhost:5432/disha")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
MEDIA_BUCKET = os.getenv("MEDIA_BUCKET", "")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
DB_POOL_MAX = int(os.getenv("DB_POOL_MAX", "20"))  # database connections per server process
# Seconds a request waits for a free database connection before failing with an error (instead of hanging).
DB_POOL_TIMEOUT = float(os.getenv("DB_POOL_TIMEOUT", "10"))
