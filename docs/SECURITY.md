# Security and privacy of students' personal details

Disha serves minors in rural India. These are the rules the code follows to protect them. Each item names the file
that enforces it, so a reviewer can check the claim. The law it is written against is the **Digital Personal Data
Protection Act, 2023 (DPDP)**, especially Section 9 (children's data: verifiable parental consent, no tracking, no
targeted advertising).

## 1. What we collect, and what we don't

| Data | Where it lives | Why |
|---|---|---|
| Name, avatar, birth year, class code | On the phone (IndexedDB). On the server, name and phone are only in `student_private` | So the student and teacher can recognise the record |
| Situation (in school / working ...), reading comfort | On the phone, synced as part of the student record | Picks the kind of screens she gets (rule `rule.uimode`) |
| Answers, test results, ratings, paid jobs | Append-only evidence events, pseudonymous student id | Skill levels are rebuilt from these |
| Gender, category, family income band | On the phone, as fact answers | Only to check scheme eligibility (JsonLogic, on the phone) |
| **Voice recordings** | **Never stored.** Processed in memory, then dropped | Speech to text |
| **Photos and videos of work** | **Stay on the phone.** Video faces are blurred on the phone before upload; the server scores in memory and keeps only the scores | Work-sample scoring |
| Aadhaar, bank details, phone contacts, location | **Not collected** | — |

Data minimisation is enforced in CI: `scripts/check_privacy.py` fails the build if a personal-looking column appears
outside `student_private`, or if any analytics or tracking SDK is added to the app.

## 2. Consent

- **Scopes, each switched on separately** (`apps/web/src/screens/Consent.tsx`):
  - `assess`: needed.
  - `photos`: needed for AI scoring of work photos and videos.
  - `share_portfolio`: needed for credentials and Proof Pays.
- **Under 18 or age unknown:** a parent's signed paper form, kept by the facilitator, is recorded as the consent method.
- **Self-consent:** only when the student is certainly 18 or older (`currentYear − birthYear ≥ 19`), because the birth month is not asked. Rule `rule.consent_age`, code `packages/engine/src/safety.ts`.
- **The server checks the scopes again; the app is not trusted:**
  - Video and photo scoring refuse without `photos` (`apps/api/app/routers/see.py`).
  - `/v2/credential` refuses without `share_portfolio`.
- **Withdraw:** the Privacy screen stops syncing in both directions at once.
- **Delete:** `DELETE /v2/student/{id}` erases everything except an anonymous daily count.

## 3. Who can see what

- **Phones register with a join code** and get a device token. Only the SHA-256 hash of the token is stored, and tokens can be revoked (`apps/api/app/auth.py`, migration `0008_devices.sql`).
- **Row-level security** in Postgres limits every query to the phone's own school (`migrations/0003_security.sql`, `app.school_ids`).
- **The analytics role cannot read `student_private`.**
- **Teacher-only actions** (endorse, recommend, ratings) need a phone registered with a teacher code.
- **Employers and partners** see an applicant's first name, readiness and skill summary only, never facts like caste or income.
- **Buyers confirming a paid job** see the student's first name only, through a one-time link.
- **Proof Pays:** the funder learns only that the milestone rule was met. A zero-knowledge proof keeps her name, exact levels, income and caste on the phone.

## 4. AI and personal data

- **Only three kinds of input go to the AI:**
  - an answer's text or audio,
  - a face-blurred work video or photo,
  - interest and skill ids for career ideas.
- **Names, facts (caste, income) and ids are never sent to the AI.** The career-ideas call (`/v1/careers/suggest`) receives only RIASEC numbers, skill ids and education level.
- **Every AI output is checked by a rule before use:**
  - unknown ids are dropped;
  - quotes must really appear in what she said;
  - careers must come from the catalogue.
  - See `apps/api/app/services/guards.py` and `docs/HOW_DISHA_DECIDES.md`.
- **The AI never decides** eligibility, levels, rankings or payouts.
- **AI routes need a registered phone** and are rate-limited.
- **Before real students:** switch to a paid-tier Gemini key, because free-tier inputs may be used by Google to improve its products.
- **Demo cache:** `DEMO_CACHE` (`apps/api/app/adapters/demo_cache.py`) stores AI answers for demos. It must never be switched on with real students.

## 5. Abuse protection added in this round

- **Rate limits** (`apps/api/app/ratelimit.py`):
  - `POST /v2/devices`: 10 per minute per address, so class codes can't be guessed by brute force.
  - The AI routes (`/v1/profile/extract`, `/v1/profile/interests`, `/v1/careers/suggest`): 30 per minute per address, which protects the AI budget.
  - A blocked request gets HTTP 429 with `Retry-After`.
  - Tested in `tests/test_ai_checks.py`.
- **Logging rule:** never log student text, tokens or keys. The Gemini adapter logs only the model and the HTTP status when a call fails.

## 6. On the phone

- **Offline-first storage:** data lives in IndexedDB in the app's own origin.
- **Shared phones:** several students can use one phone, so each student record is separate and deletable.
- **Demo students** never leave the phone.
- **Decision X-ray log:** keeps decision summaries only, no names, in this browser's localStorage. "Clear" empties it.
- **Face blur** runs on the phone with MediaPipe. Filming is refused if the face model cannot start.

## 7. Still open (before a real pilot)

1. Guardian OTP as a second consent method, in addition to the paper form.
2. Per-teacher PIN on shared phones. Today a teacher code is per phone.
3. Encrypt `student_private` columns at rest with pgcrypto, with the key in the host's secret store.
4. Move buyer-confirmation tokens out of URLs, so they never reach access logs.
5. Drop the legacy `legacy_student_doc` table, which still holds names as JSON.
6. Move rate-limit counters to Postgres or Redis if the API runs on more than one instance.
7. Complete a DPDP checklist with the pilot NGO: privacy notice in Tamil and Hindi, grievance officer, breach procedure within 72 hours, retention period, and deletion at the end of the pilot.
8. Run an outside security review and a dependency audit (`npm audit`, `pip-audit`) in CI.
