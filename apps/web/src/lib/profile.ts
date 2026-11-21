// Builds the student's profile (for matching) and facts (for scheme rules) from their answers.
// Pure functions: easy to test and the same on every phone. traceAnalysis() reports each decision to the X-ray.

import {
  ageFromBirthYear, careerDecision, evaluateAll, explainCareer, explainScheme, personaFromProfile, rankOpportunities,
  recommendV2, riasecFromClaims, schemeDecision, type Facts, type Persona, type PersonaV2, type Profile,
} from "@disha/engine";
import { riasecFromCards } from "../data/cards";
import { educationFromLevel, factsFromAnswers } from "../data/facts";
import { QUESTIONS } from "../data/questions";
import type { Action, Student } from "./db";
import { kb, OPPORTUNITIES } from "./kb";
import { emit } from "./xray";
import { POSTED } from "./postings";

export interface Evidence {
  text: string;
  source: "tap" | "voice" | "text";
}

export interface ClaimedSkill {
  id: string;
  confidence: number;
  evidence: Evidence[];
  endorsed: boolean;
}

const TAP_CONFIDENCE = 0.7;
const ENDORSED_CONFIDENCE = 0.9;

export function claimedSkills(student: Student, actions: Action[], lang: string): ClaimedSkill[] {
  const map = new Map<string, ClaimedSkill>();
  const add = (id: string, confidence: number, ev: Evidence) => {
    if (!kb.skills[id]) return;
    const cur = map.get(id) ?? { id, confidence: 0, evidence: [], endorsed: false };
    cur.confidence = Math.max(cur.confidence, confidence);
    if (!cur.evidence.some((e) => e.text === ev.text)) cur.evidence.push(ev);
    map.set(id, cur);
  };
  for (const q of QUESTIONS) {
    const a = student.answers[q.id];
    if (!a) continue;
    for (const chipSkill of a.chips) {
      const chip = q.chips.find((c) => c.skill === chipSkill);
      if (chip) add(chip.skill, TAP_CONFIDENCE, { text: `${chip.emoji} ${(lang === "ta" && chip.ta) || (lang === "hi" && (chip as { hi?: string }).hi) || chip.en}`, source: "tap" });
    }
    for (const s of a.extracted ?? []) add(s.id, s.confidence, { text: s.evidence, source: s.source });
  }
  for (const act of actions) {
    if (act.kind !== "endorse" || act.student_id !== student.id) continue;
    const id = String(act.payload.skill_id);
    const cur = map.get(id);
    if (cur) {
      cur.endorsed = true;
      cur.confidence = Math.max(cur.confidence, ENDORSED_CONFIDENCE);
    }
  }
  return [...map.values()].sort((a, b) => Number(b.endorsed) - Number(a.endorsed) || b.confidence - a.confidence);
}

/**
 * Her interests: from the picture cards if she answered any, else from her own words (checked by rule), else none.
 * "None" (skipped / don't know yet) is not guessed: the interest part of career scores is then 0 for every career.
 */
export function riasecOf(student: Student): Persona["riasec"] | undefined {
  if (Object.keys(student.cards).length > 0) return riasecFromCards(student.cards);
  if (student.interests?.claims?.length) return riasecFromClaims(student.interests.claims);
  return undefined;
}

export function personaOf(student: Student, skills: ClaimedSkill[]): Persona {
  return {
    education: educationFromLevel(levelOf(student)),
    riasec: riasecOf(student),
    skills: skills.map((s) => ({ id: s.id, confidence: Math.round(s.confidence * 100) / 100 })),
  };
}

/** Study level: the facts answer, else what the onboarding situation already told us. */
export function levelOf(student: Student): string | undefined {
  const l = student.factAnswers.level as string | undefined;
  if (l) return l;
  if (student.scenario === "school" && student.current_class) return String(student.current_class);
  if (student.scenario === "stopped" || student.scenario === "seeking" || student.scenario === "working") return "out";
  return undefined;
}

export function ageOf(student: Student): number | undefined {
  const a = student.factAnswers.age;
  return typeof a === "number" ? a : ageFromBirthYear(student.birth_year);
}

export function factsOf(student: Student): Facts {
  const answers = { ...student.factAnswers };
  // Age is asked once, as the birth year when she joins.
  if (answers.age === undefined) { const a = ageOf(student); if (a !== undefined) answers.age = a; }
  if (answers.level === undefined) { const l = levelOf(student); if (l) answers.level = l; }
  const facts = factsFromAnswers(answers);
  if (student.scenario === "working") facts.full_time_job = facts.full_time_job ?? true;
  return facts;
}

export const EMPTY_PROFILE: Profile = { units: {}, aptitude: {} };

/** Everything the results screens and the teacher view need, computed on the phone.
 * Careers come from measured skill levels (profile, rebuilt from evidence events). */
export function analyse(student: Student, actions: Action[], lang: string, profile: Profile = EMPTY_PROFILE) {
  const skills = claimedSkills(student, actions, lang);
  const persona = personaOf(student, skills);
  const facts = factsOf(student);
  const personaV2: PersonaV2 = personaFromProfile(profile, { education: persona.education, riasec: persona.riasec });
  const careers = recommendV2(kb, personaV2);
  const schemes = evaluateAll(kb, facts);
  const opportunities = rankOpportunities(kb, [...POSTED, ...OPPORTUNITIES], { levels: personaV2.levels, facts, age: ageOf(student), education: persona.education });
  const recommendations = actions.filter((a) => a.kind === "recommend" && a.student_id === student.id);
  // The latest "apply" note per listing wins, so "I did not apply after all" (withdrawn) takes it back.
  const latest = new Map<string, Action>();
  for (const x of actions) {
    if (x.kind !== "apply" || x.student_id !== student.id) continue;
    const key = String(x.payload.opportunity_id);
    const prev = latest.get(key);
    if (!prev || x.created_at >= prev.created_at) latest.set(key, x);
  }
  const applications = [...latest.values()].filter((x) => !x.payload.withdrawn);
  return { skills, persona, personaV2, facts, careers, schemes, opportunities, recommendations, applications };
}

export type Analysis = ReturnType<typeof analyse>;

/** Talent flag for the teacher: she can already do most of what one of her careers needs (Fit 80%+). */
export const STRONG_FIT = 0.8;

export function isStrongMatch(a: Analysis) {
  return a.careers.careers.some((c) => c.parts.fit >= STRONG_FIT);
}

/**
 * Reports the decisions behind one analysis to the X-ray: interests, every listed career with its formula,
 * every scheme with its conditions, and opportunity readiness. Each is recorded once until its result changes.
 */
export function traceAnalysis(student: Student, a: Analysis) {
  const sid = student.id;
  const r = a.persona.riasec;
  const cards = Object.keys(student.cards).length;
  emit({
    step: "interests", source: "RULE", ref: r ? (cards ? "formula.riasec_cards" : "guard.interest_quote") : "rule.interest_unknown",
    title: r ? `Interests: ${Object.entries(r).filter(([, v]) => (v ?? 0) > 0).sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0)).map(([k, v]) => `${k} ${v}`).join(", ") || "none liked"}` : "Interests unknown → not guessed",
    subject: `interests:${sid}`, output: r ? JSON.stringify(r) : "none",
    why: r ? (cards ? [`${cards} picture cards answered`, "score(letter) = liked cards of that letter ÷ 3"]
      : [`from her own words (${student.interests?.mode})`, ...(student.interests?.claims ?? []).map((c) => `${c.letter}: "${c.evidence}"`)])
      : ["she chose to skip interests", "interest part of Worth = 0 for every career, so it favours none"],
  }, `interests:${sid}`);

  a.careers.careers.forEach((c, i) => {
    const b = explainCareer(kb, a.personaV2, c.occupation_id);
    if (!b) return;
    const d = careerDecision(b, kb.occupations[c.occupation_id].name.en, i + 1);
    emit(d, `${sid}:${d.subject}`);
  });
  emit({
    step: "careers", source: "RULE", ref: "rule.mmr", title: `Career list spread over ${new Set(a.careers.careers.map((c) => c.sector)).size} sectors`,
    subject: `careers:${sid}`, output: a.careers.careers.map((c) => c.occupation_id.replace("occ_", "")).join(", "),
    why: [`${Object.keys(kb.occupations).length} careers scored with Fit + Reach + Worth`, "MMR re-rank (λ 0.7) keeps at least 4 sectors in the top 8"],
  }, `${sid}:careers`);

  for (const s of a.schemes) {
    const x = explainScheme(kb, s.scheme_id, a.facts);
    const d = schemeDecision(x, s.name.en);
    if (s.eligible_if) d.why.push(`Eligible later: after joining ${s.eligible_if.stage} (${s.eligible_if.course_type})`);
    emit(d, `${sid}:${d.subject}`);
  }

  for (const { opp, r: rd } of a.opportunities) {
    if (rd.status === "later" && rd.checks.every((c) => c.ok !== false) && rd.skill_share === 0) continue; // nothing to say yet
    emit({
      step: "opportunities", source: "RULE", ref: "rule.readiness", title: `${opp.title.en}: ${rd.status === "ready" ? "Ready" : rd.status === "almost" ? "Almost" : "Later"}`,
      subject: `opp:${opp.id}`, output: rd.status, why: rd.why,
    }, `${sid}:opp:${opp.id}`);
  }
}
