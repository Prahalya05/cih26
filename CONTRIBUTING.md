# Contributing to Disha

Thank you for contributing! Before opening a pull request, please run the local checks:

```bash
npm test
npm run build
python scripts/validate_kb.py
python scripts/check_privacy.py
cd apps/api && python -m pytest -q
```

---

## 1. How to Add a Language

1. **Web UI strings (`apps/web/src/lib/i18n.ts`):**
   - Add the new language code to the `Lang` union type.
   - Add a translation object containing every key present in the `en` dictionary.
   - Expose the language option in the language selector (`apps/web/src/screens/Privacy.tsx` / `App.tsx`).
2. **Knowledge base (`packages/kb/`):**
   - Add the new language key to multilingual `{ "en": "...", "ta": "..." }` objects in `skills.json`, `occupations.json`, `schemes.json`, `graph/subskills.json`, `graph/aptitudes.json`, `items/*.json`, and `rubrics/*.json`.
3. **Server TTS (optional, `apps/api/app/routers/v1.py` & `apps/api/app/adapters/gemini_tts.py`):**
   - Add the language code to `TtsRequest.lang` if spoken prompts are supported.
4. **Verify:** Run `python scripts/validate_kb.py` and `npm test`.

---

## 2. How to Add a Career

1. Open `packages/kb/occupations.json`.
2. Add an entry with:
   - `id`: unique slug (e.g. `occ_solar_technician`)
   - `name`: multilingual object (`{ "en": "...", "ta": "..." }`)
   - `sector`: sector key matching existing occupations
   - `education_min`: minimum education level (`class8`, `class10`, `class12`, `iti`, `diploma`, `ug`, `pg`)
   - `riasec`: weights across `R`, `I`, `A`, `S`, `E`, `C`
   - `needs`: map of `subskill_id` -> target level (`1`–`4`)
   - `aptitudes`: map of `aptitude_id` -> target score
   - `demand`: `"high"`, `"medium"`, or `"low"` (Tamil Nadu local demand)
3. **Verify:**
   ```bash
   python scripts/validate_kb.py
   python scripts/gen_golden.py
   npm test
   cd apps/api && python -m pytest tests/test_engine.py -q
   ```

---

## 3. How to Add a Scheme Rule

1. **Bundled catalogue (`packages/kb/schemes.json`):**
   - Add an entry with `id`, `name`, `benefit`, `apply_url`, and a JsonLogic `rule` using only facts defined in `packages/kb/facts.json` (so rules run identically offline on the phone and on the server).
2. **Dynamic catalogue (pilot/admin):**
   - Alternatively, POST the scheme + JsonLogic rule to `POST /v1/admin/schemes` using `ADMIN_TOKEN` (stored in `scheme_catalog` and fetched by phones via `GET /v1/schemes`).
3. **Verify:**
   ```bash
   python scripts/validate_kb.py
   python scripts/gen_golden.py
   npm test
   ```

---

## 4. How to Add a Partner

1. **Partner account (Employer / Donor):**
   - Sign in via `POST /v2/auth/otp` and `POST /v2/auth/verify` with role `employer` or `donor`. Partners have no `school_id`, so Postgres row-level security blocks access to raw school/student tables.
   - Employers read opted-in, allow-listed student profiles via `GET /v2/partners/profiles`.
   - Donors read anonymised milestone checks via `GET /v2/funder/paycheck`.
2. **API-only partner integration:**
   - Public v1 endpoints (`/v1/kb`, `/v1/schemes`, `/v1/careers/suggest`) are documented at `/docs`.
3. **Proof Pays funder:**
   - Fund a milestone on `ProofPays` (`createMilestone`) on Sepolia (see `docs/SEPOLIA.md`) and verify with `python scripts/verify_deployment.py --chain 11155111`.
