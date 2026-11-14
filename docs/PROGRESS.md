# Implementation progress

Tracks the build against `docs/Disha_Implementation_Plan.docx`. Last updated 14 November 2026.

## Status by phase

| Phase | Status | Notes |
| --- | --- | --- |
| 0 Repo setup | Done | First commit, CI (`.github/workflows/ci.yml`), `.env.example`, `docker-compose.yml` (local Postgres + pgvector), `docs/SCOPE.md` |
| 1 Knowledge graph | Done | `packages/kb/graph/` (32 sub-skills, 3 aptitudes, 132 edges), `scripts/validate_kb.py`, loaders in `packages/engine/src/graph.ts` and `apps/api/app/kb.py` |
| 2 Database | Done | PostgreSQL replaces SQLite. Migrations `apps/api/migrations/0001-0005`, `scripts/migrate.py`, `scripts/load_kb.py`, row-level security by school |
| 3 Evidence log and sync | Done | Event types in `packages/engine/src/events.ts` + `apps/api/app/schemas.py`; Dexie v2 (`apps/web/src/lib/db.ts`); `/v2/sync`; phone sync in `apps/web/src/lib/sync.ts` |
| 4 Skill engine | Done | `irt.ts`, `tracing.ts` (+ Python copies), golden parity tests, `scripts/simulate.py` (80% exact, 99.7% within one level, mean 7.6 questions) |
| 5 Question bank | Partly | 42 starter questions (6 per sub-skill, 8 sub-skills), 2 checklists. All `reviewed: false`. Plan target: 12 per sub-skill, pictures, Tamil audio, Angoff cut-points |
| 6 Assessment screens | Done | `screens/Assess.tsx`, `components/Items.tsx` (choice, estimate, order steps), skill levels on Strengths tab |
| 7 Aptitude games | Done | `scripts/gen_aptitude.py` (59 puzzles), `components/Figure.tsx` (SVG gears, seesaw, shapes), `screens/Game.tsx`. District percentiles (7.2) not done |
| 8 Work samples | Done | `lib/samples.ts`, `screens/WorkSample.tsx`, `adapters/gemini_vision.py`, `/v2/work-sample/score`, teacher queue in `screens/Teacher.tsx` |
| 9 Real-world evidence | Done, not browser-checked | Paid jobs + buyer link (`screens/Order.tsx`, `screens/ConfirmJob.tsx`, `/v2/orders/.../link`, `/v2/confirm/...`), taster and term ratings (`screens/Rate.tsx`), `scripts/rater_stats.py` |
| 10 Matching | Done | `fitreach.ts` / `fitreach.py`: Fit, Reach, Worth; could-learn flag; sub-skill what-ifs; best-next-test picker |
| 11 Privacy and safety | Not started | Next |
| 12 Validation and pilot | Not started | Fairness tests, pilot prep, `scripts/calibrate.py` |
| 13 Demo and launch | Not started | Demo stories as events, deploy, load tests, pitch |

## Next steps, in order

1. Browser-check Phase 9 with the API running: log a job, open the buyer link, confirm, see "Confirmed" on the student's phone. This is also the first browser test of phone-to-server sync.
   - API: `cd apps/api && CORS_ORIGINS=http://localhost:5185 python -m uvicorn app.main:app --port 8010`
   - App: `cd apps/web && VITE_API_URL=http://localhost:8010 npx vite --port 5185`
2. Phase 11: separate consent scopes on the consent screen, `DELETE /v2/student/{id}` with full erasure, block hazardous work samples for under-18s, CI check for name/phone columns.
3. Phase 12: fairness tests in CI, pilot materials, Rasch recalibration script.
4. Phase 13: rebuild demo students as event stories (so the demo class shows Strong matches), deploy, load test.

## Open items

- Teacher and mentor PIN login (9.1) not built: any phone in teacher mode counts as a teacher.
- Rater leniency is measured but scores are not yet shifted by it.
- Tamil level descriptions (128) and all questions need a teacher's review.
- No GitHub remote yet; nothing pushed. No Supabase project yet.
- Paid-order weight is 2 per order (max 10), not 5 (max 25) as in the design doc; five confirmed orders reach level 4. The design doc's worked example (level 3 at 88%) needs updating to match.
- No Gemini key in `.env`: photos wait for the teacher until one is added.

## How to run

- Database: `docker compose up -d`, then `python scripts/migrate.py` and `python scripts/load_kb.py`
- Tests: `npm test` (engine + web typecheck) and `cd apps/api && python -m pytest -q` (needs the database)
- After changing engine logic: `python scripts/gen_golden.py`, then both test suites
