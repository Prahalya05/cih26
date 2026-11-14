#!/bin/sh
# Container start (Step 13.2): bring the database up to date, load the knowledge base, start the server.
set -e
python scripts/migrate.py
python scripts/load_kb.py
cd apps/api
# --proxy-headers: the host's load balancer terminates HTTPS in front of us.
exec python -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-2}" --proxy-headers --forwarded-allow-ips '*' --no-access-log
