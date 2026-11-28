// The registry of every decision Disha makes: which fixed rule or formula decides it, or which AI task helps.
// The X-ray panel, the "How Disha decides" screen and docs/HOW_DISHA_DECIDES.md are all built from this list,
// and the constants are read from the modules that use them, so the explanation can't drift from the code.

import { ALMOST_SHARE, READY_SHARE } from "./readiness.ts";
import { DEMAND, FRW_WEIGHTS, MET, REACH_PARTS, UNKNOWN_LEVELS, WORTH_PARTS } from "./fitreach.ts";
import { MAX_ITEMS, MIN_ITEMS, STOP_LEVEL_CONFIDENCE, STOP_SE } from "./irt.ts";
import { GROWTH_PER_MONTH, LEITNER_DAYS, MASTERED } from "./pathways.ts";
import { RPL_LEVEL, RPL_MIN_AGE } from "./rpl.ts";
import { EVIDENCE_WEIGHTS, MAX_CONFIRMED_ORDERS, PRIOR, STRONG_CONFIDENCE } from "./tracing.ts";
import { UIMODE_RULE } from "./uimode.ts";
import { COURSE_RULE } from "./courses.ts";
import { APPLY_DOCS, AUTOCONFIRM_RULE, IDENTITY_RULE, OVERRIDE_RULE, PAYCHECK_RULE } from "./trust.ts";
import type { KB } from "./types.ts";

export type RegistryKind = "rule" | "formula" | "ai" | "guardrail";

export interface RegistryEntry {
  id: string;
  kind: RegistryKind;
  /** pipeline step it belongs to */
  step: "onboarding" | "interests" | "skills" | "careers" | "schemes" | "opportunities" | "aim_high" | "safety" | "payouts" | "access";
  title: string;
  /** what it decides, in plain words */
  decides: string;
  /** the formula or rule, written out */
  formula?: string;
  constants?: Record<string, unknown>;
  /** where it lives in the code */
  file: string;
  /** for AI entries: what checks its output before use */
  checked_by?: string;
}

export const PIPELINE = [
  { step: "onboarding", en: "Who is she? Age, situation, reading comfort → which screens she gets" },
  { step: "interests", en: "What does she like? Picture cards, or her own words by voice or typing" },
  { step: "skills", en: "What can she do? Answers, tests, work samples, teacher ratings, paid jobs → level 1-4 per skill" },
  { step: "careers", en: "Which careers fit? Fit + Reach + Worth, spread across sectors" },
  { step: "schemes", en: "Which scholarships and schemes? JsonLogic rule per scheme" },
  { step: "opportunities", en: "Which internships, apprenticeships, jobs, mentors? Hard checks + skill share" },
  { step: "aim_high", en: "Which higher-study route and exam? Route graph + readiness + study plan" },
  { step: "safety", en: "Child safety, consent and privacy guardrails around everything" },
  { step: "payouts", en: "Who confirms a skill, and when a donor's money may go to her" },
  { step: "access", en: "Who may sign in and what each role may see" },
] as const;

export const REGISTRY: RegistryEntry[] = [
  // ---------- onboarding ----------
  { id: "rule.uimode", kind: "rule", step: "onboarding", title: "Which screens she gets",
    decides: "Picture mode, mixed mode or voice/text mode, from age and reading comfort. She can always switch.",
    formula: `reads 'someone helps' or age < ${UIMODE_RULE.pictureBelowAge} → picture; reads 'a little' or age < ${UIMODE_RULE.voiceTextFromAge} → mixed; else (reads easily) → voice/text`,
    constants: { ...UIMODE_RULE }, file: "packages/engine/src/uimode.ts" },
  { id: "rule.consent_age", kind: "guardrail", step: "safety", title: "Who may give consent",
    decides: "A student who is certainly 18 or older may agree herself; anyone else (or unknown age) needs a parent's signed form.",
    formula: "currentYear − birthYear ≥ 19 → may self-consent (birth month unknown, so stay on the safe side)",
    file: "packages/engine/src/safety.ts (isMinor)" },

  // ---------- interests ----------
  { id: "formula.riasec_cards", kind: "formula", step: "interests", title: "Interests from picture cards",
    decides: "Interest score per RIASEC letter from the 18 like/dislike cards.",
    formula: "score(letter) = liked cards of that letter ÷ 3", file: "apps/web/src/data/cards.ts" },
  { id: "ai.interests", kind: "ai", step: "interests", title: "AI: interests from her own words",
    decides: "Reads free speech or text (Tamil, Hindi, English) and proposes RIASEC letters with quotes.",
    checked_by: "guard.interest_quote", file: "apps/api/app/adapters/gemini.py (interests)" },
  { id: "guard.interest_quote", kind: "guardrail", step: "interests", title: "Interest check",
    decides: "Keeps an AI interest only if the letter is one of R I A S E C and its quote is really in what she said.",
    file: "packages/engine/src/interests.ts (checkInterests)" },
  { id: "rule.interest_keywords", kind: "rule", step: "interests", title: "Interests offline",
    decides: "With no internet, finds RIASEC letters from a word list in Tamil, Hindi and English.",
    file: "packages/engine/src/interests.ts (interestsFromKeywords)" },
  { id: "rule.followup_when", kind: "rule", step: "interests", title: "When to ask a follow-up",
    decides: "Asks one more question when her answer was vague, so the conversation follows what she said.",
    formula: "vague = fewer than 2 interest areas found OR fewer than 6 words; at most 2 follow-ups", file: "packages/engine/src/aichecks.ts (isVague)" },
  { id: "ai.talk_followup", kind: "ai", step: "interests", title: "AI: follow-up question",
    decides: "Writes one short follow-up question in her language that builds on what she just said.",
    checked_by: "guard.followup", file: "apps/api/app/adapters/gemini_tasks.py (followup)" },
  { id: "guard.followup", kind: "guardrail", step: "interests", title: "Follow-up check",
    decides: "Keeps the AI question only if it is one short question that does not ask about caste, religion, money, phone number, address or Aadhaar. Otherwise a fixed question is asked.",
    file: "packages/engine/src/aichecks.ts (checkFollowup)" },
  { id: "rule.interest_unknown", kind: "rule", step: "interests", title: "No interests given",
    decides: "If she skips interests ('don't know yet'), no interest is guessed: the interest part is 0 for every career, so it favours none and careers are ranked on skills, reach and local demand.",
    formula: "interest = cosine(empty vector, career) = 0 for every career", file: "packages/engine/src/fitreach.ts (studentRiasecVec)" },

  // ---------- skills ----------
  { id: "ai.extract_skills", kind: "ai", step: "skills", title: "AI: skills from an answer",
    decides: "Turns a spoken or typed answer into a transcript, skills and experiences, each with her own words as evidence.",
    checked_by: "guard.skill_ids", file: "apps/api/app/adapters/gemini.py (extract)" },
  { id: "guard.skill_ids", kind: "guardrail", step: "skills", title: "Skill check",
    decides: "Drops any skill id not in the skill list, or without a quote. Offline, a keyword match is used instead.",
    file: "apps/api/app/adapters/gemini.py, apps/web/src/lib/keywords.ts" },
  { id: "formula.tracing", kind: "formula", step: "skills", title: "Skill level 1-4 (Bayesian tracing)",
    decides: "Her level and confidence in every sub-skill, from all evidence.",
    formula: "posterior ∝ prior × Π likelihood(evidence | level)^(weight × age factor × rater reliability); learning drift +0.05/week (max 0.2); spreads 0.5 / 0.25 to related sub-skills; optional leniency bias correction (applyLeniency, off by default)",
    constants: { prior: PRIOR, evidence_weights: EVIDENCE_WEIGHTS, half_life_days: { said: 365, shown: 730 }, strong: `level ≥ 3 and confidence ≥ ${STRONG_CONFIDENCE}`, max_confirmed_orders: MAX_CONFIRMED_ORDERS },
    file: "packages/engine/src/tracing.ts (foldEvents)" },
  { id: "formula.irt", kind: "formula", step: "skills", title: "Adaptive test (IRT)",
    decides: "Which question comes next, and when the test stops.",
    formula: "2PL model P(correct) = 1/(1+e^(−a(θ−b))); next = most informative of top 3; stop when SE ≤ 0.4, or level confidence ≥ 0.85 after 3 questions, or after 8",
    constants: { STOP_SE, STOP_LEVEL_CONFIDENCE, MIN_ITEMS, MAX_ITEMS }, file: "packages/engine/src/irt.ts" },
  { id: "ai.vision_score", kind: "ai", step: "skills", title: "AI: scoring a work photo or video",
    decides: "Scores each checklist step 0/1/2 with a reason (and a time stamp for video). Counts as one rater, never the final word.",
    checked_by: "formula.rater_kappa", file: "apps/api/app/adapters/gemini_vision.py, gemini_video.py" },
  { id: "formula.rater_kappa", kind: "guardrail", step: "skills", title: "How much the AI rater counts",
    decides: "The AI's scores are weighted by how well it agrees with teachers; a teacher's score replaces the AI's for the same work.",
    formula: "AI weight = max(0.3, quadratic weighted kappa vs teachers)", file: "apps/api/app/services/raters.py" },

  // ---------- careers ----------
  { id: "formula.fitreach", kind: "formula", step: "careers", title: "Career score (Fit + Reach + Worth)",
    decides: "How well each career fits her now and could fit her later.",
    formula: `score = ${FRW_WEIGHTS.fit}·Fit + ${FRW_WEIGHTS.reach}·Reach + ${FRW_WEIGHTS.worth}·Worth; Reach = ${REACH_PARTS.aptitude}·aptitude + ${REACH_PARTS.closeness}·closeness + ${REACH_PARTS.education}·education; Worth = ${WORTH_PARTS.interest}·interest + ${WORTH_PARTS.demand}·local demand`,
    constants: { FRW_WEIGHTS, REACH_PARTS, WORTH_PARTS, DEMAND, need_met_at: MET, no_evidence_levels: UNKNOWN_LEVELS, no_evidence_credit: 0.5 },
    file: "packages/engine/src/fitreach.ts" },
  { id: "rule.mmr", kind: "rule", step: "careers", title: "Spread across sectors",
    decides: "Re-ranks careers so the list is not all one kind of work.",
    formula: "MMR re-rank, λ = 0.7, at least 4 sectors in the top list", file: "packages/engine/src/fitreach.ts (mmrRerank)" },
  { id: "ai.suggest_careers", kind: "ai", step: "careers", title: "AI: wider career ideas",
    decides: "Proposes careers she may not have thought of, chosen only from our career catalogue, with a reason each.",
    checked_by: "guard.career_catalogue", file: "apps/api/app/adapters/gemini.py (suggest_careers)" },
  { id: "guard.career_catalogue", kind: "guardrail", step: "careers", title: "Career catalogue check",
    decides: "Drops any AI career that is not in the catalogue; the rest are scored by the same Fit + Reach + Worth formula. The AI never ranks.",
    file: "apps/api/app/routers/v1.py (careers/suggest), packages/engine/src/fitreach.ts" },
  { id: "ai.personalise_careers", kind: "ai", step: "careers", title: "AI: her order and her reasons",
    decides: "Re-orders the formula's top 5 careers for her and writes 'why this fits you' for each, quoting her own words.",
    checked_by: "guard.personal_order", file: "apps/api/app/adapters/gemini_tasks.py (personalise_careers)" },
  { id: "guard.personal_order", kind: "guardrail", step: "careers", title: "Shortlist and quote check",
    decides: "The rules decide which careers are allowed; the AI may only change their order. Careers outside the shortlist are dropped, careers it left out keep formula order, and a reason is kept only if its quote is really in what she said.",
    file: "packages/engine/src/aichecks.ts (checkPersonalised)" },

  // ---------- opportunities ----------
  { id: "rule.readiness", kind: "rule", step: "opportunities", title: "Ready / Almost / Later",
    decides: "Whether she is ready to apply for an internship, apprenticeship, job, mentorship or training.",
    formula: `hard checks (age, education, programme rule) must not fail; skill share = needs met ÷ needs; ≥ ${READY_SHARE * 100}% Ready, ≥ ${ALMOST_SHARE * 100}% Almost, else Later`,
    constants: { READY_SHARE, ALMOST_SHARE, need_met_at: MET }, file: "packages/engine/src/readiness.ts" },
  { id: "rule.rpl", kind: "rule", step: "opportunities", title: "RPL certification",
    decides: "She can apply for a government certificate (PMKVY RPL) for a skill she already has.",
    formula: `level ≥ ${RPL_LEVEL} in a sub-skill the qualification covers, and age ≥ ${RPL_MIN_AGE}`, file: "packages/engine/src/rpl.ts" },

  // ---------- aim high ----------
  { id: "formula.pathways", kind: "formula", step: "aim_high", title: "Higher-study route and readiness",
    decides: "Shortest route to a goal (doctor, engineer, CA ...), exam readiness, and a weekly study plan.",
    formula: "Dijkstra over the route graph with age limits; readiness grows by ability + 0.05/month of study; topics in prerequisite order; spaced practice at 1, 2, 4, 8, 16 days",
    constants: { GROWTH_PER_MONTH, MASTERED, LEITNER_DAYS }, file: "packages/engine/src/pathways.ts" },

  // ---------- safety and payouts ----------
  { id: "guard.hazard_minor", kind: "guardrail", step: "safety", title: "No hazardous tasks under 18",
    decides: "Removes hazardous checklist steps (e.g. live wiring) for anyone under 18 or of unknown age.",
    file: "packages/engine/src/safety.ts" },
  { id: "guard.consent_scope", kind: "guardrail", step: "safety", title: "Consent scopes",
    decides: "Photo/video scoring needs the 'photos' scope; sharing a credential needs 'share_portfolio'. Checked on the server.",
    file: "apps/api/app/routers/see.py, proof.py" },
  { id: "guard.face_blur", kind: "guardrail", step: "safety", title: "Face blur on the phone",
    decides: "Faces are pixelated on the phone before any video leaves it; filming is refused if the face model fails.",
    file: "apps/web/src/lib/video.ts" },
  { id: "rule.override", kind: "rule", step: "skills", title: "Teacher override of a skill level",
    decides: "A teacher may set a different level with a written reason. Lowering always applies. Raising is shown to her but never counts as proof for payouts, and 'Strong' still needs her own work.",
    formula: `latest override per sub-skill wins; reason ≥ ${OVERRIDE_RULE.minReasonChars} characters; computed level kept beside it`,
    constants: { ...OVERRIDE_RULE }, file: "packages/engine/src/trust.ts (applyOverrides)" },
  { id: "rule.identity", kind: "rule", step: "skills", title: "Is it really her in the video?",
    decides: "A liveness challenge (show N fingers, checked by hand tracking) and a face match against the face she enrolled, computed on the phone. Only the numbers leave the phone.",
    formula: `verified = liveness passed AND share of frames with face distance ≤ ${IDENTITY_RULE.maxFaceDistance} ≥ ${IDENTITY_RULE.minMatchedShare}`,
    constants: { ...IDENTITY_RULE }, file: "packages/engine/src/trust.ts (identityCheck), apps/web/src/lib/identity.ts" },
  { id: "rule.autoconfirm", kind: "rule", step: "skills", title: "System confirms, or the teacher looks",
    decides: "An AI-scored task video is confirmed by the system only when every check passes; otherwise, and for a random spot-check share, it goes to the teacher.",
    formula: `identity verified ∧ no integrity flags ∧ no safety notes ∧ cannot-see ≤ ${AUTOCONFIRM_RULE.maxCannotSee * 100}% ∧ AI κ ≥ ${AUTOCONFIRM_RULE.minKappa} ∧ not hazardous for a minor; then ${AUTOCONFIRM_RULE.auditShare * 100}% still go to a teacher`,
    constants: { ...AUTOCONFIRM_RULE }, file: "packages/engine/src/trust.ts (autoConfirm)" },
  { id: "rule.paycheck", kind: "rule", step: "payouts", title: "May a donor pay her?",
    decides: "Before money moves: the skill is shown by her own work (not an override), need is verified by a teacher-seen document, her family agreed to share, the video was really her, and she was not paid for it before.",
    formula: `skill ∧ need (income ≤ ₹${PAYCHECK_RULE.maxIncomeInr.toLocaleString("en-IN")} ∧ teacher saw one of ${PAYCHECK_RULE.needDocs.join("/")}) ∧ consent ∧ identity ∧ once`,
    constants: { ...PAYCHECK_RULE }, file: "packages/engine/src/trust.ts (payCheck), apps/api/app/routers/trust.py" },
  { id: "rule.apply_docs", kind: "rule", step: "opportunities", title: "May she send the application?",
    decides: "Every document the listing needs is verified (by a teacher, or a Disha-made resume from her verified record) and she is not 'Later' on readiness.",
    formula: Object.entries(APPLY_DOCS).map(([k, v]) => `${k}: ${v.join(", ")}`).join("; "),
    constants: { ...APPLY_DOCS }, file: "packages/engine/src/trust.ts (applyCheck)" },
  { id: "ai.resume_read", kind: "ai", step: "opportunities", title: "AI: reading an uploaded resume",
    decides: "Reads a resume photo or PDF and proposes skills, education and experience with quotes.",
    checked_by: "guard.skill_ids", file: "apps/api/app/routers/trust.py (resume_read)" },
  { id: "ai.doc_check", kind: "ai", step: "opportunities", title: "AI: first look at a document",
    decides: "Says what kind of document a photo shows and whether the name on it matches. It never verifies: a teacher does.",
    checked_by: "rule.apply_docs", file: "apps/api/app/routers/trust.py (doc_check)" },
  { id: "rule.otp", kind: "guardrail", step: "access", title: "Sign-in with a one-time code",
    decides: "Phone or email + a 6-digit code (10 minutes, 5 tries, one use, only its hash stored). The number or email is stored only as an HMAC. Role comes from the school's code, never from the phone.",
    file: "apps/api/app/routers/accounts.py" },
  { id: "guard.role_scope", kind: "guardrail", step: "access", title: "What each role sees",
    decides: "Students and teachers see only their school (row-level security). Donors see anonymous pay checks and payouts only. Employers see applications students chose to send, nothing else.",
    file: "apps/api/app/auth.py, migrations/0003_security.sql, 0011_accounts.sql" },
  { id: "guard.buyer_privacy", kind: "guardrail", step: "safety", title: "Customer privacy",
    decides: "A customer confirming a job is asked first whether Disha may keep their name; without a yes, only the three answers are kept. Confirmation tokens stay in the URL fragment (#confirm=) and POST body, never in server logs; optional phone OTP stores only HMAC(AUTH_SECRET, phone).",
    file: "apps/api/app/routers/v2.py (confirm)" },
  { id: "rule.order_verify", kind: "rule", step: "payouts", title: "Paid-job anti-self-confirm, buyer OTP & teacher verification",
    decides: "Confirmation tokens live only in POST bodies (/v2/confirm/info, /v2/confirm). Orders above ₹500 (configurable) require buyer phone OTP. Confirmations without OTP or teacher verification are downgraded to lower weight (1) and capped below Level 4; only OTP-verified or teacher-verified orders unlock Level 4. Teacher verification requires method + reason and is capped at 10/teacher/week and 2/student.",
    formula: "self_confirm_no_otp → unverified; no_otp → weight 1, paid=false (cap L4 ≤ 0.4); otp ∨ teacher_verify → weight 2, paid=true",
    constants: { maxLinksPerDay: 5, maxConfirmsPerWeek: 5, orderOtpThresholdInr: 500, maxTeacherVerifiesPerWeek: 10, maxTeacherVerifiesPerStudent: 2 },
    file: "apps/api/app/routers/v2.py (order_link, confirm, teacher_verify_order), packages/engine/src/tracing.ts" },
  { id: "rule.publish", kind: "rule", step: "safety", title: "Who may publish a profile",
    decides: "Opt-in only (publish_profile consent). Minors or unknown age can never go public (verified_partners max with guardian consent). Instant unpublish removes the snapshot.",
    formula: "is_minor → visibility ∈ {private, school, verified_partners}; public requires age ≥ 18 ∧ publish_profile consent",
    file: "apps/api/app/routers/publish.py" },
  { id: "guard.publish", kind: "guardrail", step: "safety", title: "Published profile allow-list",
    decides: "Server builds published snapshots from a strict allow-list (extra=forbid): pseudonym, avatar, district, age band, verified skills, interest tags. Never caste, income, gender, phone, birth date, documents, free text, or minor's school. 128-bit slug, noindex, no-store, aggregate view counts only.",
    file: "apps/api/app/routers/publish.py (PublishedSnapshot)" },
  { id: "rule.course_access", kind: "rule", step: "skills", title: "Which course lessons are open",
    decides: "Free course: all lessons. Any course: the first lesson is a free preview. Pay per lesson: a lesson opens after its payment. Subscription: all lessons while it is valid. Locked lessons send only their title; quiz answers never leave the server.",
    formula: `open = own course ∨ plan = free ∨ position < ${COURSE_RULE.previewLessons} ∨ paid(lesson) ∨ paid subscription with valid_until > now; quiz pass ≥ ${COURSE_RULE.quizPass * 100}% → a "task" evidence event`,
    constants: { ...COURSE_RULE }, file: "apps/api/app/routers/courses.py (module_open)" },
  { id: "rule.course_recommend", kind: "rule", step: "skills", title: "Which teacher courses to suggest",
    decides: "A course is suggested when the skill it trains is below what one of her top careers needs, or is a gap for an internship/job she is 'Almost' ready for.",
    formula: `skill level < level needed by one of her top ${COURSE_RULE.topCareers} careers ∨ skill ∈ gaps of an 'Almost' opportunity`,
    file: "packages/engine/src/courses.ts (recommendCourses)" },
  { id: "guard.payment_signature", kind: "guardrail", step: "payouts", title: "Course payments",
    decides: "The server sets the price and creates the Razorpay order; a lesson unlocks only after the server checks HMAC-SHA256(order_id|payment_id) against Razorpay's signature. No card or UPI data touches Disha. Without keys, a labelled demo payment where no money moves.",
    formula: `teacher earns ${(1 - COURSE_RULE.platformFee) * 100}%, Disha keeps ${COURSE_RULE.platformFee * 100}%`,
    file: "apps/api/app/adapters/razorpay.py" },
  { id: "rule.proof_pays", kind: "rule", step: "payouts", title: "Proof Pays",
    decides: "A funder's money is released only when a zero-knowledge proof shows the skill milestone was met.",
    file: "contracts/src/ProofPays.sol, packages/zk" },
];

/** One registry entry per scheme or programme rule in the knowledge base (JsonLogic). */
export function ruleEntries(kb: KB): RegistryEntry[] {
  return Object.values(kb.rules).map((r) => ({
    id: `rule.${r.id}`,
    kind: "rule" as const,
    step: (r.id.startsWith("opp_") ? "opportunities" : "schemes") as RegistryEntry["step"],
    title: kb.schemes[r.id]?.name.en ?? r.id,
    decides: r.id.startsWith("opp_") ? "Programme eligibility (JsonLogic). The AI never decides eligibility." : "Scheme eligibility: eligible, need more information, or eligible later (JsonLogic). The AI never decides eligibility.",
    formula: r.notes ?? JSON.stringify(r.rule),
    constants: { updated: r.updated ?? null },
    file: `packages/kb/rules/${r.id}.json`,
  }));
}

export function registryOf(kb: KB): RegistryEntry[] {
  return [...REGISTRY, ...ruleEntries(kb)];
}
