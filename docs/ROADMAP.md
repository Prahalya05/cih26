# Disha roadmap: from prototype to a working service

_Written 20 November 2026. Months are counted from the hackathon result (month 0 = December 2026)._

## Where we are now

**Built and tested:**
- Voice and text profiling in Tamil, Hindi and English.
- Onboarding that adapts to age, situation and reading level.
- Picture cards, which can be skipped for own-words interests.
- Skill levels from evidence.
- 62 careers, 9 scholarship schemes and 32 opportunity listings.
- Aim High study routes.
- The teacher view, with talent spotting, ratings and recommendations.
- Each student's knowledge graph.
- The decision X-ray.
- Proof Pays, running on a local chain.
- Offline-first, with sync.

**Not yet:**
- Real students.
- A Sepolia deployment.
- Teacher-run courses and payments.
- An RAG counsellor.
- Offline speech recognition.

## Phase 1 — Pilot (months 0–2, Dec 2026 – Feb 2027)

**Goal:** prove that students and teachers use it and that the scores are right.

| What | Who | Done when |
|---|---|---|
| Pilot in 2 districts of Tamil Nadu (Madurai, Krishnagiri): 5 government schools, 10 teachers, 300 students (Class 9 to college) | Team + 1 partner NGO | 300 students profiled, consent forms filed |
| Native-speaker review of all Tamil and Hindi text; record audio prompts | 2 paid reviewers | No string marked "to review" |
| Teachers rate students; compute AI-vs-teacher kappa and recalibrate the 42 test questions | Team | Kappa per rubric reported; question parameters updated from pilot data |
| Paid-tier Gemini key, guardian OTP, per-teacher PIN, pgcrypto on `student_private` (docs/SECURITY.md §7) | Team | Security checklist closed |
| Deploy Proof Pays to Sepolia testnet with one CSR funder's demo budget | Team | First proof-gated payout on testnet |
| Load test on Render: p95 under 1 second at 100 phones syncing | Team | Benchmark in docs/benchmarks |

**Success measures:**
- 70% of students finish onboarding.
- 50% of students open their map or careers again within 2 weeks.
- Teachers say the talent list is useful (survey of at least 4 out of 5).

## Phase 2 — Make it useful every week (months 3–5, Mar – May 2027)

| What | Detail |
|---|---|
| **Teacher courses** (moved here from the demo) | Teachers build modules, each with a text or video lesson and a quiz in the existing question format, priced as free, pay per module or subscription. Payments through Razorpay (UPI), verified by HMAC signature on the server. Disha takes 10%. Passing a module quiz becomes evidence for the skill level. |
| **Live opportunity feeds** | Nightly import from the NAPS and NCS portals and the PM Internship portal where APIs or open data exist. Each listing keeps `source_url` and `verified_on`; stale listings are hidden after 30 days. |
| **Partner self-service** | Employers, NGOs and mentors post listings through the Partner screen. An admin approves each one. Partners see applicants who agreed to share. |
| **"Ask Disha" counsellor** | Gemini function calling over the engine tools (`check_eligibility`, `match_careers`, `readiness`, `find_courses`) plus RAG over official scheme PDFs (pgvector). The AI explains; the tools decide. Every tool call is visible in the X-ray. |
| **Offline speech** | On-phone speech recognition (Whisper-tiny or Vosk) for Tamil and Hindi, so voice works without data. Cloud speech remains the fallback. |
| More schemes | From 9 to about 40: central schemes plus Karnataka, Kerala and Andhra Pradesh rules, each with test cases. |

## Phase 3 — Scale and sustain (months 6–12, Jun – Nov 2027)

| What | Detail |
|---|---|
| **5 states, 10 languages** | Bhashini speech recognition, text-to-speech and translation for Kannada, Telugu, Malayalam, Marathi, Bengali, Odia and Gujarati. A new language only needs a string file and KB names, plus a native-speaker review. |
| **50,000 students** | Through state skill missions (TN Naan Mudhalvan, Kerala ASAP) and NGO networks. Facilitator mode: one teacher runs a whole class on 5 shared phones. |
| **Credentials** | Skill credentials issued to DigiLocker as verifiable documents. RPL certification referrals to PMKVY centres. |
| **Proof Pays on a public chain** | CSR funders pay stipends when a skill milestone is proved. Funder dashboard with audited, anonymous results. |
| **Open-source community** | `CONTRIBUTING.md` guides for adding a language, career, scheme rule or partner. Monthly community calls. KB data under an open licence. |

## How Disha pays for itself

| Source | Model | Year-1 target |
|---|---|---|
| Teacher courses | 10% of paid module and subscription fees | 200 teachers selling courses |
| Employer listings | Free for NGOs and government; ₹500 per month for companies posting paid listings | 100 companies |
| CSR funders (Proof Pays) | 5% platform fee on milestone payouts | 3 funders, ₹25 lakh disbursed |
| Government and skill-mission contracts | Per-student fee for profiling and tracking outcomes | 1 state contract |

**Running cost per student is small:**
- Hosting on Render and Supabase, roughly ₹2–3 per student per year at scale.
- AI calls, about 5 per student per month at Gemini Flash prices.

## Risks and how we handle them

| Risk | Plan |
|---|---|
| AI gives a wrong or made-up answer | It cannot decide anything: rules check every output, and the X-ray shows it. Kappa monitoring tracks the AI rater. |
| Students' data leaks | Data minimisation, row-level security, consent scopes, rate limits, and an outside security review before scaling (docs/SECURITY.md). |
| Listings go out of date | Every listing carries `verified_on` and is hidden when stale; partners are asked to re-confirm monthly. |
| Low connectivity | Offline-first app, push-to-talk audio, and offline speech recognition in Phase 2. |
| Teachers too busy | The talent list and recommendations take one tap; courses are optional and paid. |

## Measures we report each quarter

**Reach:**
- Students profiled.
- Students active each month.
- Share of girls.
- Number of districts.

**Outcomes:**
- Applications made.
- Applicants shortlisted or placed.
- Scholarships claimed.
- Skill levels raised.

**Quality:**
- AI–teacher kappa.
- Share of AI items rejected by rules (should fall).
- p95 sync time.

**Sustainability:**
- Teachers earning.
- Funder money disbursed.
- Cost per student.
