# Disha: Project Guide

Citi India Hackathon 2026 · Team AdaMinds · PSG College of Technology

Status as of 20 November 2026. "Live" = deployed at disha-pa6e.onrender.com from the main branch. "Built" = on a feature branch, not yet live: feat/proof-pays (video, ZK credential, payouts) and feat/aim-high (Aim High higher-study pathways and the UI refresh; it sits on top of feat/proof-pays).

For every command to run, test, deploy and inspect the project, see docs/Disha_Commands.md.

---

## 1. Overview

Disha is a voice-first learning-to-livelihood app for rural students from Class 9 to graduation. It finds skills a student already has, measures them with evidence, matches careers and government schemes, and lets funders pay when a skill milestone is proved.

```
 CORE (problem statement)
 +-----------+    +-----------------+    +------------------+    +----------------------+
 | DISCOVER  | -> | MEASURE         | -> | MATCH            | -> | OPPORTUNITY          |
 | cards,    |    | tests, games,   |    | careers,         |    | schemes, scholar-    |
 | voice     |    | work samples,   |    | pathways, exams  |    | ships, apprentice-   |
 +-----------+    | paid jobs       |    +------------------+    | ships                |
                  +-----------------+                            +----------------------+
 GO DEEPER               |
                         v
                  +-----------------+    +------------------+    +----------------------+
                  | TEACHER REVIEW  | -> | PROVE            | -> | GET PAID             |
                  | confirm, endorse|    | private skill    |    | funder payout        |
                  +-----------------+    | credential       |    +----------------------+
                                         +------------------+
```

At a glance:

| Item | Count |
|---|---|
| Skills in the knowledge base | 25 |
| Testable sub-skills | 32 |
| Questions + aptitude puzzles | 42 + 59 = 101 |
| Careers | 16, across 8 sectors |
| Schemes and opportunities | 9 |
| Higher-study tracks (Aim High) | 14, with 23 entrance exams |
| Aim High subject questions | 43, across 7 subjects |
| Languages | Tamil, English |

Three rules hold everywhere:
- What a student says only decides what to test.
- Evidence decides the level.
- Rules, never AI, decide eligibility and payouts.

---

## 2. Problem statement fit

| Problem statement asks for | What Disha does | Status |
|---|---|---|
| Discover: local-language voice/text profile, wide options | Picture cards (RIASEC), Tamil/English voice, AI extraction limited to a fixed skill list with quotes | Live |
| Learn: pathway, competitive exams, widen options | 16 careers in 8 sectors, 4-step pathways, entrance exams, variety re-rank, what-if hints, best next test | Live |
| Learn: aim higher (school students) | Aim High: 14 higher-study tracks, shortest route and open doors, Class 11 group choice, exam readiness, week-by-week study plan, spaced practice | Built (feat/aim-high) |
| Opportunity: scholarships, schemes, apprenticeships | 9 rule files: eligible now / need info / eligible later; documents and apply links | Live |
| Connect and earn | Buyer-confirmed paid jobs; Proof Pays funder payouts | Live / payouts built |
| Facilitator enablement | Teacher view: class list, review queue, ratings, endorse, recommend | Live |
| Sustainability: teacher-run modules | Module marketplace planned | Roadmap |
| Mentor, corporate, NGO onboarding | Funder role exists; no mentor onboarding | Partial |
| Voice in and out, low-literacy UI | Push-to-talk, recorded prompts or phone TTS, picture-first screens | Live |
| Low-end Android, offline, sync | Installable PWA; tests, matching, eligibility on the phone; cursor sync | Live |
| Facilitator mode | Shared-phone profiles, class code, teacher code | Live |
| AI grounded in real data | Fixed skill IDs, quoted evidence, scheme rules with source links and test fixtures | Live |
| Open source, extendable, APIs | Apache-2.0, JSON knowledge base, REST /v1 and /v2 with OpenAPI docs | Live |

Judging weights: Innovation 25%, Technical feasibility 20%, Usability and scalability 20%, Monetisation 15%, Customer impact and UX 20%.

---

## 3. Users and journeys

| User | Who | What they do |
|---|---|---|
| Student | Class 9 to graduation, rural Tamil Nadu first, often a shared phone | Discover, test, see careers and schemes, prove skills |
| Teacher / facilitator | School, tuition or NGO educator | Guide a class, check work, endorse, recommend |
| Buyer / employer | Someone who paid her for work | Confirm the job once through a link |
| Funder | CSR, foundation, alumni | Fund milestones, watch proven payouts |

Student journey:

```
 Open app, pick language
        |
 New student profile -> Consent (scopes, guardian) -> Picture cards -> Voice questions -> Facts
        |
        v
 +--------------------- RESULTS (strengths / careers / schemes) <---------------------+
 |              |                     |                         |                    |
 v              v                     v                         v                    |
 Adaptive    Aptitude game      Work sample (photo/video)   Log paid job             |
 test           |                     |                         |                    |
 |              |               Teacher confirms           Buyer confirms            |
 +--------------+---------------------+-------------------------+--------------------+
        |
        v
 Proof: prove a milestone -> claim payout
```

Every return to Results recomputes her levels from the new evidence.

---

## 4. System architecture

System context:

```
  Student ----+                                   +--> Gemini 3.5 Flash (optional)
              |                                   |
  Teacher ----+--> Disha PWA (phone) <--sync--> Disha API (FastAPI) <--> PostgreSQL 16 + pgvector
                                                  ^         |
  Buyer --------- one-time link ------------------+         +--relayer--> ProofPays contract
                                                                               ^
  Funder dashboard ------------- reads Paid events ----------------------------+
```

Containers:

```
+---------------------------- PHONE (PWA, works offline) -----------------------------+
|  React 19 screens --> TypeScript engine (IRT, tracing, matching, eligibility rules) |
|        |        \-> MediaPipe (face blur, hands, fair-test)                         |
|        |         \-> snarkjs (zero-knowledge prover)                                |
|  IndexedDB / Dexie (evidence events, skill cache, many student profiles)           |
+---------------------------------------|---------------------------------------------+
                                        | sync when online (cursor-based)
+---------------------------- SERVER (FastAPI on Render) -----------------------------+
|  /v1  knowledge base, extract, match, eligibility                                   |
|  /v2  devices, sync, work samples, buyer links, credential, pay                     |
|  Python services (same maths as the phone engine, golden tests)                     |
|  Adapters: Gemini text/audio, vision, video; keyword fallback                       |
|  Chain relayer                                                                      |
+-----------|--------------------------------------------------|----------------------+
            v                                                  v
+------ DATA (Supabase, Mumbai) ------+        +------ CHAIN (Proof Pays) -------------+
| PostgreSQL 16 + pgvector            |        | ProofPays.sol + Groth16 verifier      |
| evidence log, skill state,          |        | Demo Rupee (ERC-20)                   |
| row-level security per school       |        | local Anvil now, Sepolia next         |
+-------------------------------------+        +---------------------------------------+
  Knowledge base JSON: bundled into the app at build, loaded into Postgres by load_kb.py
```

Technology choices:

| Layer | Technology | Why |
|---|---|---|
| Phone app | React 19, Vite, PWA service worker | Opens from a link, installs without a store, works offline |
| Phone storage | IndexedDB (Dexie) | Evidence events and many profiles on one shared phone |
| Engine | TypeScript @disha/engine + Python twin | Same maths on phone and server, golden parity tests |
| API | FastAPI, Python 3.12 | Typed endpoints, OpenAPI docs at /docs |
| Database | PostgreSQL 16 + pgvector on Supabase | Row-level security per school; vectors for search |
| AI | Gemini 3.5 Flash (optional), keyword fallback | Speech to skills, photo and video checklist scoring |
| On-device vision | MediaPipe Tasks Vision | Face blur, hand landmarks, fair-test detection |
| Proofs | circom 2, snarkjs Groth16, Poseidon, EdDSA (BabyJubJub) | Prove a milestone without revealing personal data |
| Contracts | Solidity, Foundry, Anvil; Sepolia next | One neutral payout rule |
| Hosting | Docker on Render (free, Singapore), GitHub Actions CI | One image serves API and web app |

---

## 5. Repository layout

```
apps/
  web/              React 19 + Vite PWA (student, teacher, funder screens)
    src/screens/    one file per screen (21 screens, incl. AimHigh, AimTrack, AimQuiz)
    src/components/ shared UI, question formats, Icon (one icon set)
    src/lib/        db, sync, speech, i18n, proof, video, proctor, integrity, aim
  api/              FastAPI server
    app/routers/    v1, v2, see (video), proof (credential and pay)
    app/services/   Python engine twin: irt, tracing, fitreach, eligibility, raters
    app/adapters/   gemini text/audio, vision, video, keywords
    app/zk/         Poseidon, EdDSA, credential signing
    migrations/     PostgreSQL schema 0001-0009
    tests/          pytest (auth, privacy, fairness, failures, proof pays)
packages/
  engine/           shared TypeScript engine + golden tests; src/pathways.ts (Aim High maths)
  kb/               skills, sub-skill graph, careers, schemes, rules, items, rubrics; pathways/ (Aim High)
  zk/               circom circuit and prover (GPL-3.0)
contracts/          ProofPays.sol, DemoRupee.sol, Groth16Verifier.sol, Foundry tests
scripts/            validate_kb, load_kb, simulate, calibrate, load_test, deploy_contracts
docs/               architecture, scope, data plan, progress, innovation, benchmarks
```

---

## 6. Knowledge base

All domain data is JSON in packages/kb. Teachers or NGOs can add a skill, career or scheme without code. validate_kb.py rejects unknown IDs, bad sectors and rules that fail their own test cases.

| File | Holds | Count |
|---|---|---|
| skills.json | Skills a student can report | 25 |
| graph/ (subskills, edges, aptitudes) | Measurable sub-skills and links | 32 sub-skills, 132 edges, 3 aptitudes |
| occupations.json | Careers: sector, RIASEC, needed sub-skills, pathway, exams, local demand, RPL | 16 careers, 8 sectors, RPL on 5 |
| schemes.json + rules/ | Scheme facts, documents, apply link, JSON Logic rule + fixtures | 9 |
| items/ | Test questions and aptitude puzzles | 42 + 59 |
| rubrics/ | Work-sample checklists | 2 (stitching, basic electrical) |
| pathways/ (graph, exams, tracks, subjects, items) | Aim High: study-route graph, entrance exams, higher-study tracks, subjects with topic prerequisites, bilingual questions with explanations | 14 tracks, 23 exams, 7 subjects, 43 questions |

How the graph connects (stitching as the example):

```
                    +--> Taking measurements
 SKILL: Stitching --+--> Cutting a pattern
                    +--> Machine work and seams <--related (evidence spreads)--> Fitting and alteration
                    +--> Fitting and alteration

 CAREER: Tailoring business owner --needs level--> Machine work, Fitting
 APTITUDE game ------------------raises Reach----> career
 SCHEME rule --------------------checks facts (class, income band...), not skills
```

10 skills with question banks: Stitching, Drawing, Basic electrical, Handling money, Selling, Cooking, Phone and computer use, Growing crops, Caring for people, Teaching. The other 15 can be self-reported and rated by teachers.

8 sectors: Agriculture, Creative, Entrepreneurship, Government, Health, Services, STEM, Vocational.

---

## 7. Evidence engine

Finding a skill and measuring it are separate. Every answer, rating, photo score and paid job is an immutable event. Levels are always recomputed from events.

```
 Voice/text answer --> Gemini key set?
                        | yes                          | no / error
                        v                              v
              Gemini: skill IDs from our list     Keyword matcher
              + quoted evidence                        |
                        |                              |
              Drop unknown IDs, unquoted skills        |
                        +--------------+---------------+
                                       v
                               self_report events
                     +-----------------+-----------------+
                     v                 v                 v
               Adaptive test     Work sample        Paid job
                     +-----------------+-----------------+
                                       v
   Teacher / mentor / buyer ---> EVIDENCE LOG ---> Skill tracing (chance of level 1-4)
   ratings                                              |
                                                        v
                                           Matching and opportunities
```

Event kinds:

| Kind | Example |
|---|---|
| self_report | "I stitch blouses for neighbours" |
| family_report | A parent says she keeps the shop accounts |
| interest_choice | A picture-card choice (RIASEC) |
| item_response | A test answer, with fair-test flags if any |
| aptitude_response | An answer in an aptitude game |
| task | A simulated task or game score |
| work_sample | A photo or video scored on a checklist |
| rating | Teacher, mentor or buyer rating, or confirmation of another event |
| order | A paid job she logged |
| taster | A mentor's rating after a career taster |

IDs are ULIDs: they sort by time and can be created offline without clashes.

### Adaptive tests (item response theory)

```
 Prior over ability (41 points, -4 to +4)
        |
        v
 Pick at random among the 3 most informative unseen questions  <--------+
        |                                                               |
 Ask (choice / estimate / order-the-steps)                              |
        |                                                               |
 Update posterior                                                       |
        |                                                               |
 Stop? (error < 0.4, or one level 85% likely after 3, or 8 asked) --no--+
        | yes
        v
 Level from 3 cut-points
```

Random choice among the top 3 stops friends sharing answer sequences. At most 3 questions of one format in a row.

### Four-level skill tracing

Levels: 1 Knows about it · 2 Can do it with help · 3 Can do it alone · 4 Earns from it or teaches it. Prior: 40 / 30 / 20 / 10%.

| Evidence | Weight |
|---|---|
| Self-report | 0.5 |
| Family report | 0.75 |
| Test session | 0.7 |
| Unconfirmed paid job | 1 |
| Teacher endorsement, task | 2 |
| Confirmed paid job | 2 each, up to 5 |
| AI-scored work sample | 3 |
| Teacher level rating | 3 |
| Teacher-confirmed work sample, career taster | 4 |

- Aging: half-life 1 year for what she said, 2 years for what she showed.
- Learning drift: some probability moves up a level between sessions (5% a week, max 20%).
- Spreading: half strength to related sub-skills one step away, quarter at two. Spread alone never makes a skill Strong.
- Level 4 needs proof: capped at 40% without a confirmed paid job or equal.
- Strong: at least 80% sure, backed by performance evidence.
- AI as a rater: the AI video scorer's weight follows its weighted kappa against teachers.

Worked example, Meena (demo student), machine stitching:

| Evidence added | Level | How sure |
|---|---|---|
| Voice answer only | 2 | 72% |
| + adaptive test | 2 | 83% |
| + work-sample photo (AI) | 3 | 72% |
| + teacher check | 3, Strong | 97% |
| + 5 buyer-confirmed orders | 4 | 82% |

### Aptitude, work samples, paid jobs

- Aptitude games: spatial, numeric, mechanical (59 generated SVG puzzles). Measure potential separately; high aptitude raises a "could learn" flag.
- Work samples: photo or video scored item by item against a checklist, in memory, not stored. Teacher confirmation makes it the strongest evidence. No AI key: goes straight to the teacher.

Buyer confirmation of a paid job:

```
 Student phone            Disha API                 Buyer phone
     | log paid job           |                          |
     |--POST orders/{id}/link>|                          |
     |<----- one-time link ---|                          |
     |------------ share link (WhatsApp / SMS) --------->|
     |                        |<--- open confirm page ---|
     |                        |--- first name + 3 Qs --->|
     |                        |<-------- answers --------|
     |                        | save rating, burn token  |
     |<-- rating at next sync: job shows "Confirmed"     |
```

---

## 8. Career matching

**score = 0.40 x Fit + 0.35 x Reach + 0.25 x Worth**

| Part | Question | Made of |
|---|---|---|
| Fit | Can she do the career's sub-skills now? | Chance she is at or above each needed level, weighted |
| Reach | Could she get there? | Aptitude 40%, closeness 30%, education gap 30% |
| Worth | Would she want it? | Interest 60%, local demand in Tamil Nadu 40% |

```
 Profile (levels, aptitude, interests, education)
     |-------------+-------------+
     v             v             v
  Fit 40%      Reach 35%     Worth 25%
     +-------------+-------------+
                   v
        Score all 16 careers
                   v
        MMR re-rank: at least 4 sectors
                   v
        Top careers with reasons
          |            |              |
     What-if hints  Best next test  RPL hint at level 4 (18+)
```

Each career has a 4-step pathway and entrance exams (e.g. NIFT, NID DAT, TNEA/JEE, TNTET/CTET, ITI and polytechnic admission). For 5 careers the real NSDC qualification pack is listed, so level 4 shows "You can apply for RPL certification under PMKVY".

---

## 9. Schemes and eligibility

Each scheme is a JSON Logic rule with its source link and test fixtures. The same rule runs on phone and server, so it works in airplane mode.

```
 Student facts (class, gender, category, income band, district)
               |
               v
     Rule for each of 9 schemes
     |            |              |               |
 Eligible now  Need more info  Eligible later  Not eligible
 docs + link   asks the fact   after a change
```

| Scheme / opportunity | Type | Apply through |
|---|---|---|
| NMMS | Scholarship | National Scholarship Portal |
| Pre-Matric Scholarship (SC) | Scholarship | National Scholarship Portal |
| Post-Matric Scholarship (SC) | Scholarship | National Scholarship Portal |
| AICTE Pragati (girls) | Scholarship | National Scholarship Portal |
| AICTE Saksham (specially-abled) | Scholarship | National Scholarship Portal |
| Pudhumai Penn | Tamil Nadu scheme | pudhumaipenn.tn.gov.in |
| Tamil Pudhalvan | Tamil Nadu scheme | tn.gov.in |
| Paid apprenticeship (NAPS) | Apprenticeship | apprenticeshipindia.gov.in |
| PM Internship Scheme | Internship | pminternship.mca.gov.in |

AI never decides eligibility.

---

## 10. Aim High (higher-study pathways)

A fourth Results tab for students in or near school who could go further. It answers: which higher-study careers are still open from where I am, which Class 11 group keeps them open, how ready am I for the entrance exam, and what do I study each week.

14 tracks: doctor, engineer, chartered accountant, lawyer, IAS / TNPSC, scientist, IIT Madras BS in data science, NDA (armed forces officer), nurse, pharmacist, veterinarian, agriculture, architect, designer.

```
 Facts screen: class, Class 11-12 group or degree, birth year
        |
        v
 START node (e.g. "Class 10", "Class 12 PCM", "UG science")
        |
        v
 Route graph (school -> stream -> course -> goal; each edge = years + exams + age limit)
        |
        +--> Dijkstra: shortest route to each goal (NDA age limit checked during the search)
        +--> Doors: open / closed / closed by age, for every track
        +--> Class 11 group chooser: which group keeps which doors open (PCMB, PCM, PCB, commerce, humanities)
        |
 Subject check (adaptive, up to 6 questions, same 2PL IRT as skill tests)
        |
        v
 Ability per subject --> Readiness at the first exam (growth 0.05 ability a month, max 24 months)
        |
        v
 Study plan: Kahn topological sort of topics (prerequisites first), value-per-hour priority,
             20% of hours kept for practice, topics at 85%+ mastery skipped
        |
        v
 Daily practice: Leitner boxes (review after 1, 2, 4, 8, 16 days)
```

| Part | How it works |
|---|---|
| Route | Dijkstra over study stages weighted by years; an edge with max_age (NDA) is refused when she would be too old |
| Doors | Every track marked open, closed (wrong group or stage) or closed by age |
| Class 11 group | For each group, how many of her interesting tracks stay open (interest from RIASEC cards) |
| Ability | 2PL IRT per subject from Aim quiz answers |
| Readiness | Ability projected to the month of the first exam on the route, against the track's bar |
| Study plan | Topics in prerequisite order (Kahn), highest value per hour first, packed into her weekly hours |
| Practice | Wrong or due questions come back by Leitner box; each answer shows why |
| Money and help | Track pages reuse the scheme rules; flags the Tamil Nadu 7.5% government-school quota |

Screens: Aim High tab (inside Results), Aim track page (route, exams, readiness, plan, funding), Aim quiz (subject check and daily practice).

Privacy: quiz answers, practice cards and the goal stay on the phone (IndexedDB meta key aim.<student>), are erased with the student, and are not synced. The teacher cannot see goals yet.

Status: built on feat/aim-high, 14 engine tests, validate_kb.py checks the pathway files (unknown nodes, unreachable goals, prerequisite loops, bilingual text). Clicked through in a browser. Every exam rule, quota and fee note is marked needs_verification; readiness bars and the growth rate are planning assumptions; the 43 questions are team estimates awaiting teacher review; IIT JAM and Tamil Nadu lateral entry have no official link yet.

UI refresh (same branch): Plus Jakarta Sans for English and Noto Sans Tamil for Tamil (bundled, work offline), one icon set (components/Icon.tsx) across all screens, cleaner cards and tabs.

---

## 11. Voice and language

- Output: recorded prompt if available, else the phone's text-to-speech (many cheap phones lack a Tamil voice).
- Input: push-to-talk. Record, then upload. Live streaming fails on 2G/3G.
- Languages: Tamil and English. Tamil text still needs a native speaker's review.

```
 Student        Phone                    Disha API                    Gemini
   |<-- reads question aloud               |                            |
   |-- holds to speak -->|                 |                            |
   |                     |-- audio ------->|                            |
   |                     |                 |-- audio + skill list ----->|
   |                     |                 |<- transcript, IDs, quotes -|
   |                     |                 | drop unknown / unquoted    |
   |                     |<- skills+quotes-|                            |
   |                     | save self_report events                     |
```

No key or no network: keyword matcher runs instead.

---

## 12. Offline and sync

```
 Phone (IndexedDB)                 API /v2/sync                  PostgreSQL
   | record events offline (ULIDs)     |                              |
   | ... back online ...               |                              |
   |-- unsent events + cursor + token->|                              |
   |                                   |-- check token, school,       |
   |                                   |   consent; insert events --->|
   |                                   |-- rebuild skill state ------>|
   |<-- events from other devices + new cursor                        |
   | store, rebuild skill state        |                              |
```

- Retries never duplicate (stable IDs).
- Events for students without consent are rejected with the reason.
- Backlogs return in pages; the cursor waits 60 s so late commits are not lost.
- Demo students never leave the phone.
- Needs a connection: AI extraction, photo/video scoring, payout claims. Proofs are made on the phone.

---

## 13. Facilitator mode

```
 Phone registers with secret teacher code         Student phones join with class code
                     \                                 /
                      v                               v
                     CLASS LIST (own school only)
   +-----------+-----------+-----------+-----------+-----------+-----------+
   v           v           v           v           v           v
 Work to    Rate: term  Endorse    Recommend   Fair-test   Load demo class
 check      or taster   a skill    a career    flags       (Meena, Karthik, Arun)
   |
 Confirm scores, jump to MM:SS
```

Only teacher-code phones can rate or see the class list. Rater leniency and weighted kappa are measured (not yet used to shift scores).

---

## 14. Video assessment and fair-test check

Both run MediaPipe on the phone. Faces never leave the device.

Filming a task:

```
 Camera -> MediaPipe on phone: pixelate faces, 21 hand points per hand
        -> record only the blurred canvas + hand stats (hands visible, two hands, steadiness, activity)
        -> POST /v2/work-sample/video
        -> Gemini video: score + MM:SS + reason per checklist step
        -> AI score returned, video not stored
        -> Teacher queue with jump-to-time buttons -> teacher confirms or changes
```

Fair-test check during an adaptive test:

```
 Front camera (optional) --> Face detector (~5/s) ----> no_face, multi_face, look_away, dark
                         \-> Object detector (~1/s) --> phone, notes, extra person
 Browser events ------------------------------------> tab_away, paste
                                     |
                     flag names stored on each answer
                                     |
                     teacher sees per sub-skill summary
```

A condition must last a moment before it counts. Nothing is recorded; scoring is unchanged; the teacher decides.
Status: built on feat/proof-pays; real-camera testing on phones still to do. Electrical videos use a battery switch board only.

---

## 15. Proof Pays (innovation)

"The phone sees the skill, maths proves it, and money follows." Funders put money on a skill milestone. A smart contract pays when a zero-knowledge proof shows the milestone was reached. Funders learn the statement is true and nothing else.

```
 Student phone            Disha API (+relayer)        ProofPays.sol            Funder dashboard
   |-- POST /v2/credential ->|                            |                          |
   |<- signed credential ----|  (EdDSA-Poseidon)          |                          |
   | check signature,        |                            |                          |
   | make Groth16 proof (WASM)                            |                          |
   |-- POST /v2/pay/claim -->|                            |                          |
   |                         |-- claim (pays gas) ------->|                          |
   |                         |                            | nullifier? proof? budget?|
   |                         |                            |------- Paid event ------>|
```

Circuit (circom 2):
- Private inputs: credential fields (32 sub-skill levels, 2 bits each; confirmed orders; earnings; income band; gender; district; birth year; dates; cohort), signature, student secret.
- Public inputs: issuer key, milestone ID, sub-skill index, minimum level, minimum orders, maximum income band, required gender, today, payout address.
- Checks: signature valid; level and orders high enough; income band under limit; not expired; nullifier = Poseidon(secret, milestone).

Example statement: "Machine stitching is level 3 or above, at least 5 buyer-confirmed orders, family income band under the limit, credential signed by Disha and not expired."
Hidden: name, exact income and earnings, district, birth year, other skills, the evidence.

Contract checks:

```
 claim(milestone, payout, today, nullifier, proof)
   Milestone open?            no -> NotOpen
   Nullifier already used?    yes -> AlreadyPaid
   Proof valid for payout?    no -> InvalidProof
   Budget left?               no -> OutOfBudget
   otherwise                  -> pay Demo Rupee, emit Paid
```

Test on a local Ethereum chain (Anvil), 19 Nov 2026:

| Test | Result |
|---|---|
| Thief sends the proof with a different payout address | Refused (InvalidProof) |
| Real claim for milestone 1 | Paid 2,000 Demo Rupees |
| Same proof sent again | Refused (AlreadyPaid) |

Proof made in about 2.9 s on a laptop (phone not measured). 9 Foundry tests, 8 ZK tests. Next: Sepolia testnet. Production: same rule on UPI / e-RUPI to a guardian or school account. ZK package GPL-3.0; rest Apache-2.0.

---

## 16. Privacy, safety and fairness

Consent lifecycle:

```
 [No consent] --student/guardian agrees to scopes--> [Consented] <--change scopes--+
                                                       |    |                      |
                                     withdraw (sync stops)  +----------------------+
                                                       v    |
                                                 [Withdrawn] |
                                                       |    |
                                                       v    v
                                               [Deleted: everything erased]
```

| Area | Measures |
|---|---|
| Consent | Three scopes with guardian method; under-18s use signed paper form (OTP not built); delete leaves only an anonymous count |
| Safety | Faces blurred on phone; photos/videos scored in memory, never stored on server; under-18 hazardous-task rule; minors' payouts to guardian or school |
| Security | Join code + device token; row-level security per school; names in a separate private table; lost phones revocable |
| Fairness | Gender-swap tests (200 synthetic students); Rasch recalibration with DIF checks; check_privacy.py in CI |

---

## 17. Data model (PostgreSQL, migrations 0001-0009)

```
 SCHOOL 1--* STUDENT 1--1 STUDENT_PRIVATE
 SCHOOL 1--* JOIN_CODE          STUDENT 1--* CONSENT
 SCHOOL 1--* DEVICE             STUDENT 1--* EVIDENCE_EVENT *--1 RATER
                                EVIDENCE_EVENT 1--* CONFIRM_TOKEN
                                STUDENT 1--* SKILL_STATE / APTITUDE_STATE / INTEREST_STATE (caches)
                                STUDENT 1--* OUTCOME
 KG_NODE 1--* KG_EDGE           KG_NODE 1--1 CAREER_EMBEDDING     KG_NODE 1--* OPPORTUNITY
 ITEM 1--1 ITEM_STAT            RUBRIC                            DELETION_COUNT
```

evidence_event is the source of truth; *_state tables are caches.

---

## 18. API reference

| Method | Path | Purpose |
|---|---|---|
| GET | /health | Status; AI or keyword mode |
| GET | /v1/kb | Whole knowledge base |
| POST | /v1/profile/extract | Answer -> skills with quotes |
| POST | /v1/match | Ranked careers with what-if hints |
| POST | /v1/eligibility | Every scheme: now / need info / later |
| POST | /v2/devices | Register a phone, get a device token |
| POST | /v2/sync | Send offline events, receive others |
| POST | /v2/work-sample/score | Score a photo against a checklist |
| POST | /v2/work-sample/video | Score a video with MM:SS per step |
| GET | /v2/ai-rater | AI scorer agreement (kappa) with teachers |
| POST | /v2/orders/{event_id}/link | One-time buyer link |
| GET/POST | /v2/confirm/{token} | Buyer confirmation page (once) |
| DELETE | /v2/student/{id} | Erase a student |
| POST | /v2/credential | Signed skill credential |
| GET | /v2/pay/config | Contract, issuer key, open milestones |
| POST | /v2/pay/claim | Submit a proof for payout |

Interactive OpenAPI docs at /docs. Student-data endpoints need a device token and see only their own school.

---

## 19. Screens and wireframes

Screen map (21 screens):

```
 Home --new--> New student -> Consent -> Picture cards -> Questions -> Facts -> RESULTS
                                                                                 |
     +------------+------------+-------------+-----------+----------+-----------+
     v            v            v             v           v          v           v
 Career detail  Adaptive    Aptitude     Work sample  Paid job   Privacy     Proof
                test        game                        |
                                                  (buyer link) -> Confirm job
 RESULTS --Aim High tab--> Aim High --> Aim track (route, plan) --> Aim quiz (check / practice)
 Home --teacher--> Teacher -> Rate
 Funder dashboard (/?funder)
```

Wireframes (layout sketches, not screenshots; sample text is illustrative):

```
+-----------------------+  +-----------------------+  +-----------------------+
| Disha      [TA / EN]  |  | < What do you enjoy?  |  | < Question 2 of 5     |
|-----------------------|  | [=====-----------]    |  |-----------------------|
| Students on phone     |  | +--------+ +--------+ |  | What work do you do   |
| [Meena      Strong ]  |  | |fixing  | |drawing | |  | at home? (tap to hear)|
| [Karthik           ]  |  | |a fan   | |        | |  |        ( HOLD )       |
| [Arun              ]  |  | +--------+ +--------+ |  |  hold to speak / type |
|                       |  | |selling | |caring  | |  | [____________________]|
| [ + New student     ] |  | +--------+ +--------+ |  | Found in your words:  |
| [ Teacher view      ] |  | (Like) (Not for me)   |  | Stitching             |
| Sync: 3 waiting       |  | [ Next ]              |  | "I stitch blouses..." |
+-----------------------+  +-----------------------+  +-----------------------+
   HOME                       PICTURE CARDS              VOICE QUESTION

+-----------------------+  +-----------------------+  +-----------------------+
| Meena       [Privacy] |  | Meena                 |  | Meena                 |
|[Strengths]Careers Sch.|  | Strengths[Careers]Sch.|  | Strengths Careers[Sch]|
| Machine work  Strong  |  | Boutique owner  78%   |  | Pudhumai Penn  NOW    |
| [###.] L3 · 97% sure  |  |  Fit · Reach · Worth  |  |  3 documents · apply  |
| Pricing     Test it   |  | Fashion designer 64%  |  | NMMS       NEED INFO  |
| [##..] L2             |  | Textile technician 52%|  |  family income band?  |
| Best next test:       |  | What if: Pricing L3   |  | AICTE Pragati  LATER  |
|  customer handling    |  |  -> opens 1 more      |  |  after a diploma      |
| [Film work][Paid job] |  |                       |  | NAPS           LATER  |
| [ Prove a milestone ] |  |                       |  |                       |
+-----------------------+  +-----------------------+  +-----------------------+
   RESULTS: STRENGTHS         RESULTS: CAREERS           RESULTS: SCHEMES

+-----------------------+  +-----------------------+  +-----------------------+
| < Money: totals       |  | < Film your work      |  | Teacher · Class 10A   |
| [cam] Fair-test on    |  | +-------------------+ |  | 32 students · 4 check |
|  face ok | PHONE SEEN |  | | live camera       | |  | Meena: stitch video   |
| [=====---] Q3 of <=8  |  | | face pixelated    | |  | [ video player ]      |
| 3 kg rice at Rs42/kg. |  | | hand points drawn | |  | [0:07 seam][0:14 end] |
| Pays Rs200. Change?   |  | +-------------------+ |  | score: 1 2 [3] 4      |
| [ Rs74 ]  [ Rs84 ]    |  | REC 0:14   2 hands    |  | [ Confirm scores ]    |
| [ Rs126 ] [ Rs74.50 ] |  | checklist ...         |  | Karthik  NEEDS A LOOK |
|                       |  | [ Stop and send ]     |  | Arun     STRONG MATCH |
+-----------------------+  +-----------------------+  +-----------------------+
   ADAPTIVE TEST              WORK SAMPLE: FILM          TEACHER

+-----------------------+  +-----------------------+  +-----------------------+
| < Prove a milestone   |  | Funder dashboard      |  | Confirm a job         |
| Stitching L3 + 5 jobs |  | Budget     Paid       |  | Meena stitched for you|
| Funded: 2,000 DemoRs  |  | 20,000     1          |  | Work done?  [Yes] No  |
| Will prove: ...       |  | Live Paid events:     |  | How good?  1 2 [3] 4  |
| Hidden: name, income  |  | Milestone 1  2,000    |  | Pay again?  [Yes] No  |
| [1 Make proof here]   |  |  payout 0x.. explorer |  |                       |
| [2 Claim payout   ]   |  | No names ever shown   |  | [ Confirm ]           |
| PAID · tx link        |  |                       |  | This link works once  |
+-----------------------+  +-----------------------+  +-----------------------+
   PROOF                      FUNDER                     BUYER CONFIRMATION

+-----------------------+  +-----------------------+
| Meena                 |  | < Doctor (MBBS)       |
| Str Car Sch [Aim High]|  | Route: Class 10 ->    |
| Doors from Class 10:  |  |  PCB -> NEET -> MBBS  |
| Doctor      OPEN      |  | Exams: NEET-UG        |
| Engineer    OPEN      |  | Readiness  Bio [###.] |
| NDA      AGE LIMIT    |  |            Chem[##..] |
| Pick a Class 11 group:|  | Week 1: Cell biology  |
|  PCB keeps 6 open     |  | Week 2: Mole concept  |
| [ Check a subject ]   |  | 7.5% govt quota: yes  |
| [ Today's practice ]  |  | [ Check Chemistry ]   |
+-----------------------+  +-----------------------+
   AIM HIGH TAB               AIM TRACK
```

---

## 20. Testing and deployment

```
 Push / PR --> Node job:   npm ci, npm test (engine + typecheck), build
          \--> Python job: validate_kb, check_privacy, pytest

 Push to main --> Render builds Docker image --> disha-pa6e.onrender.com
                                                   |-- Supabase Postgres (Mumbai)
                                                   |-- Gemini API
                                                   '-- (Proof Pays branch) local Anvil now, Sepolia next
```

| Check | What it proves |
|---|---|
| Engine tests + golden parity | TypeScript and Python give identical results |
| validate_kb.py | KB IDs, sectors, RPL codes, rule fixtures consistent |
| pytest API suite | Auth and school scoping, privacy, fairness, failure modes, Proof Pays |
| simulate.py | Adaptive test accuracy on 500 simulated students |
| load_test.py | Sync latency with 200 phones at once |
| Foundry (9) and ZK (8) tests | Contract rules and circuit correctness (run locally) |
| pathways.test.ts (14) | Aim High routes, age limit, doors, abilities, readiness, study plan order, Leitner |

---

## 21. Metrics

| Metric | Value | Basis |
|---|---|---|
| Skill level exact | 80% | Simulation, 500 students, 2,500 ratings |
| Within one level | 99.8% | Same simulation |
| Questions per test | 7.6 average, max 8 | Same simulation |
| ZK proof time | ~2.9 s | Laptop; phone not measured |
| Sync p95 | 6.2 s (target < 1 s, not met) | 200 phones burst, laptop with Docker |

These are simulation and lab numbers. No school pilot has run yet, so no field accuracy, adoption or outcome is claimed.

---

## 22. Status, roadmap and business model

| Live | Built, in testing | Next | Known gaps |
|---|---|---|---|
| Student flow, Tamil/English | Video scoring with MM:SS | Sepolia deploy + browser click-through | Guardian OTP not built |
| Voice + AI skill extraction | Fair-test check, Aim High pathways | Proving time on low-end Android | No per-teacher login on shared phones |
| Tests, games, photo work samples | ZK credential and proof | School pilot (pack ready), recalibration | Device registration has no rate limit |
| Careers, schemes, what-ifs | Payout contract (local chain) | AI counsellor (MCP tools) + scheme-document search | Tamil content needs teacher review |
| Teacher view, sync, buyer links, privacy | Funder dashboard | Teacher module marketplace, more languages | Paid Gemini key needed before real students |

Monetisation (plan, not yet validated):
- CSR and foundations fund skill milestones and pay per proven outcome (Proof Pays).
- Employers pay for verified apprentice and intern pipelines.
- Facilitators earn a fee per application or a CSR stipend.
- Teacher modules: free, per module or subscription, small commission (roadmap).
- Students never pay. Education and skilling took Rs 9,182 crore, about 41% of listed-company CSR in FY25 (Crisil).
- Runs today on free tiers (Render, Supabase, Gemini).

---

## 23. Glossary

| Term | Meaning |
|---|---|
| IRT | Item response theory: each question has a difficulty and discrimination; picks the next question |
| Bayesian tracing | A probability for each skill level, updated with each piece of evidence |
| RIASEC | Six interest types: realistic, investigative, artistic, social, enterprising, conventional |
| MMR | Maximal marginal relevance: re-ranking for variety |
| Weighted kappa | Agreement between two raters beyond chance |
| Rasch, DIF | Question calibration; check that a question behaves the same for girls and boys |
| RPL | Recognition of prior learning (PMKVY, ages 18-59) |
| Zero-knowledge proof | Proof that a statement is true without showing the data |
| Groth16 | Compact proof system; verification takes milliseconds |
| Nullifier | One-time tag per student and milestone that stops double payment |
| Relayer | Server account that sends the claim and pays test gas |
| PWA | Progressive web app: a website that installs and works offline |
| 2PL | Two-parameter IRT model: difficulty and discrimination per question |
| Dijkstra | Shortest-path search; finds the fewest years from where she is to a goal |
| Kahn's sort | Orders topics so every prerequisite comes first |
| Leitner boxes | Spaced practice: a right answer moves a card to a longer gap, a wrong one back to day 1 |

Sources: Disha repository (README, docs/ARCHITECTURE.md, docs/INNOVATION.md, docs/PROGRESS.md, code), the Citi India Hackathon problem statement, and the Crisil FY25 CSR study.
