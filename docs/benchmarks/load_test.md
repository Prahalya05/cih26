# Sync load test

Target: 95th percentile under 1 s (Step 13.3). Made by `python scripts/load_test.py`.

| When | Where | Phones × events | Start | OK responses | Events accepted | p50 s | p95 s | max s | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-14 10:26 | laptop, local Postgres in Docker, 1 uvicorn worker | 200 × 50 | burst | 200/200 | 10000 | 6.497 | 14.042 | 14.375 | FAIL |
| 2026-11-14 10:30 | laptop (Windows, Postgres in Docker Desktop), 4 workers, batched inserts | 200 × 50 | burst | 200/200 | 10000 | 3.588 | 6.222 | 6.368 | FAIL |
| 2026-11-14 10:39 | Docker image on laptop, 2 workers, DB via host.docker.internal | 200 × 50 | burst | 200/200 | 10000 | 4.927 | 8.469 | 8.495 | FAIL |
