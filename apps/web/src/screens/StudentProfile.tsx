// A student's profile, in one place: who she is, how Disha talks to her, what she likes, what she can do (levels
// from evidence), documents, applications, consent, and her school's teachers. Students see their own; a teacher
// opens it from the class list.

import { useEffect, useState } from "react";
import type { Go } from "../App";
import { Card, Pill, Screen, useLive } from "../components/ui";
import { Icon, type IconName } from "../components/Icon";
import { useT, type StringKey } from "../lib/i18n";
import { db, scopesOf, type Action, type Student } from "../lib/db";
import { kb } from "../lib/kb";
import { ageOf, analyse, EMPTY_PROFILE } from "../lib/profile";
import { profileOf } from "../lib/skills";
import { cachedDocs, fetchDocs, type DocRow } from "../lib/docs";
import { call, isError, useAccount } from "../lib/auth";

const RIASEC: Record<string, string> = { R: "Hands-on", I: "Curious", A: "Creative", S: "Helping", E: "Leading", C: "Organised" };

export default function StudentProfile({ go, id }: { go: Go; id: string }) {
  const { t, pick, lang } = useT();
  const account = useAccount();
  const student = useLive(() => db.students.get(id), [id], undefined as Student | undefined);
  const actions = useLive(() => db.actions.where("student_id").equals(id).toArray(), [id], [] as Action[]);
  const profile = useLive(() => profileOf(id), [id], EMPTY_PROFILE);
  const [docs, setDocs] = useState<Record<string, DocRow>>(() => cachedDocs(id));
  const [teachers, setTeachers] = useState<{ id: string; name: string; subjects: string[]; avatar: string; courses: number }[]>([]);
  useEffect(() => {
    void fetchDocs(id).then(setDocs);
    void call<{ teachers: typeof teachers }>("/v2/teachers").then((r) => { if (!isError(r)) setTeachers(r.teachers); });
  }, [id]);
  if (!student) return null;
  const a = analyse(student, actions, lang, profile);
  const age = ageOf(student);
  const units = Object.values(profile.units).filter((u) => u.n > 0).sort((x, y) => y.level - x.level || y.confidence - x.confidence);
  const riasec = Object.entries(a.persona.riasec ?? {}).filter(([, v]) => (v ?? 0) > 0).sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0)).slice(0, 3);
  const verifiedDocs = Object.values(docs).filter((d) => d.status === "verified").length;
  const isTeacher = account?.role === "teacher";

  return (
    <Screen title={t("studentProfile")} onBack={() => go(isTeacher ? { name: "teacher" } : { name: "account" })}>
      <Card className="flex items-center gap-4">
        <span className="flex size-16 items-center justify-center rounded-full bg-paper text-4xl">{student.avatar}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-extrabold">{student.name}</p>
          <p className="text-sm text-muted">{[age != null ? t("ageN", { n: age }) : null, student.current_class ? t("classN", { n: student.current_class }) : null,
            student.scenario ? t(`sit_${student.scenario}` as StringKey) : null].filter(Boolean).join(" · ")}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {student.facilitator_code && <Pill>{student.facilitator_code}</Pill>}
            {student.uiMode && <Pill tone="brand">{t(`uimode_${student.uiMode}` as StringKey)}</Pill>}
          </div>
        </div>
      </Card>

      <Section icon="spark" title={t("interests")}>
        {riasec.length ? <div className="flex flex-wrap gap-1">{riasec.map(([k]) => <Pill key={k} tone="good">{RIASEC[k] ?? k}</Pill>)}</div>
          : <p className="text-sm text-muted">{student.interests?.mode === "skipped" ? t("interestsSkipped") : t("notYet")}</p>}
        {student.interests?.text && <p className="mt-2 text-sm text-muted">“{student.interests.text}”</p>}
      </Section>

      <Section icon="award" title={t("skillsAndLevels")}>
        {units.length === 0 && <p className="text-sm text-muted">{t("noSkillsYet")}</p>}
        <ul className="flex flex-col gap-1.5">
          {units.slice(0, 10).map((u) => (
            <li key={u.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{pick(kb.graph?.subskills[u.id]?.name ?? kb.skills[u.id]?.name ?? { en: u.id })}</span>
              {u.performance ? <Icon name="check" className="size-4 text-good" /> : <Icon name="mic" className="size-4 text-faint" />}
              <span className="flex gap-0.5">{[1, 2, 3, 4].map((l) => <span key={l} className={`h-2 w-4 rounded-full ${l <= u.level ? "bg-brand" : "bg-line"}`} />)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted"><Icon name="check" className="inline size-3.5 text-good" /> {t("shownByWork")} · <Icon name="mic" className="inline size-3.5" /> {t("saidOnly")}</p>
      </Section>

      <Section icon="target" title={t("topCareers")}>
        {a.careers.careers.slice(0, 3).map((c) => (
          <button key={c.occupation_id} onClick={() => go({ name: "career", id, occ: c.occupation_id })} className="flex w-full items-center gap-2 py-1 text-left text-sm">
            <span className="flex-1">{pick(kb.occupations[c.occupation_id].name)}</span><Pill>{Math.round(c.score * 100)}%</Pill>
          </button>
        ))}
      </Section>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat value={verifiedDocs} label={t("docsVerified")} onClick={() => go({ name: "docs", id })} />
        <Stat value={a.applications.length} label={t("applications")} onClick={() => go({ name: "results", id, tab: "opps" })} />
        <Stat value={a.schemes.filter((s) => s.status === "eligible").length} label={t("schemesEligible")} onClick={() => go({ name: "results", id, tab: "schemes" })} />
      </div>

      <Section icon="shield" title={t("consentGiven")}>
        <div className="flex flex-wrap gap-1">
          {(["assess", "photos", "share_portfolio"] as const).map((sc) => (
            <Pill key={sc} tone={scopesOf(student).includes(sc) ? "good" : "neutral"}>{scopesOf(student).includes(sc) ? "✓" : "✗"} {t(`scope_${sc}` as StringKey)}</Pill>
          ))}
        </div>
        {!isTeacher && <button className="mt-2 text-sm font-bold text-accent-dark" onClick={() => go({ name: "privacy", id })}>{t("privacy")} →</button>}
      </Section>

      {teachers.length > 0 && !isTeacher && (
        <Section icon="teacher" title={t("myTeachers")}>
          {teachers.map((tc) => (
            <button key={tc.id} onClick={() => go({ name: "teacherProfile", teacherId: tc.id })} className="flex w-full items-center gap-3 py-1.5 text-left">
              <span className="text-2xl">{tc.avatar}</span>
              <span className="min-w-0 flex-1"><span className="block font-bold">{tc.name}</span><span className="block truncate text-xs text-muted">{tc.subjects.join(", ")}</span></span>
              {tc.courses > 0 && <Pill tone="brand">{t("coursesN", { n: tc.courses })}</Pill>}
            </button>
          ))}
        </Section>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Link icon="idcard" label={t("myResume")} onClick={() => go({ name: "resume", id })} />
        <Link icon="chain" label={t("viewMap")} onClick={() => go({ name: "graph", id, from: { name: "studentProfile", id } })} />
      </div>
    </Screen>
  );
}

function Section({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <p className="mb-2 flex items-center gap-2 font-bold"><Icon name={icon} className="size-5 text-accent-dark" />{title}</p>
      {children}
    </Card>
  );
}
function Stat({ value, label, onClick }: { value: number; label: string; onClick: () => void }) {
  return <button onClick={onClick} className="rounded-xl border border-line bg-surface p-3"><p className="text-2xl font-extrabold">{value}</p><p className="text-xs text-muted">{label}</p></button>;
}
function Link({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return <button onClick={onClick} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-bold"><Icon name={icon} className="size-4" />{label}</button>;
}
