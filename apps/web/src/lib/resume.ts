// A resume made by Disha from her record. Skills shown by her own work (tests, tasks, work samples, teacher ratings,
// paid jobs) are marked verified; things she only said are listed as "says she can". Only her first name goes out.

import type { Profile } from "@disha/engine";
import type { Student } from "./db";
import { kb } from "./kb";
import type { Analysis } from "./profile";

export interface ResumeSkill { id: string; level?: number; verified: boolean; quote?: string }
export interface Resume { source: "disha" | "upload"; first_name: string; headline?: string; skills: ResumeSkill[]; education: string[]; experience: string[]; languages: string[] }

/** Extra lines she added (or that came from an uploaded resume), kept on the phone. */
export interface ResumeExtras { education: string[]; experience: string[]; languages: string[]; hidden: string[]; uploaded_skills: { id: string; quote: string }[] }

const key = (id: string) => `disha.resume.${id}`;
export function loadExtras(id: string): ResumeExtras {
  try { return { education: [], experience: [], languages: [], hidden: [], uploaded_skills: [], ...JSON.parse(localStorage.getItem(key(id)) ?? "{}") }; }
  catch { return { education: [], experience: [], languages: [], hidden: [], uploaded_skills: [] }; }
}
export function saveExtras(id: string, x: ResumeExtras) { try { localStorage.setItem(key(id), JSON.stringify(x)); } catch { /* full */ } }

const LANG_NAMES: Record<string, string> = { ta: "Tamil", hi: "Hindi", en: "English" };

export function buildResume(student: Student, a: Analysis, profile: Profile, extras: ResumeExtras): Resume {
  const levelOfSkill = (skill: string) => {
    const subs = kb.graph?.bySkill?.[skill] ?? [skill];
    const units = subs.map((u) => profile.units[u]).filter(Boolean);
    if (!units.length) return { level: undefined as number | undefined, shown: false };
    return { level: Math.max(...units.map((u) => u.level)), shown: units.some((u) => u.performance) };
  };
  const skills: ResumeSkill[] = a.skills.filter((s) => !extras.hidden.includes(s.id)).map((s) => {
    const l = levelOfSkill(s.id);
    return { id: s.id, level: l.level, verified: l.shown || s.endorsed, quote: s.evidence[0]?.text };
  });
  for (const u of extras.uploaded_skills) if (!skills.some((s) => s.id === u.id) && !extras.hidden.includes(u.id)) skills.push({ id: u.id, verified: false, quote: u.quote });
  skills.sort((x, y) => Number(y.verified) - Number(x.verified) || (y.level ?? 0) - (x.level ?? 0));
  const top = a.careers.careers[0];
  const education = [
    ...(student.current_class ? [`Class ${student.current_class} (studying)`] : a.persona.education ? [`Education: ${a.persona.education}`] : []),
    ...extras.education,
  ];
  const experience = [
    ...Object.values(student.answers).flatMap((ans) => (ans.experiences ?? []).map((e) => e.what)).filter(Boolean),
    ...extras.experience,
  ];
  return {
    source: "disha",
    first_name: student.name.split(" ")[0],
    headline: top && a.skills.length ? `Aiming for: ${kb.occupations[top.occupation_id]?.name.en}` : undefined,
    skills: skills.slice(0, 20),
    education: [...new Set(education)].slice(0, 8),
    experience: [...new Set(experience)].slice(0, 8),
    languages: extras.languages.length ? extras.languages : [LANG_NAMES.ta, LANG_NAMES.en],
  };
}
