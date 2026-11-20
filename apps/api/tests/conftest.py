"""Gives each test run its own empty PostgreSQL database with all migrations applied.

Needs a running PostgreSQL (docker compose up -d, or the CI service). The database named in
DATABASE_URL is only used to create and drop the throwaway test database.
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import psycopg
import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "apps" / "api"))
sys.path.insert(0, str(ROOT / "scripts"))

# Tests register many phones from one address; the rate limit has its own test (test_ai_checks.py).
os.environ.setdefault("RATE_LIMIT_SCALE", "0")

from app import db, settings  # noqa: E402
import migrate  # noqa: E402


@pytest.fixture(scope="session")
def database_url():
    base = settings.DATABASE_URL
    name = f"disha_test_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(base, autocommit=True) as con:
        con.execute(f'create database "{name}"')
    url = base.rsplit("/", 1)[0] + "/" + name
    migrate.migrate(url, quiet=True)
    yield url
    db.close_pool()
    with psycopg.connect(base, autocommit=True) as con:
        con.execute(f'drop database "{name}" with (force)')


@pytest.fixture()
def pg(database_url, monkeypatch):
    """Points the app at the test database and empties every table before the test."""
    monkeypatch.setattr(settings, "DATABASE_URL", database_url)
    with psycopg.connect(database_url, autocommit=True) as con:
        tables = [r[0] for r in con.execute(
            "select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'")]
        con.execute("truncate " + ", ".join(tables) + " restart identity cascade")
    yield database_url
