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

# Sign-in (app/routers/accounts.py). AUTH_SECRET keys the HMAC that hides phone numbers and emails; set a long random
# value in production. Without SMTP settings, codes are shown on screen (demo mode) instead of being emailed.
AUTH_SECRET = os.getenv("AUTH_SECRET", "dev-only-auth-secret-change-me")
OTP_DEMO = os.getenv("OTP_DEMO", "1") == "1"
# How many student profiles one student account may hold (app/auth.py, migration 0016).
STUDENT_PROFILES_MAX = int(os.getenv("STUDENT_PROFILES_MAX", "3"))
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER)
