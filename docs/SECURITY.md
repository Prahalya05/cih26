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

## 6a. Sign-in, documents, identity and donor checks (added 21 Nov 2026)

- **Sign-in for every role** (student, teacher, donor, employer/customer) with a phone number or email and a 6-digit one-time code (`apps/api/app/routers/accounts.py`, migration `0011_accounts.sql`).
  - The phone number or email is **never stored in readable form**: only `HMAC-SHA256(AUTH_SECRET, login)` to find the account, plus a masked copy (`98•••••210`) to show back.
  - Codes: only a hash is kept; 10 minutes, 5 tries, one use; a new code kills the old ones; rate limited per address.
  - The **role of a student or teacher comes from the school's code**, never from the phone. Donors and employers have no school, so row-level security shows them no student rows.
  - Sign-out kills the token on the server; "Delete my account" removes the sign-in.
  - Without an SMS/email provider the code is shown on screen (`OTP_DEMO=1`). For a pilot: set `OTP_DEMO=0`, SMTP settings (or an SMS gateway), and a long random `AUTH_SECRET`.
- **Documents** (`routers/trust.py`, migration `0012_trust.sql`): the photo goes to the AI once for a first look and is **never stored on the server**. The AI's note has ID-like numbers removed. Only the status (uploaded / verified / rejected) is kept, and only a **teacher who saw the original** can mark it verified.
- **Identity in task videos** (`apps/web/src/lib/identity.ts`, rule `rule.identity`): her face descriptor is made and kept **only on her phone**; a liveness challenge (show N fingers) and a face match run on the phone; only the distances and finger counts are sent, and the server re-runs the same rule.
- **Donors** see a pseudonym (`S-3F9A1C`, an HMAC of the student id), district, skill and the ✓/✗ of each check (`GET /v2/funder/paycheck`), never a name, and only for students whose family agreed to share.
- **Employers** see an applicant's first name, skills (verified or "says she can"), and which documents are verified. Never a phone number: contact goes through the school.
- **Customers** confirming a job are told what is kept (three answers) and what is never asked (phone, address, location), must agree first, and their name is kept only if they opt in.
- **Paid-job confirmation hardening (`rule.order_verify`, `0014_order_hardening.sql`):**
  - Confirmation tokens are carried in the URL fragment (`/#confirm=...`) and sent in POST bodies (`/v2/confirm/info`, `/v2/confirm`) so tokens never enter server access logs.
  - Anti-self-confirm: a salted HMAC fingerprint of the creator's IP + User-Agent is stored at link creation; matching confirmations are downgraded to `unverified` (no Level 4 unlock). Per-student limits cap links at 5/day and confirmations at 5/week, and `/v2/confirm*` is rate-limited (15/min).
  - Optional buyer phone OTP stores only `HMAC-SHA256(AUTH_SECRET, phone)` (never the raw number).
  - Teacher verification bypass (`POST /v2/orders/{id}/teacher-verify`, teacher role only, same school) requires a verification method and written reason.
- **Location-aware teacher search (`0015_teacher_search.sql`, `FindTeacher.tsx`, `courses.py`):**
  - Teachers are **never** listed publicly unless they explicitly opt in (`listed = true`, default `false`).
  - "Use my location" computes the nearest district centroid from `packages/kb/districts.json` **on the phone**, discards the GPS coordinates immediately, and sends only the coarse `district_code`.
  - `GET /v2/teachers/search` rejects raw coordinates (`lat`/`lng`/`gps`), is rate-limited (`30/min`), and returns only rating-free public fields (`name`, `avatar`, `subjects`, `languages`, `district`, `courses`, `distance_km`), never `pincode` or contact details.
  - `scripts/check_privacy.py` blocks any GPS/coordinate columns (`lat`, `lng`, `latitude`, `longitude`, `gps`, `coords`) from appearing in any database migration.
- **Opt-in profile publishing (`rule.publish`, `guard.publish`, `0016_publish_profile.sql`, `publish.py`):**
  - Off by default (`publish_profile` scope). Minors or unknown age can **never** publish `public` (`verified_partners` at most, with guardian consent via paper form or guardian OTP storing only `HMAC(AUTH_SECRET, phone)`).
  - Server builds the snapshot from a strict allow-list (`ConfigDict(extra="forbid")`): pseudonym handle, avatar, district, age band, verified skills, interest tags, and school name for 18+ adults only. Never caste, income, gender, phone, birth date, documents, or free text.
  - Public links use a 128-bit slug (`/#public=<slug>`), `X-Robots-Tag: noindex`, `Cache-Control: no-store`, rate-limiting (`20/min`), and aggregate-only daily view counts (`published_profile_views`). Unpublishing, withdrawing consent, or deleting the student removes the snapshot immediately.
  - `student_private` columns are encrypted with `pgcrypto` (`pgp_sym_encrypt`).
  - Teachers are **never** listed publicly unless they explicitly opt in (`listed = true`, default `false`).
  - "Use my location" computes the nearest district centroid from `packages/kb/districts.json` **on the phone**, discards the GPS coordinates immediately, and sends only the coarse `district_code`.
  - `GET /v2/teachers/search` rejects raw coordinates (`lat`/`lng`/`gps`), is rate-limited (`30/min`), and returns only rating-free public fields (`name`, `avatar`, `subjects`, `languages`, `district`, `courses`, `distance_km`), never `pincode` or contact details.
  - `scripts/check_privacy.py` blocks any GPS/coordinate columns (`lat`, `lng`, `latitude`, `longitude`, `gps`, `coords`) from appearing in any database migration.
- **Teacher overrides** of a skill level need a written reason, keep the computed level beside them, and a raised level never counts as proof for a payout.

- **Course payments** (`routers/courses.py`, `adapters/razorpay.py`): the server sets the price and creates the Razorpay order; a lesson unlocks only after the server checks `HMAC-SHA256(key_secret, order_id|payment_id)` against Razorpay's signature. No card or UPI data reaches Disha. Locked lessons are sent as titles only, and quiz answers never leave the server. Without Razorpay keys the app uses a labelled demo payment (`PAYMENTS_DEMO=1`) where no money moves.

## 7. Still open (before a real pilot)

1. Guardian OTP as a second consent method, in addition to the paper form.
2. ~~Per-teacher PIN on shared phones~~ replaced by per-person sign-in (6a). Still open: a real SMS gateway for phone OTPs (today email via SMTP, or demo mode).
3. ~~Encrypt `student_private` columns at rest with pgcrypto, with the key in the host's secret store.~~ Added `pgcrypto` `pgp_sym_encrypt` (`name_enc`, `phone_enc`, `guardian_name_enc`) in `0016_publish_profile.sql`.
4. ~~Move buyer-confirmation tokens out of URLs, so they never reach access logs.~~ Done via URL fragment (`/#confirm=`) and POST-body confirm endpoints (`POST /v2/confirm/info`, `POST /v2/confirm`).
5. Drop the legacy `legacy_student_doc` table, which still holds names as JSON.
6. Move rate-limit counters to Postgres or Redis if the API runs on more than one instance.
7. Complete a DPDP checklist with the pilot NGO: privacy notice in Tamil and Hindi, grievance officer, breach procedure within 72 hours, retention period, and deletion at the end of the pilot.
8. Run an outside security review and a dependency audit (`npm audit`, `pip-audit`) in CI.
