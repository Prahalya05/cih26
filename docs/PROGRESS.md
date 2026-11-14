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
| 12 Validation and pilot | Code done; pilot not run | 12.1 `tests/test_fairness.py` (gender swap through scoring and through sync, under-claiming, sector spread; 200 synthetic students). 12.2 `docs/Disha_Pilot_Pack.docx` (plan, headteacher letter, Tamil/English consent form, teacher rating sheet, student questions; built by `scripts/make_pilot_pack.py`). 12.3 `scripts/pilot_report.py` (kappa, within-one, retest, effort, survey, questions to fix; `--simulate` dry run in `docs/benchmarks/pilot_dry_run.md`). 12.4 `scripts/calibrate.py` (Rasch, fit, Mantel-Haenszel by gender and medium; `--write` updates the bank, retired questions are scored but not asked) |
| 13 Demo and launch | Not started | Demo stories as events, deploy, load tests, pitch |

## Next steps, in order

1. Click through the app in a browser (Chrome extension was not connected): new student with birth year, consent scopes, Privacy screen (toggle photos, withdraw, delete), and the paid-job "Confirmed" badge.
   - API: `cd apps/api && CORS_ORIGINS=http://localhost:5185 python -m uvicorn app.main:app --port 8010`
   - App: `cd apps/web && VITE_API_URL=http://localhost:8010 npx vite --port 5185`
2. Run the pilot with the pack (needs a school, signed forms, phones), then `pilot_report.py` and `calibrate.py`.
3. Phase 13: rebuild demo students as event stories (so the demo class shows Strong matches), deploy, load test.

## Research follow-ups (from a review of skill-extraction methods, 14 November 2026)

Status: items 1 and 2 done after Phase 11; item 3 is for the Phase 13 pitch; item 4 is done in code and waiting on the Word files (see below).

1. **Done.** `gemini.py` returns `experiences[]` beside the unchanged `skills`; `clean_experiences()` drops items without a quote and unknown skill ids; the keyword fallback returns one experience. The phone stores them on each answer (`Answer.experiences`); events are unchanged. Original note: **Experience-first extraction.** Change the prompt and schema in `apps/api/app/adapters/gemini.py` so Gemini returns `experiences[]` (what the student does, e.g. "stitches blouses for neighbours"), each with `responsibilities[]` and `skill_ids[]` plus quoted evidence. Keep the existing flat `skills` field exactly as it is and add `experiences` beside it, so the app and evidence events do not change. Keyword fallback (`adapters/keywords.py`) puts everything under a single experience. This is the method used by Tabiya Compass (open-source skills agent).
2. **Done.** `rpl` added to 5 careers in `occupations.json`, each checked against NQR or sector skill council documents on 14 November 2026: Two Wheeler Service Technician ASC/Q1411 (NSQF 4), Dairy Farmer/Entrepreneur AGR/Q4101 (NSQF 4), Self Employed Tailor AMH/Q1947 (NSQF 4), Commis Chef THC/Q0406 (NSQF 4; NQR lists a newer "Commis" version), Sewing Machine Operator AMH/Q0301 (level unknown: sources say 3 or 4). Left out: Electrician (several Assistant Electrician packs from different councils, none clearly the one) and the other careers. `rplOpportunities()` in `packages/engine/src/rpl.ts`: a listed sub-skill at level 4 shows "You can apply for RPL certification under PMKVY"; under 18 it says "when you turn 18" (PMKVY RPL is for ages 18-59, per NSDC). `validate_kb.py` checks the QP code format, source link, checked date and sub-skills. PMKVY 4.0 is reported (not officially confirmed) to run until 31 December 2026, so the app tells students to check the scheme is open. Original note: **RPL certification as an Opportunity.** Add NSQF level and an RPL note to relevant careers in `packages/kb/occupations.json`. When a sub-skill reaches level 4 (Strong), show "Eligible to apply for RPL certification under PMKVY". Check every job role against the official NSDC/NCVET Qualification Pack list; do not invent QP codes.
3. **Pitch points (no code):**
   - Against "isn't this just Compass?": Compass stops at what the student says; Disha uses speech only to decide what to test, then measures with adaptive tests, work samples and paid jobs.
   - Harambee (South Africa): 20% of those doing poorly in school maths show enough problem-solving potential for entry-level roles. Supports measuring aptitude separately.
   - IRT adaptive testing is the method behind the GRE, TOEFL, GMAT and the Duolingo English Test.
   - Hand-set Bayesian tracing is the defensible choice without large answer logs; deep models (DKT) need big data. Evidence weights are starting values, recalibrated after the pilot (Phase 12: Rasch, DIF check).
   - Open answers are scored per checklist item, never as one overall grade (more robust to padding and spelling errors).
4. **Resolved: the code is right** (weights are exponents, so 5 per order would make one order nearly conclusive). The Word docs still say 5 (max 25) and show old Meena numbers, because they were open in Word when the update ran. Engine numbers for Meena's machine stitching: voice only level 2 (72%), after test level 2 (83%), photo level 3 (72%), teacher check level 3 (97%, Strong), five paid orders level 4 (82%). Original note: paid-order weight is 2 per order (max 10) in code vs 5 (max 25) in the design doc (also listed under Open items).

Sources: Tabiya Compass (globaldevincubator.org), Harambee "Breaking Barriers" (Feb 2024), CSAE Oxford skills-based hiring, JEDM "When is Deep Learning the Best Approach to Knowledge Tracing?", arXiv 2404.00712 (CAT survey), arXiv 2307.03539 (LLM ESCO matching), NSDC Recognition of Prior Learning.

## Open items

- Phase 12 findings and choices:
  - Retest target (75% same level) cannot be met by one short test: simulated test-retest agreement is about 58% exact with 8 questions and 62% with 15, but 97% within one level. Decide before the pilot whether to judge retest on the full Disha level (all evidence) or on within-one.
  - `calibrate.py` is plain Python, not the girth library named in the plan (girth is unmaintained and may not run on NumPy 2). It retires a question only when infit > 1.3; infit < 0.7 is listed for review, and outfit is reported only (too noisy with adaptive tests and 60 students). On clean synthetic data about 1 in 20 questions is flagged by chance, so a teacher should look at flags before `--write`.
  - The plan blends pilot difficulties 50:50 with Angoff values; no Angoff values exist yet, so the blend is with the current team estimates.
  - The pilot pack has not been checked visually (no PDF renderer on this machine); open it in Word before printing. Tamil text in the consent form and questions needs a native speaker's check.

- Phase 11 gaps: OTP to the guardian's phone is not built (under-18s can only use the signed paper form, which is not photographed in the app). `share_portfolio` is recorded and can be switched, but there is no portfolio-sharing feature yet for it to control. A minor can still log a paid job in a skill with a hazardous sub-skill (only work samples are blocked).
- The legacy `/v1/sync` table `legacy_student_doc` stores whole student records, including the name, as JSON; the CI column check cannot see this. Erasure clears it. Drop it once phones are on v2.
- Server access logs include buyer-link tokens in the URL path (`/v2/confirm/{token}`).

- Teacher and mentor PIN login (9.1) not built: any phone in teacher mode counts as a teacher.
- Rater leniency is measured but scores are not yet shifted by it.
- Tamil level descriptions (128) and all questions need a teacher's review.
- No GitHub remote yet; nothing pushed. No Supabase project yet.
- `Disha_Skill_Assessment_and_Database.docx` and `Disha_Implementation_Plan.docx` still need the paid-order weight (2 per order, max 10) and the Meena numbers above. Close them in Word first.
- No Gemini key in `.env`: photos wait for the teacher until one is added.

## How to run

- Database: `docker compose up -d`, then `python scripts/migrate.py` and `python scripts/load_kb.py`
- Tests: `npm test` (engine + web typecheck) and `cd apps/api && python -m pytest -q` (needs the database)
- After changing engine logic: `python scripts/gen_golden.py`, then both test suites
