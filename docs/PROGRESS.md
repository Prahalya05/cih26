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
| 9 Real-world evidence | Done, checked live against the API | Paid jobs + buyer link (`screens/Order.tsx`, `screens/ConfirmJob.tsx`, `/v2/orders/.../link`, `/v2/confirm/...`), taster and term ratings (`screens/Rate.tsx`), `scripts/rater_stats.py`. Live run: phone sync, buyer link, buyer page, confirm, rating back on the phone, CORS. The on-screen "Confirmed" badge has not been seen in a browser yet |
| 10 Matching | Done | `fitreach.ts` / `fitreach.py`: Fit, Reach, Worth; could-learn flag; sub-skill what-ifs; best-next-test picker |
| 11 Privacy and safety | Done | Three consent scopes and guardian method (`screens/Consent.tsx`), Privacy screen to change scopes, withdraw or delete (`screens/Privacy.tsx`), withdrawal stops sync both ways, `DELETE /v2/student/{id}` with `deletion_count` (migration 0006), guardian name moved to `student_private`, under-18 work-sample rule (`safety.ts` / `safety.py`), `scripts/check_privacy.py` in CI |
| 12 Validation and pilot | Not started | Fairness tests, pilot prep, `scripts/calibrate.py` |
| 13 Demo and launch | Not started | Demo stories as events, deploy, load tests, pitch |

## Next steps, in order

1. Click through the app in a browser (Chrome extension was not connected): new student with birth year, consent scopes, Privacy screen (toggle photos, withdraw, delete), and the paid-job "Confirmed" badge.
   - API: `cd apps/api && CORS_ORIGINS=http://localhost:5185 python -m uvicorn app.main:app --port 8010`
   - App: `cd apps/web && VITE_API_URL=http://localhost:8010 npx vite --port 5185`
2. Phase 12: fairness tests in CI, pilot materials, Rasch recalibration script.
3. Decide when to do the research follow-ups below (experience-first extraction, RPL opportunity).
4. Phase 13: rebuild demo students as event stories (so the demo class shows Strong matches), deploy, load test.

## Research follow-ups (from a review of skill-extraction methods, 14 November 2026)

Not yet scheduled: decide whether to do items 1-2 before or after Phase 11.

1. **Experience-first extraction.** Change the prompt and schema in `apps/api/app/adapters/gemini.py` so Gemini returns `experiences[]` (what the student does, e.g. "stitches blouses for neighbours"), each with `responsibilities[]` and `skill_ids[]` plus quoted evidence. Keep the existing flat `skills` field exactly as it is and add `experiences` beside it, so the app and evidence events do not change. Keyword fallback (`adapters/keywords.py`) puts everything under a single experience. This is the method used by Tabiya Compass (open-source skills agent).
2. **RPL certification as an Opportunity.** Add NSQF level and an RPL note to relevant careers in `packages/kb/occupations.json`. When a sub-skill reaches level 4 (Strong), show "Eligible to apply for RPL certification under PMKVY". Check every job role against the official NSDC/NCVET Qualification Pack list; do not invent QP codes.
3. **Pitch points (no code):**
   - Against "isn't this just Compass?": Compass stops at what the student says; Disha uses speech only to decide what to test, then measures with adaptive tests, work samples and paid jobs.
   - Harambee (South Africa): 20% of those doing poorly in school maths show enough problem-solving potential for entry-level roles. Supports measuring aptitude separately.
   - IRT adaptive testing is the method behind the GRE, TOEFL, GMAT and the Duolingo English Test.
   - Hand-set Bayesian tracing is the defensible choice without large answer logs; deep models (DKT) need big data. Evidence weights are starting values, recalibrated after the pilot (Phase 12: Rasch, DIF check).
   - Open answers are scored per checklist item, never as one overall grade (more robust to padding and spelling errors).
4. **Resolve before any slide quotes it:** paid-order weight is 2 per order (max 10) in code vs 5 (max 25) in the design doc (also listed under Open items).

Sources: Tabiya Compass (globaldevincubator.org), Harambee "Breaking Barriers" (Feb 2024), CSAE Oxford skills-based hiring, JEDM "When is Deep Learning the Best Approach to Knowledge Tracing?", arXiv 2404.00712 (CAT survey), arXiv 2307.03539 (LLM ESCO matching), NSDC Recognition of Prior Learning.

## Open items

- Phase 11 gaps: OTP to the guardian's phone is not built (under-18s can only use the signed paper form, which is not photographed in the app). `share_portfolio` is recorded and can be switched, but there is no portfolio-sharing feature yet for it to control. A minor can still log a paid job in a skill with a hazardous sub-skill (only work samples are blocked).
- The legacy `/v1/sync` table `legacy_student_doc` stores whole student records, including the name, as JSON; the CI column check cannot see this. Erasure clears it. Drop it once phones are on v2.
- Server access logs include buyer-link tokens in the URL path (`/v2/confirm/{token}`).

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
