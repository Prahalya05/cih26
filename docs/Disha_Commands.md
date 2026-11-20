# Disha: Commands Guide

Every command needed to set up, run, change, test, deploy and inspect each part of Disha. Companion to docs/Disha_Project_Guide.md (what each part does).

Status as of 20 November 2026. Commands run from the repository root unless a step says `cd`. Bash means Git Bash on Windows, or any Linux/macOS shell; PowerShell variants are given where they differ.

Never print or commit the values in `.env`, `.env.supabase` or `.env.codes`. They are git-ignored on purpose.

---

## 1. Where everything is

| What | Address | Notes |
|---|---|---|
| Live app | https://disha-pa6e.onrender.com | Free plan sleeps when idle; first request takes about 70 s |
| Live API docs (OpenAPI) | https://disha-pa6e.onrender.com/docs | Try every endpoint in the browser |
| Live health check | https://disha-pa6e.onrender.com/health | Shows AI or keyword mode |
| Funder dashboard | https://disha-pa6e.onrender.com/?funder | Proof Pays branch only, once deployed |
| Source code | https://github.com/Prahalya05/cih26 | Branches: main (live), feat/proof-pays, feat/aim-high |
| Hosting | https://dashboard.render.com | Service `disha`, Docker, Singapore, auto-deploys from main |
| Database | https://supabase.com/dashboard | Project `disha`, Mumbai, PostgreSQL 16 + pgvector; Data API off on purpose |
| Gemini key | https://aistudio.google.com/apikey | Key named "Disha", free tier |
| Local app | http://localhost:5173 | `npm run dev` |
| Local API | http://localhost:8000 (docs at /docs) | uvicorn |
| Local chain | http://127.0.0.1:8545 | Anvil, for Proof Pays |

---

## 2. Requirements and first install

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 22.18 or newer | Web app, engine, ZK package |
| Python | 3.12 | API, scripts, tests |
| Docker Desktop | any recent | Local PostgreSQL, building the deploy image |
| Git, GitHub CLI (gh) | any | Branches, pull requests |
| Foundry (forge, anvil, cast) | any recent | Proof Pays contracts only |
| circom | 2.2 | Rebuilding the ZK circuit only |

```bash
git clone https://github.com/Prahalya05/cih26.git
cd cih26
npm install                                   # all workspaces: apps/web, packages/engine, packages/zk
pip install -r apps/api/requirements.txt
cp .env.example .env                          # then fill in values (see section 3)
```

PowerShell: `Copy-Item .env.example .env`

---

## 3. Environment files and variables

| File | Holds | Used by |
|---|---|---|
| `.env` | Local DATABASE_URL, GEMINI_API_KEY, CORS_ORIGINS, ADMIN_TOKEN | Local API and scripts |
| `.env.supabase` | Supabase DATABASE_URL (session pooler) and DB_POOL_MAX | Scripts run against production |
| `.env.codes` | Demo school class code and the secret teacher code | You, when demoing |
| `.env.example` | Template with no secrets | Committed |

Keep `.env.supabase` separate from `.env`: the pytest setup creates and drops databases on whatever DATABASE_URL points to.

| Variable | Needed | Purpose |
|---|---|---|
| `DATABASE_URL` | API | PostgreSQL connection string. Local: `postgresql://postgres:disha@localhost:5432/disha` |
| `GEMINI_API_KEY` | No | Turns on AI skill extraction and photo/video scoring; without it, keyword matching and teacher-only scoring |
| `GEMINI_MODEL` | No | One model or a comma list tried in order. Default `gemini-3.1-flash-lite,gemini-flash-lite-latest,gemini-3.5-flash` |
| `GEMINI_VISION_MODEL` | No | Model for photo and video scoring |
| `CORS_ORIGINS` | API | Browser origins allowed, comma-separated |
| `ADMIN_TOKEN` | API | Protects admin-only endpoints |
| `MEDIA_BUCKET` | No | Storage for portfolio media students chose to share |
| `DB_POOL_MAX`, `DB_POOL_TIMEOUT` | No | Connection pool per worker (production: 5) |
| `WEB_CONCURRENCY` | No | Uvicorn workers (production: 2) |
| `KB_DIR`, `WEB_DIST` | No | Override knowledge-base and built-app folders |
| `VITE_API_URL` | Web build | Where the app finds the API; empty = same origin |
| `ZK_ISSUER_KEY` | Proof Pays | Hex secret that signs skill credentials (503 without it) |
| `ZK_CONSTANTS` | No | Path to Poseidon constants (default packages/zk/src/poseidon_constants.json) |
| `CHAIN_RPC_URL` | Proof Pays | Anvil or Sepolia RPC |
| `CHAIN_DEPLOYMENT` | Proof Pays | Path to contracts/deployments/<chain id>.json |
| `RELAYER_PRIVATE_KEY` | Proof Pays | Test-network key that pays gas (never one holding real money) |

Load an env file into the current shell:

```bash
set -a; . ./.env.supabase; set +a             # Bash
```

```powershell
Get-Content .env.supabase | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object { $k,$v = $_ -split '=',2; Set-Item "env:$($k.Trim())" $v.Trim() }
```

Make a new ZK issuer key or admin token:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

---

## 4. Git: branches, pulling, pushing

| Branch | Holds | Live? |
|---|---|---|
| `main` | Everything deployed | Yes: every push auto-deploys to Render |
| `feat/proof-pays` | Video assessment, fair-test check, ZK credential, payout contract, funder dashboard | No |
| `feat/aim-high` | Aim High pathways and the UI refresh (built on top of feat/proof-pays) | No |
| `origin/ui-redesign` | A teammate's UI redesign | No |

```bash
git status                                    # what changed
git branch -a                                 # all branches, local and remote
git fetch origin                              # get remote updates
git switch feat/aim-high                      # move to a branch
git switch -c feat/my-change                  # new branch from where you are
git pull                                      # update the current branch
git log --oneline --graph -15 --all           # history
git diff main..feat/aim-high --stat           # what a branch changes

git add <files>                               # stage (never .env*, never cih26_helperdocs/)
git commit -m "Short summary"
git push -u origin feat/my-change             # first push of a new branch
git push                                      # later pushes
```

Pull requests (GitHub CLI):

```bash
gh pr create --base main --head feat/proof-pays --title "Proof Pays" --body "What and why"
gh pr create --base feat/proof-pays --head feat/aim-high --title "Aim High"   # reviews only the Aim High change
gh pr list
gh pr view <number> --web
gh pr merge <number> --merge                  # merging into main deploys to production
```

Merge order: feat/proof-pays into main first, then feat/aim-high (or merge feat/aim-high alone, which brings both).

---

## 5. Local database

```bash
docker compose up -d                          # PostgreSQL 16 + pgvector on localhost:5432 (password: disha)
docker compose ps                             # is it running
docker compose logs -f db                     # database log
docker compose down                           # stop (data kept)
docker compose down -v                        # stop and delete all local data

python scripts/migrate.py                     # apply apps/api/migrations/*.sql not yet applied
python scripts/load_kb.py                     # copy packages/kb into the database
python scripts/migrate.py <database_url>      # against another database
```

Open a SQL prompt:

```bash
docker compose exec db psql -U postgres -d disha
```

Useful SQL (type inside psql):

```sql
\dt                                           -- list tables
\d evidence_event                             -- columns of a table
select id, name from school;
select code, role, school_id, revoked_at from join_code;
select id, school_id, role, revoked_at from device;
select count(*) from student;
select kind, count(*) from evidence_event group by kind order by 2 desc;
select * from evidence_event order by id desc limit 20;
select * from skill_state where student_id = '<id>';
select * from consent where student_id = '<id>';
select * from deletion_count;
select name, applied_at from schema_migrations order by 1;
\q                                            -- quit
```

---

## 6. Schools, classes and phones

```bash
python scripts/add_join_code.py school sch_psg "PSG Higher Secondary School" Coimbatore
python scripts/add_join_code.py class sch_psg PSG01            # prints the class code and a secret teacher code
python scripts/add_join_code.py revoke-code PSG01              # no new phones can join with it
python scripts/add_join_code.py revoke-device <device_id>      # switch off a lost phone
```

Add `--db "$DATABASE_URL"` to run against another database (for production, see section 13). Students type the class code on the New student screen; the teacher types the teacher code in Teacher view. The demo school is `sch_demo` ("Disha Demo School"); its codes are in `.env.codes`.

---

## 7. Run the app locally

API (terminal 1):

```bash
cd apps/api
python -m uvicorn app.main:app --reload --port 8000             # http://localhost:8000/docs
```

Web app (terminal 2):

```bash
VITE_API_URL=http://localhost:8000 npm run dev                  # http://localhost:5173
```

```powershell
$env:VITE_API_URL = "http://localhost:8000"; npm run dev
```

Other ways to run:

```bash
npm run dev                                   # web app alone: the student flow works fully offline
npm run build                                 # build apps/web/dist; the API then serves it at /
npm run preview -w apps/web                   # serve the built app
npm run assets -w apps/web                    # copy MediaPipe/ZK runtime files into public/ (runs before dev/build)
cd apps/web && npx vite --port 5185 --host    # another port, reachable from a phone on the same Wi-Fi
```

Open a phone on the same Wi-Fi at `http://<laptop IP>:5185`. Camera features need HTTPS or localhost.

---

## 8. Change each part

| To change | Edit | Then run |
|---|---|---|
| A screen | `apps/web/src/screens/<Screen>.tsx` | `npm run typecheck -w apps/web` |
| Text in Tamil or English | `apps/web/src/lib/i18n.ts` | typecheck |
| Icons, buttons, cards | `apps/web/src/components/Icon.tsx`, `ui.tsx` | typecheck |
| Colours and fonts | `apps/web/src/index.css` | rebuild |
| Facts asked (class, group, income) | `apps/web/src/data/facts.ts`, `screens/Facts.tsx` | typecheck |
| Skills, sub-skills, edges | `packages/kb/skills.json`, `packages/kb/graph/` | `python scripts/validate_kb.py` |
| Careers | `packages/kb/occupations.json` | validate_kb, `python scripts/gen_golden.py`, `npm test` |
| Schemes | `packages/kb/schemes.json` + `packages/kb/rules/<id>.json` (rule + test fixtures) | validate_kb |
| Test questions | `packages/kb/items/<skill>.json` | validate_kb, `python scripts/simulate.py --n 200` |
| Aptitude puzzles | `scripts/gen_aptitude.py` | `python scripts/gen_aptitude.py` |
| Work-sample checklists | `packages/kb/rubrics/` | validate_kb |
| Aim High tracks, exams, routes | `packages/kb/pathways/tracks.json`, `exams.json`, `graph.json` | validate_kb, `npm test -w packages/engine` |
| Aim High subjects and questions | `packages/kb/pathways/subjects.json`, `items.json` | validate_kb |
| Aim High maths | `packages/engine/src/pathways.ts` | `npm test -w packages/engine` |
| Matching, tracing, eligibility maths | `packages/engine/src/*.ts` and the Python twin `apps/api/app/services/*.py` | `python scripts/gen_golden.py`, `npm test`, pytest |
| An API endpoint | `apps/api/app/routers/v1.py`, `v2.py`, `see.py`, `proof.py` | pytest |
| AI prompts and fallback | `apps/api/app/adapters/` | pytest |
| Database schema | new file `apps/api/migrations/0010_<name>.sql` | `python scripts/migrate.py` |
| ZK circuit | `packages/zk/circuits/skill_proof.circom` | section 11 |
| Payout contract | `contracts/src/ProofPays.sol` | section 12 |
| Deploy settings | `Dockerfile`, `render.yaml`, `scripts/start.sh` | section 13 |

After a knowledge-base change on the live site, the next deploy reloads it (start.sh runs load_kb.py).

---

## 9. Tests and checks

```bash
npm test                                      # engine tests + ZK tests + web type check (same as CI)
npm test -w packages/engine                   # engine only (includes pathways.test.ts)
node --test packages/engine/test/pathways.test.ts   # one test file
npm test -w packages/zk                       # ZK tests
npm run typecheck -w apps/web                 # TypeScript check of the app
npm run build                                 # production build (CI runs it)

python scripts/validate_kb.py                 # knowledge base, incl. pathways files
python scripts/check_privacy.py               # privacy rules (CI)
python -m pytest apps/api/tests -q            # API suite (needs the local database running)
python -m pytest apps/api/tests/test_proof_pays.py -q   # one file
python -m pytest apps/api/tests -q -k fairness          # by name

python scripts/gen_golden.py                  # after engine maths changes: regenerate shared results
```

Benchmarks and reports:

```bash
python scripts/simulate.py                    # adaptive test on 500 simulated students -> docs/benchmarks/
python scripts/simulate.py --n 200            # quicker
python scripts/load_test.py --url http://localhost:8000 --code LOAD01 --phones 200 --events 50
python scripts/load_test.py --url <url> --code LOAD01 --cleanup          # delete the test students after
python scripts/rater_stats.py                 # teacher leniency and agreement
python scripts/calibrate.py                   # recalibrate questions from pilot answers (report)
python scripts/calibrate.py --events pilot.json --write                  # update packages/kb/items
python scripts/pilot_report.py --simulate     # dry-run pilot report
python scripts/pilot_report.py --teacher teacher.csv --survey survey.csv
python scripts/make_pilot_pack.py             # rebuild docs/Disha_Pilot_Pack.docx
```

CI (`.github/workflows/ci.yml`) runs on every push to main and every pull request: `npm ci`, `npm test`, `npm run build`; then validate_kb, check_privacy and pytest against a pgvector service.

```bash
gh run list                                   # recent CI runs
gh run view <id> --log-failed                 # why a run failed
```

---

## 10. Call the API directly

```bash
API=http://localhost:8000                     # or https://disha-pa6e.onrender.com

curl $API/health
curl $API/v1/kb | head -c 600

curl -X POST $API/v1/match -H "Content-Type: application/json" \
  -d '{"persona":{"education":"class10","riasec":{"A":0.8,"E":0.6},"skills":[{"id":"sk_stitching","confidence":0.7}]},"k":5}'

curl -X POST $API/v1/eligibility -H "Content-Type: application/json" \
  -d '{"facts":{"age":16,"gender":"female","state":"TN","category":"sc","current_class":10,"stage":"school","school_type":"govt","family_income_inr":90000}}'

# register a test phone with a class code, get a device token
curl -X POST $API/v2/devices -H "Content-Type: application/json" -d '{"device_id":"test-laptop-1","code":"<CLASS CODE>"}'
TOKEN=<device_token from the reply>

curl -X POST $API/v1/profile/extract -H "Authorization: Bearer $TOKEN" \
  -F question="What work do you do at home?" -F text="I stitch blouses for my neighbours"

curl $API/v2/pay/config                       # Proof Pays: contract, issuer key, milestones
curl $API/v2/ai-rater -H "Authorization: Bearer $TOKEN"
```

**Schemes are fetched by the phones** from `GET /v1/schemes` (with an ETag; they keep the last list for offline use, and the bundled `packages/kb` copy is the first seed). Add or change a scheme without a new app release:

```bash
curl $API/v1/schemes | head -c 400
# body: {"scheme": {...same fields as packages/kb/schemes.json...}, "rule": {...same as packages/kb/rules/<id>.json, with fixtures...}}
curl -X PUT $API/v1/schemes/sch_new_one -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" --data @scheme.json
curl -X DELETE $API/v1/schemes/sch_old_one -H "X-Admin-Token: $ADMIN_TOKEN"   # hides it from every phone
```

A change is refused (422) unless every fixture in the rule gives its expected answer. Phones pick up the new list within 10 minutes or on their next start; the server within 60 s. Run the migrations first (`0010_scheme_catalog.sql`).

Skill IDs for `/v1/match` are the `id` values in `packages/kb/skills.json` (for example `sk_stitching`, `sk_selling`). Revoke test phones afterwards (section 6). In PowerShell use `curl.exe` (not the `curl` alias) and put the JSON in a file: `curl.exe -X POST $API/v1/match -H "Content-Type: application/json" --data "@body.json"`.

---

## 11. ZK package (Proof Pays)

```bash
npm test -w packages/zk                       # Poseidon, EdDSA, credential, proof tests
npm run build:circuit -w packages/zk          # circom -> R1CS + WASM -> Groth16 keys -> Solidity verifier
python scripts/gen_zk_fixtures.py             # Python-made fixtures the TypeScript tests check against
python -m pytest apps/api/tests/test_proof_pays.py -q   # credential signing and claims
```

`build:circuit` needs circom 2.2 on PATH and writes `apps/web/public/zk/` (wasm, zkey, verification key) and `contracts/src/Groth16Verifier.sol`. The setup uses one local contribution: a demo setup, not for real money.

---

## 12. Contracts and the local chain (Proof Pays)

```bash
cd contracts
forge build                                   # compile
forge test -vv                                # 9 contract tests
cd ..

anvil                                         # local chain on 127.0.0.1:8545 (separate terminal; prints test keys)
python scripts/deploy_contracts.py --rpc http://127.0.0.1:8545 --key <anvil account 0 private key>
# writes contracts/deployments/31337.json and funds demo milestones
```

Run the API against the local chain:

```bash
export CHAIN_RPC_URL=http://127.0.0.1:8545
export CHAIN_DEPLOYMENT=contracts/deployments/31337.json
export RELAYER_PRIVATE_KEY=<an anvil test key>
export ZK_ISSUER_KEY=<hex from section 3>
cd apps/api && python -m uvicorn app.main:app --port 8000
```

Look at the chain:

```bash
cast block-number --rpc-url http://127.0.0.1:8545
cast logs --rpc-url http://127.0.0.1:8545 --address <proofpays address from 31337.json>
cast call <token address> "balanceOf(address)(uint256)" <payout address> --rpc-url http://127.0.0.1:8545
```

Sepolia (next step):

```bash
python scripts/deploy_contracts.py --rpc $SEPOLIA_RPC_URL --key $DEPLOYER_KEY \
  --explorer https://sepolia.etherscan.io --public-rpc <public rpc>
```

Then fund the relayer from a faucet and set `ZK_ISSUER_KEY`, `RELAYER_PRIVATE_KEY`, `CHAIN_DEPLOYMENT` (and `CHAIN_RPC_URL`) on Render.

---

## 13. Deployment (Render + Supabase)

How it deploys: push or merge to `main` -> Render builds the `Dockerfile` (web app, then Python image) -> `scripts/start.sh` runs `migrate.py`, `load_kb.py`, then uvicorn on `$PORT` -> live at https://disha-pa6e.onrender.com. Settings live in `render.yaml`.

```bash
git switch main && git pull
git merge feat/proof-pays                     # or merge a pull request on GitHub
git push                                      # starts a deploy
```

Watch and manage it in the Render dashboard (service `disha`):

| Task | Where |
|---|---|
| Deploy progress and build log | Events, then the deploy |
| Live server log | Logs |
| Environment variables | Environment (DATABASE_URL, GEMINI_API_KEY, CORS_ORIGINS, ADMIN_TOKEN, WEB_CONCURRENCY, DB_POOL_MAX; Proof Pays adds ZK_ISSUER_KEY, CHAIN_RPC_URL, CHAIN_DEPLOYMENT, RELAYER_PRIVATE_KEY) |
| Redeploy without a push | Manual Deploy, then Deploy latest commit |
| Roll back | Events, pick an older deploy, Rollback |
| Restart | Manual Deploy, or Restart service |

Check it after a deploy:

```bash
curl https://disha-pa6e.onrender.com/health
```

Build and run the production image on your laptop first:

```bash
docker build -t disha .
docker run --rm -p 8000:8000 --env-file .env -e DATABASE_URL=postgresql://postgres:disha@host.docker.internal:5432/disha disha
# open http://localhost:8000
```

Supabase (production database):

| Task | How |
|---|---|
| Browse tables | Supabase dashboard, Table Editor |
| Run SQL | Supabase dashboard, SQL Editor (same SQL as section 5) |
| Connection string | Connect button, Session pooler (IPv4), port 5432; percent-encode the password |
| Pool limit | Free tier pool is 15; keep WEB_CONCURRENCY x DB_POOL_MAX under it (2 x 5) |

Run scripts against production (loads `.env.supabase` into this shell only):

```bash
set -a; . ./.env.supabase; set +a
python scripts/migrate.py "$DATABASE_URL"
python scripts/load_kb.py "$DATABASE_URL"
python scripts/add_join_code.py --db "$DATABASE_URL" class sch_demo DEMO02
python scripts/add_join_code.py --db "$DATABASE_URL" revoke-device <device_id>
psql "$DATABASE_URL"                          # SQL prompt on production (needs psql installed)
```

Do not run pytest in a shell that has loaded `.env.supabase`.

Free-plan notes: the service sleeps after idle time (open /health a minute before a demo); the Supabase free project pauses after a week without use (resume it from the dashboard).

---

## 14. See what is on a phone or in a browser

Disha keeps each phone's data in IndexedDB (database `disha`, through Dexie).

| To see | How |
|---|---|
| Students, events, skill cache on this browser | DevTools (F12), Application, IndexedDB, disha |
| Aim High answers and plan | Same, table `meta`, key `aim.<student id>` |
| Device token | DevTools, Application, Local storage, key `device_token` |
| Phone id and sync cursor | IndexedDB disha, table `meta`, keys `device_id` and `event_cursor` |
| Network calls to the API | DevTools, Network |
| Errors | DevTools, Console |
| Installed app (PWA) and offline cache | DevTools, Application, Service workers and Cache storage |
| Phone in Chrome on Android | chrome://inspect on the laptop, phone connected by USB with USB debugging on |
| Start fresh | DevTools, Application, Storage, Clear site data (erases every student on that browser) |

Test offline: DevTools, Network, set throttling to Offline, then use the student flow.

---

## 15. Demo routes

| Route | What opens |
|---|---|
| `/` | Home: students on this phone, New student, Teacher view |
| `/?funder` | Funder dashboard (Proof Pays branch) |
| `/?confirm=<token>` | Buyer confirmation page from a one-time link |
| `/docs` | API documentation |
| Teacher view, Load demo class | Meena, Karthik and Arun as demo stories (never synced) |
| Results, Aim High tab | Aim High (feat/aim-high branch) |
| `/?xray=1` | Decision X-ray panel on (right side on a laptop, bottom tab on a phone). `/?xray=0` turns it off. Holding the Disha logo for 1 second also toggles it |
| `/?xray=replay` | Opens a saved X-ray session file and replays it step by step (works offline) |
| Home, How Disha decides | Every rule, formula, guardrail and AI task, with constants and source file |
| Results, Jobs tab | Internships, apprenticeships, jobs, mentors and trainings: Ready / Almost / Later, apply in the app |
| Results, Map tab | The student's knowledge graph (also from Teacher view, open a student, Map) |

### Demo script: show what is a rule and what is AI (about 4 minutes)

1. Run the API and the app (section 7) and open `http://localhost:5173/?xray=1` on a laptop connected to the projector. Use full screen, at least 1280 px wide, so the X-ray sits beside the phone-sized app. In the X-ray, press **Clear**.
2. **New student**, born 2006 → **Finished studies, looking for work** → **I read easily**. The X-ray shows `RULE · rule.uimode`: *age 20 ≥ 17 and reads easily → voice/text mode*. Tap the line to open its flowchart.
3. Consent is **I am 18 or older**. Switch to **हि** (Hindi). The app opens straight on *Tell us what you like* (voice/text mode).
4. Speak or type in Hindi, for example: *मुझे बच्चों को पढ़ाना पसंद है और मैं मोबाइल ठीक करना सीखना चाहती हूँ*.
   - **Online with Gemini:** the line reads `AI → RULE-CHECKED · ai.interests`. Open it to show the letters kept, each with its quote, and anything the rule rejected.
   - **Offline:** the line reads `RULE · rule.interest_keywords`, so the same feature works without AI.
5. Answer a skills question by typing. The X-ray shows the skills found and the skill-list check.
6. Finish the facts screen and open **Results**. Thirty to forty `RULE` lines arrive at once:
   - every career with **score = 0.4·Fit + 0.35·Reach + 0.25·Worth** and its real numbers;
   - every scheme with its conditions marked ✓ / ✗ / ?;
   - every opportunity marked Ready / Almost / Later.
7. On a career card, tap **Why?** to show the flowchart (input → formula with numbers → result). Do the same on a scheme card.
8. In the **Careers** tab, tap **Show me more ideas**. The line reads `AI → RULE-CHECKED · ai.suggest_careers`: the AI suggested careers, the catalogue check dropped any it invented, and the same formula scored the rest. *The AI never ranks.*
9. Open the **Map** tab and tap a career node, then **Why?**.
10. Point to the counters at the top of the X-ray: *N rule decisions · M AI steps · K AI items rejected by rules*.
11. Picture mode, as a contrast: a new student born 2013, **In school, Class 8**, **Someone helps me**. The X-ray shows `rule.uimode → picture`, and the cards are big, read aloud, with **Skip — I'll tell you in my own words** and **I don't know yet** always visible.

**Backups:**
- After a good run, press **Save** in the X-ray. If the network fails during the demo, open `/?xray=replay` and load that file.
- To replay AI answers without internet, record them once with `DEMO_CACHE=record`, then run with `DEMO_CACHE=1`. Use demo inputs only, never real students.
- Record the run with OBS (free) as a final fallback.

To regenerate the rules document after changing a rule: `node scripts/gen_decisions_doc.ts` (writes `docs/HOW_DISHA_DECIDES.md`).

---

## 16. When something goes wrong

| Symptom | Check |
|---|---|
| Live site slow on first open | Free plan waking up; wait about 70 s |
| /health says keyword mode | GEMINI_API_KEY missing or wrong on Render; check the Render log for the Gemini error |
| Gemini 404 | Model name: use gemini-3.5-flash |
| "too many clients" from Postgres | Lower DB_POOL_MAX or WEB_CONCURRENCY |
| CORS error in the browser | Add the page's origin to CORS_ORIGINS |
| 401 on /v2 calls | Phone not registered, token revoked, or wrong school |
| Credential returns 503 | ZK_ISSUER_KEY not set |
| Pay claim fails | CHAIN_RPC_URL, CHAIN_DEPLOYMENT, RELAYER_PRIVATE_KEY set? Relayer has test gas? |
| Camera does not start | Page must be HTTPS or localhost; allow camera permission |
| pytest wipes a database | DATABASE_URL pointed at the wrong database: never run tests after loading .env.supabase |
| Build fails on Render | Read the build log; run `docker build -t disha .` locally |
