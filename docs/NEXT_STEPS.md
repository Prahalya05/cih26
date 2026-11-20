# Disha — next build round (demo in < 3 days)

## Build status (updated 20 Nov 2026)

| Item | Status | Where |
|---|---|---|
| A. Decision registry, X-ray, "Why?" flowcharts, How Disha decides, replay | **Built** | `packages/engine/src/{registry,trace}.ts`, `apps/web/src/components/{XRay,WhyFlow}.tsx`, `screens/HowItDecides.tsx`, `docs/HOW_DISHA_DECIDES.md` |
| B. Onboarding by age, situation and reading (rule `uimode`) | **Built** | `packages/engine/src/uimode.ts`, `screens/Situation.tsx`, `Cards.tsx` (picture mode), `Questions.tsx` |
| C. Skip interests, using own words (voice or text) or "don't know yet" | **Built** | `screens/Talk.tsx`, `packages/engine/src/interests.ts`, `POST /v1/profile/interests`, `app/services/guards.py` |
| D. 62 careers (was 16), 32 opportunities, readiness rule, apply in the app | **Built** | `packages/kb/occupations.json`, `opportunities.json`, `packages/engine/src/readiness.ts`, `components/Opportunities.tsx` |
| D. AI wider career ideas (catalogue only, scored by the formula) | **Built** | `POST /v1/careers/suggest`, `Results.tsx` WiderOptions |
| D. Partner self-service screen, `0010` migration for orgs and applications | Not built. Applications travel as `apply` actions through the existing sync, and teachers see them | — |
| E. Each student's knowledge graph (student and teacher views) | **Built** | `packages/engine/src/persongraph.ts`, `components/PersonGraph.tsx`, `screens/Graph.tsx` |
| F. Hindi (core screens and all new screens, picture cards) | **Built**, needs a native-speaker review | `apps/web/src/lib/i18n.ts` |
| G. Teacher courses with Razorpay | **Built** (21 Nov): free / per lesson / subscription, Razorpay test mode or labelled demo payment, server signature check, quiz pass → skill evidence, course suggestions by rule, teacher earnings (90%) | `routers/courses.py`, `0013_courses.sql`, `screens/{Courses,Course,CourseBuilder,TeacherCourses}.tsx` |
| H. SECURITY.md, ROADMAP.md, HOW_DISHA_DECIDES.md | **Written** | `docs/` |
| Rate limits on device registration and AI routes | **Built** | `apps/api/app/ratelimit.py` |
| Demo cache for AI answers | **Built** | `apps/api/app/adapters/demo_cache.py` |

### Round 3 (21 Nov 2026): team's list + sign-in for everyone

| Item | Status | Where |
|---|---|---|
| Sign-in for all roles (phone or email + one-time code; demo shows code on screen) | **Built** | `routers/accounts.py`, `0011_accounts.sql`, `screens/SignIn.tsx`, `lib/auth.ts` |
| Standard app shell: role homes, bottom tabs, Account screen (language, privacy, sign out, delete) | **Built** | `components/BottomNav.tsx`, `screens/Account.tsx`, `App.tsx` |
| Tamil voice: server speech when the phone has no Tamil voice; live Tamil dictation while recording | **Built** | `POST /v1/tts` (`adapters/gemini_tts.py`), `lib/speech.ts` |
| Resume: made from her record (verified skills marked), add lines, read an old resume (AI, quote-checked) | **Built** | `screens/Resume.tsx`, `lib/resume.ts`, `POST /v2/resume/read` |
| Teacher override of a skill level, with reason (`rule.override`) | **Built** | `engine/src/trust.ts`, `components/TeacherTools.tsx` |
| Teacher and employer job posts; applications with status | **Built** | `screens/Jobs.tsx`, `/v2/postings`, `/v2/applications` |
| Teacher suggests internships/schemes with a note; student sees "Your teacher suggests" | **Built** | `TeacherTools.tsx` SuggestPanel, `Opportunities.tsx` MyJobs |
| Donor pay check: skill + verified need + consent + identity + once (`rule.paycheck`) | **Built** | `GET /v2/funder/paycheck`, `components/PayCheck.tsx` |
| Video identity: on-phone face match + finger-count liveness (`rule.identity`) | **Built**, needs testing on a real phone | `lib/identity.ts`, `components/IdentityGate.tsx` |
| System confirms clear videos itself, random 10% spot checks (`rule.autoconfirm`) | **Built** | `routers/see.py`, Teacher "confirmed by the system" list |
| Customer privacy consent on the job-confirmation page (`guard.buyer_privacy`) | **Built** | `ConfirmJob.tsx`, `v2.py` confirm |
| Job applications: documents checked (AI first look) and verified by teacher (`rule.apply_docs`) | **Built** | `screens/Docs.tsx`, `/v2/docs/*` |
| Teacher profile (public: bio, subjects, experience, courses) and detailed student profile | **Built** | `screens/TeacherProfile.tsx`, `screens/StudentProfile.tsx`, `/v2/teachers*` |
| Who does what: Disha / AI / teacher / student / donor / employer | **Written**, in app and docs | `screens/Roles.tsx`, `docs/RESPONSIBILITIES.md` |
| Photo and video proof for 12 skills (was 2), media type per checklist | **Built** | `packages/kb/rubrics/*.json`, `WorkSample.tsx`, Results "Show your work for another skill" |

The demo script is in `docs/Disha_Commands.md` §15.

## Context
The user reviewed Disha against the hackathon problem statement and found these gaps:
- The teacher module is thin. A teacher can only rate students and recommend them.
- Opportunities are thin. There are 16 careers, many of them basic (cooking, drawing), 9 schemes and only 2 job-type programmes, with no internships, jobs or apply flow.
- The split between rules and AI is invisible.

They asked for eight things:
1. Onboarding that adapts to age, situation and literacy.
2. A way to skip the interest cards.
3. A view of each student's knowledge graph.
4. A live view of each decision and whether a rule or the AI made it.
5. One place that documents every rule and formula.
6. A security write-up.
7. A concrete roadmap.
8. Teacher courses with free, pay-per-module and subscription plans.

Decisions so far: payments use **Razorpay test mode**, **Hindi is added** as a third language, and the demo is **less than 3 days away**. Work is therefore in priority tiers.

**Guiding rule for the whole round:** *rules decide, AI handles open-ended input.*
- **Rules, fixed and testable:** eligibility, skill levels, career scoring, opportunity readiness, which onboarding mode to use, safety, payouts.
- **AI, open-ended:** understanding free text and speech (interests and skills), suggesting careers *from a fixed catalogue only*, explaining results in the student's language, and scoring work samples as one rater among several.
- **Every AI output is checked by a rule before it is used.** The "decision X-ray" (item 4) makes this visible.

---

## Scope status (user, 20 Nov 2026)
- **Doing now:** B and C (onboarding), D (opportunities and wider careers), E (each student's knowledge graph), and A (X-ray, which is how the decisions get shown).
- **Probably future scope:** G (teacher courses and payments). The user will confirm which other parts move to future scope.
- **First step after approval:** copy this plan into the repo as `docs/NEXT_STEPS.md`.

## How the decision-making is shown in the demo
**Main plan: run it live on localhost (or the Render URL) and share the screen or projector.**
1. **Split-screen demo mode (`?xray=1`).**
   - **Left:** the app in a phone-sized frame.
   - **Right:** the X-ray panel, adding one line per decision as it happens.
   - Each line has a colour chip:
     - **RULE** (blue) shows the rule ID and the actual numbers, e.g. `fitreach: 0.4×0.72 + 0.35×0.55 + 0.25×0.80 = 0.68`.
     - **AI** (purple) shows the model and what it returned.
     - **AI→RULE-CHECKED** (purple then green) shows what the rule check kept or dropped.
   - The audience watches the app react while the reasoning appears beside it.
2. **"Why?" button on every result** (career, scheme, opportunity, skill level). It opens a small flowchart for that one decision:
   - Inputs → AI step (if any) → rule check → formula with real values → result.
   - Scheme rules show each condition with ✓ or ✗, e.g. `age 17 ≥ 14 ✓ · class ≥ 10 ✗`.
   - This is the slide-ready visual.
3. **Graph view link:** tapping a node in the student's map opens the same "Why?" flow for that node.
4. **End-of-run summary card** in the X-ray panel, e.g. "This session: 23 rule decisions, 4 AI calls, 1 AI suggestion rejected by rules". It is a one-line takeaway for judges.

**Backups, so a bad network can't sink the demo:**
- **Replay mode:** every X-ray session can be exported as JSON and replayed step by step (`?xray=replay`). This works without internet.
- **Cached Gemini answers** for the 3 demo personas (`DEMO_CACHE=1`). The AI steps still show, labelled "cached".
- **A screen recording** of the full run, made with OBS (free), to play if the live run fails.
- **Screenshots** of the "Why?" flowchart and the summary card for the deck.

## Tier 1: must be in the demo (days 1–2)

### A. One registry of decisions plus the decision X-ray (items 4 and 5)
This goes first, because every later feature reports into it.
- **New `packages/engine/src/registry.ts`.** One entry per rule or formula: `{id, title_en/ta/hi, kind: "rule"|"formula"|"ai"|"guardrail", file, constants, plain-language description}`.
  - It covers the fitreach weights (0.4/0.35/0.25), the tracing prior, evidence weights and half-lives, the IRT stop rules, each JsonLogic scheme rule, safety, RPL, pathways, rater kappa, the new onboarding-mode rule and opportunity readiness.
  - Constants are read from the existing modules, not copied.
- **New `packages/engine/src/trace.ts`.**
  - Each entry is a `Decision` `{id, at, step, source: "RULE"|"AI"|"AI→RULE-CHECKED", ref: registryId|model, inputs, output, why, ms}`, with a simple `tracer.emit()`.
  - Hook it into `fitreach.ts`, `eligibility.ts`, `tracing.ts` (one summary per fold, not one per event), `pathways.ts`, `safety.ts` and the new modules.
  - `jsonlogic.ts` gets an optional "record which leaf conditions passed or failed" mode, so a scheme decision shows e.g. `age 17 ≥ 14 ✓, income ≤ 8L ✓, class ≥ 10 ✗`.
  - Output values do not change, so the parity and golden tests stay green.
- **API:** the Gemini routes return a `trace` block next to the result:
  - Covers `/v1/profile/extract`, work-sample scoring, video scoring, and the new interest and career-suggestion routes.
  - Contents: model name, latency, raw AI output, which items the validator dropped, and the fallback used, if any.
  - Files: `apps/api/app/adapters/gemini.py`, `gemini_vision.py`, `gemini_video.py`, `routers/v1.py`, `v2.py`, `see.py`.
- **Web: `apps/web/src/components/XRay.tsx`.**
  - A drawer at the side or bottom that streams decisions as they happen: blue chip for RULE, purple for AI, purple then green tick for AI→RULE-CHECKED.
  - Tapping an entry opens its registry entry.
  - Switched on with `?xray=1` or a long-press on the logo, so the demo can be shown on a projector next to the app.
  - A store in `apps/web/src/lib/xray.ts` keeps entries in memory and saves the last 200 to Dexie.
- **`apps/web/src/components/WhyFlow.tsx`:** the "Why?" flowchart for one decision, drawn from that decision's trace entries in plain SVG. It also supplies replay mode and the session summary card.
- **New screen `apps/web/src/screens/HowItDecides.tsx` (item 5).**
  - Shows the end-to-end pipeline (input → AI understanding → rule checks → engine formulas → outputs).
  - Then one card per registry entry, with its formula, constants and source file.
  - Generated from the registry, so it never drifts from the code.
  - The same content is exported to `docs/HOW_DISHA_DECIDES.md` by a small script, `scripts/gen_decisions_doc.ts`.

### B. Onboarding that adapts to the student (item 1)
- **NewStudent / a new `Situation` step** (`screens/NewStudent.tsx`, a new `screens/Situation.tsx`, `App.tsx` route, `Home.tsx` `nextStep()`):
  - Age: birth year, asked **once**. Remove the duplicate `age` from `data/facts.ts` `FIRST_QUESTIONS` and work age out from the birth year.
  - Situation, as picture options: in school (which class), in college/ITI/diploma, stopped studying, finished and looking for work, working.
  - Reading: a spoken prompt asks "Can you read this?" with 3 picture answers: *I read easily / a little / someone helps me*.
- **New rule `packages/engine/src/uimode.ts`** (registry entry, emits a trace):
  - `picture`: age < 14, or reads "someone helps me".
  - `mixed`: age 14–16, or reads "a little".
  - `voice-text`: age ≥ 17 and reads easily.
  - Stored on `Student` (`lib/db.ts`: `scenario`, `literacy`, `uiMode`).
- **Screens follow the mode:**
  - **picture:** the large-emoji card deck (`Cards.tsx`), audio plays itself, minimal text, large tap targets.
  - **mixed:** cards plus text and a mic button.
  - **voice-text:** opens with "Tell us about yourself" (free text or speech), with cards available as optional help.
  - `Facts.tsx` hides questions that don't fit the situation (e.g. no school-type question for someone who is working) and uses spoken prompts in picture mode.
  - `Questions.tsx` chooses its default input the same way.
- Consent: settle the open "age 18 by birth year" issue here. The rule is that 18 or over may consent for themselves; written down in the registry.

### C. Skipping interests: free text or voice only (item 2)
- `Cards.tsx` gets a clear **"Skip — I'll tell you in my own words"** button on every card and on the deck's first screen, plus a **"Don't know yet"** option. Both are always visible, never hidden.
- **Free-text or voice path:** new route `POST /v1/profile/interests`. Gemini receives the transcript or audio and returns RIASEC letters, interest tags and quotes.
  - **The rule check:** it must quote the student's own words, and letters must be in the RIASEC set.
  - Offline fallback: a keyword map in `lib/keywords.ts` / `adapters/keywords.py`, extended to interest words in Tamil, English and Hindi.
  - The UI follows the existing `Questions.tsx:62-135` pattern (text box, mic, chips).
- `Home.tsx:11`: interests count as done when cards are answered **or** skipped with text/voice **or** "don't know yet". If interests are left blank, `fitreach` uses the neutral RIASEC value it already uses, and the X-ray shows "interest unknown → neutral".
- The `interest_choice` event payload gains `{mode:"cards"|"text"|"voice"|"skipped", text?}` (`lib/events.ts`).

### D. Wider careers and real opportunities (fixes "only cooking and drawing")
- **Careers:** `packages/kb/occupations.json` grows from 16 to about 60, covering:
  - IT/ITES, healthcare allied (lab tech, pharmacy asst, physiotherapy asst), logistics, retail, BFSI (insurance agent, BC agent), hospitality, renewable energy (solar PV technician), EV mechanic, food processing, agri-drone, CNC operator, welding, plumbing, beautician, content creation, translator, NGO field worker, paralegal, journalism, sports coach, and government exams (SSC, railways, TNPSC).
  - Each gets RIASEC, skills, education and `local_demand`. `scripts/validate_kb.py` checks them.
- **AI widening, kept grounded:** new route `POST /v1/careers/suggest`. Gemini sees the profile and the **catalogue IDs only**, and proposes 5 "you may not have thought of" careers with reasons.
  - **The rule check** drops any ID not in the catalogue, then `fitreach` scores the rest. The AI never ranks.
  - Shown in Results as "Wider options", tagged AI→RULE-CHECKED in the X-ray.
- **Opportunities:** new `packages/kb/opportunities.json` with about 35 listings:
  - Kinds: internship, apprenticeship, job, mentorship, training.
  - Real programmes: NAPS, NATS, PM Internship, DDU-GKY, PMKVY, Naan Mudhalvan, NCS portal.
  - Plus sample employer, NGO and MSME listings, clearly marked "sample".
  - Fields: org, org_type, district, stipend or wage, duration, `needs:[{subskill, level}]`, eligibility rule ID, closing date, seats, `apply: in_app|external`.
- **New rule `packages/engine/src/readiness.ts`**, combining the eligibility rule with the share of skills met from the profile:
  - **Ready**: ≥ 80% of the needed skills met and eligible.
  - **Almost**: 50–80% met, lists the gap and links to a course or pathway.
  - **Later**: below 50%, or not eligible yet.
  - Has a test.
- **Apply in the app:**
  - New `screens/Opportunities.tsx` (also a Results tab) and `screens/Apply.tsx`. Applying works offline: it is queued as an `apply` action and synced.
  - Migration `0010_opportunities.sql`: `org` (company, NGO or mentor), extended `opportunity`, and `application` (status submitted, viewed, shortlisted or rejected), with row-level security like `0003`.
  - Router `routers/opportunities.py`, with the data loaded by `scripts/load_kb.py`.
- **Partner onboarding (minimal):** `screens/Partner.tsx`, opened with a partner code.
  - An org posts a listing (validated against the same schema) and sees its applicants: first name, readiness and graph summary only.
  - A mentor registers skills and district and is matched to students by sub-skill overlap (a rule).

### E. Each student's knowledge graph (item 3)
- **New `packages/engine/src/persongraph.ts`:** `personGraph(profile, graph, careers, opps, interests)` returns `{nodes, edges}`.
  - Nodes: the student; interests; sub-skills sized by level and shaded by confidence; aptitudes; top careers; matched opportunities.
  - Edges: has-skill, needs (solid if met, dashed if a gap), interest→career, career→opportunity.
  - Has a test.
- **New `screens/Graph.tsx`:** plain SVG with a radial layout, no new dependency.
  - Rings: student → skills and interests → careers → opportunities.
  - Tapping a node opens a "why" panel with its evidence history (from `UnitState.history`) and links into the X-ray.
  - Adapts to the UI mode: in picture mode, icons and audio labels instead of text.
- **Entry points:** a "My map" tab in `Results.tsx`, and a "View map" button per student in `Teacher.tsx` `StudentRow`.

### F. Hindi (problem statement: multiple languages)
- `LangCode = "ta"|"en"|"hi"`.
- Add an `hi` block to `lib/i18n.ts`, `hi` fields in the new KB files, and a 3-way language switch in `components/ui.tsx`.
- Gemini prompts take the language.
- Existing KB items without `hi` fall back to `en`, with a validator warning.
- **Why Hindi:** it proves the language layer can be extended, which is a stated requirement. Native-speaker review stays on the open list.

## Tier 2: day 3

### G. Teacher module: courses, plans, talent spotting (item 8)
- **Migration `0011_courses.sql`:**
  - Tables: `teacher` (profile linked to `device`), `course`, `module` (text, video link or quiz in the `packages/kb/items` format, target sub-skill), `plan` (`free | per_module | subscription`, price in rupees, period), `enrolment`, `payment` (Razorpay order ID, status) and `subscription`.
  - Row-level security per teacher.
- **API:** `routers/courses.py` (create and publish courses, list courses for students, enrol), and `adapters/razorpay.py`.
  - The adapter uses test-mode keys from env and creates the order on the server.
  - **The server checks the payment signature with HMAC-SHA256 before unlocking anything.**
  - Free plans skip payment.
- **Web:**
  - `Teacher.tsx` gets tabs: Class · Talent · My courses · Earnings.
  - `screens/CourseBuilder.tsx`: title, target skill, modules, plan and price.
  - `screens/CourseDetail.tsx` and `Checkout.tsx` use Razorpay Checkout JS. It needs a connection, and the screen says so offline.
- **Course recommendation is a rule:** a course is suggested when its target sub-skill is in the student's gaps for a top career or an "Almost" opportunity.
- **Finishing a module's quiz** sends an evidence event, which updates the skill level and the graph. This closes the learn → prove loop.
- **Talent tab:** students sorted by Strong skills and readiness. "Recommend for an opportunity" extends the existing `recommend` action to opportunity IDs, and the recommendation shows on the student's application.

### H. Documents (items 5, 6, 7)
All in `docs/`; each is also linked from an in-app "About Disha" screen.
- `HOW_DISHA_DECIDES.md`: generated from the registry (see A). It adds the end-to-end flow diagram and the rules-versus-AI table.
- `SECURITY.md`:
  - **Already in place:** consent scopes and paper form; device tokens stored only as hashes; row-level security per school; personal data only in `student_private`; on-phone face blur; audio, photos and video never stored; zero-knowledge proofs keep income and caste on the phone; deletion leaves only anonymous counts; the CI privacy check.
  - **Added this round:**
    - Rate limiting with slowapi on `/v2/devices`, `/v1/profile/*` and `/v1/careers/suggest`.
    - pgcrypto encryption of `student_private` columns.
    - Buyer tokens moved out of URLs and access logs.
    - A logging policy (never log PII or tokens).
    - Razorpay signature check, with no card data touching our servers.
  - **Still open:** paid Gemini tier before real students, guardian OTP, per-teacher PIN, DPDP Act 2023 checklist.
- `ROADMAP.md`, concrete and dated:
  - **Month 0–1:** a 2-district Tamil Nadu pilot (5 schools, 10 teachers, 300 students), Tamil and Hindi native-speaker review, Sepolia deploy.
  - **Month 2–3:** Bhashini speech recognition and text-to-speech for 10 languages, offline on-phone speech recognition (Vosk or Whisper-tiny), the RAG counsellor, NCS/NAPS API feeds.
  - **Month 4–6:** partnerships with state skill missions and NGOs, CSR funders through Proof Pays, a revenue model, and 5 states.
  - **Month 7–12:** DigiLocker credentials, employer self-serve, open-source contributor programme.
  - **Revenue model:**
    - 10% commission on teacher courses.
    - Employer listing fees.
    - CSR payouts through Proof Pays.
  - **KPIs:** students profiled, applications, placements, teacher income.

## Tier 3, if time is left (else roadmap)
- An **"Ask Disha" counsellor**: Gemini function calling over engine tools (`check_eligibility`, `match_careers`, `readiness`, `find_courses`), grounded in the KB JSON. Each tool call shows in the X-ray as a RULE step. This is the light version of the planned MCP + RAG layer.
- Clean up `matcher.ts` versus `fitreach.ts` (two career rankers).

---

## What else the problem statement asks for (gap list)
| PS requirement | Status after this plan |
|---|---|
| Local language, voice in and out | ta/en/hi. Speech recognition is online only, so **offline speech recognition goes on the roadmap** |
| LLM with a knowledge base of schemes, exams, courses, apprenticeships | KB grows (opportunities, courses). **The full RAG counsellor is in Tier 3 or the roadmap.** The schemes list is still only 9, so grow it to about 25 (central plus more states) |
| Career matching that widens options | Done via D: catalogue of about 60 plus AI suggestions checked by rules |
| Scholarships, schemes, apprenticeships, mentors, employers matching | Done via D: mentors matched by rule, employers through Partner |
| Mentor, corporate and NGO onboarding, with a way to apply | Partner screen plus in-app apply (D) |
| Teachers spot talent and recommend | Talent tab (G) |
| Teacher modules: free, per-module, subscription | G |
| Low-end Android | **Still to do:** a bundle-size and Lighthouse check on a throttled profile, and lazy-loading the new screens |
| Offline sync | Exists. New actions (`apply`, `enrol`, quiz events) must go through the same Dexie queue |
| Open source and easy to extend | **Still to do:** `CONTRIBUTING.md` with how to add a language, occupation, scheme rule or partner |
| AI grounded in real data | Every AI output is checked by a rule. Each KB entry keeps `source_url` and `verified_on` |
| Earlier open items | Load target (p95 < 1 s) not met; 42 questions not reviewed; Tamil review; per-teacher login; Proof Pays not yet clicked in a browser or deployed to Sepolia |

## Build order
1. **Day 1:** A (registry, trace, X-ray, HowItDecides), B (situation step, `uimode` rule), C (skipping interests).
2. **Day 2:** D (catalogue, opportunities, readiness, apply, partner), E (graph screen), F (Hindi strings for new and core screens).
3. **Day 3:** G (courses and Razorpay), H (the three documents), Tier 3 if possible, then a full demo rehearsal with `?xray=1`.

## Verification
- **Engine:** `npm test` in `packages/engine`. New tests for `uimode`, `readiness`, `persongraph`, the trace recorder and jsonlogic leaf recording. The parity and golden tests must stay unchanged and green.
- **API:** pytest for:
  - `/v1/profile/interests` and `/v1/careers/suggest`: a stubbed Gemini returns a made-up ID, and the response shows it was dropped.
  - Opportunities and applications, plus row-level security.
  - Courses: Razorpay signature check passes with a valid signature and is rejected with a bad one.
  - Rate-limit returns 429.
- **KB checks:** `scripts/validate_kb.py` (new files) and `scripts/check_privacy.py` (new tables).
- **Browser run** (the `run` skill), with `?xray=1`:
  - **Student journeys:** run 3 personas end to end — a 12-year-old who can't read (picture mode), a 16-year-old in Class 10 (mixed), and a 20-year-old who finished studying and skips the cards using voice in Hindi.
  - **Teacher journey:** create a paid course, test-pay with Razorpay as a student, finish the quiz, and see the skill level and graph update.
  - **Offline:** apply to an internship while offline and confirm it syncs once back online.
- **Demo script:** add the X-ray walkthrough to `docs/Disha_Commands.md`.
