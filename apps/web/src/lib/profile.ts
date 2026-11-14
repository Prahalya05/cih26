// Builds the student's profile (for matching) and facts (for scheme rules) from their answers.
// Pure functions: easy to test and the same on every phone.

import { evaluateAll, personaFromProfile, recommendV2, type Facts, type Persona, type Profile } from "@disha/engine";
import { riasecFromCards } from "../data/cards";
import { educationFromLevel, factsFromAnswers } from "../data/facts";
import { QUESTIONS } from "../data/questions";
import type { Action, Student } from "./db";
import { kb } from "./kb";

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

export function claimedSkills(student: Student, actions: Action[], lang: "ta" | "en"): ClaimedSkill[] {
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
      if (chip) add(chip.skill, TAP_CONFIDENCE, { text: `${chip.emoji} ${lang === "ta" ? chip.ta : chip.en}`, source: "tap" });
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

export function personaOf(student: Student, skills: ClaimedSkill[]): Persona {
  return {
    education: educationFromLevel(student.factAnswers.level as string | undefined),
    riasec: riasecFromCards(student.cards),
    skills: skills.map((s) => ({ id: s.id, confidence: Math.round(s.confidence * 100) / 100 })),
  };
}

export function factsOf(student: Student): Facts {
  return factsFromAnswers(student.factAnswers);
}

export const EMPTY_PROFILE: Profile = { units: {}, aptitude: {} };

/** Everything the results screens and the teacher view need, computed on the phone.
 * Careers come from measured skill levels (profile, rebuilt from evidence events). */
export function analyse(student: Student, actions: Action[], lang: "ta" | "en", profile: Profile = EMPTY_PROFILE) {
  const skills = claimedSkills(student, actions, lang);
  const persona = personaOf(student, skills);
  const facts = factsOf(student);
  const careers = recommendV2(kb, personaFromProfile(profile, { education: persona.education, riasec: persona.riasec }));
  const schemes = evaluateAll(kb, facts);
  const recommendations = actions.filter((a) => a.kind === "recommend" && a.student_id === student.id);
  return { skills, persona, facts, careers, schemes, recommendations };
}

export type Analysis = ReturnType<typeof analyse>;

/** Talent flag for the teacher: she can already do most of what one of her careers needs (Fit 80%+). */
export const STRONG_FIT = 0.8;

export function isStrongMatch(a: Analysis) {
  return a.careers.careers.some((c) => c.parts.fit >= STRONG_FIT);
}
