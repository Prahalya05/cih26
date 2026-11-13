"""Applies apps/api/migrations/*.sql that have not been applied yet, in name order, one transaction each.

Run:  python scripts/migrate.py            (uses DATABASE_URL from the environment or .env)
      python scripts/migrate.py <url>
Running it twice does nothing the second time.
"""
from __future__ import annotations

import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "apps" / "api" / "migrations"
sys.path.insert(0, str(ROOT / "apps" / "api"))


def migrate(url: str, quiet: bool = False) -> list[str]:
    applied_now: list[str] = []
    with psycopg.connect(url, autocommit=True) as con:
        con.execute("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())")
        done = {r[0] for r in con.execute("select name from schema_migrations")}
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if path.name in done:
                continue
            with con.transaction():
                con.execute(path.read_text(encoding="utf-8"))
                con.execute("insert into schema_migrations(name) values (%s)", (path.name,))
            applied_now.append(path.name)
            if not quiet:
                print("applied", path.name)
    if not quiet and not applied_now:
        print("nothing to apply")
    return applied_now


if __name__ == "__main__":
    if len(sys.argv) > 1:
        db_url = sys.argv[1]
    else:
        from app import settings
        db_url = settings.DATABASE_URL
    migrate(db_url)
