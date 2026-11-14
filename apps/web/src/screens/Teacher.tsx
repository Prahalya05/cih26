import { useEffect, useMemo, useState } from "react";
import type { Go } from "../App";
import { Button, Pill, Screen, useLive, useOnline } from "../components/ui";
import { addAction, db, type Action, type Student } from "../lib/db";
import { raterId, recordEvent } from "../lib/events";
import { profileOf } from "../lib/skills";
import type { Profile } from "@disha/engine";
import { clearDemoClass, loadDemoClass } from "../lib/demo";
import { useT } from "../lib/i18n";
import { kb } from "../lib/kb";
import { SECTOR } from "../lib/labels";
import { analyse, isStrongMatch, type Analysis } from "../lib/profile";
import { pullCohort, syncNow } from "../lib/sync";
import { samplesToConfirm, type RubricFull } from "../lib/samples";
import { RUBRICS } from "../lib/skills";
import type { StoredEvent } from "../lib/db";

const savedCode = () => { try { return localStorage.getItem("disha.code") ?? ""; } catch { return ""; } };

/** A teacher confirms a skill: kept as a v1 action (current screens) and as a rating event (skill levels). */
async function endorse(studentId: string, skillId: string) {
  await addAction({ student_id: studentId, kind: "endorse", payload: { skill_id: skillId }, by: "teacher" });
  await recordEvent({ student_id: studentId, kind: "rating", rater_id: await raterId(), skill_id: skillId, payload: { endorse: true } });
}

export default function Teacher({ go }: { go: Go }) {
  const { t, lang } = useT();
  const online = useOnline();
  const [code, setCode] = useState(savedCode);
  const [draft, setDraft] = useState(code);
  const [open, setOpen] = useState<string | null>(null);

  const students = useLive(
    () => (code ? db.students.where("facilitator_code").equals(code).toArray() : Promise.resolve([] as Student[])),
    [code],
    [] as Student[],
  );
  const actions = useLive(() => db.actions.toArray(), [], [] as Action[]);
  // Skill levels for every student, rebuilt from their events.
  const profiles = useLive(async () => {
    const out: Record<string, Profile> = {};
    for (const s of students) out[s.id] = await profileOf(s.id);
    return out;
  }, [students], {} as Record<string, Profile>);
  const pending = actions.filter((a) => !a.synced).length;

  useEffect(() => {
    if (code && online) void pullCohort(code);
  }, [code, online]);

  const rows = useMemo(() => {
    const list = students.map((s) => {
      const a = analyse(s, actions.filter((x) => x.student_id === s.id), lang, profiles[s.id]);
      return { s, a, strong: isStrongMatch(a) };
    });
    return list.sort((x, y) => Number(y.strong) - Number(x.strong) || (y.a.careers.careers[0]?.score ?? 0) - (x.a.careers.careers[0]?.score ?? 0));
  }, [students, actions, lang, profiles]);

  if (!code) {
    return (
      <Screen title={t("teacherTitle")} onBack={() => go({ name: "home" })}>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t("facilitatorCode")}</span>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="PSG01"
            className="min-h-14 rounded-2xl border-2 border-line bg-white px-4 text-lg uppercase" />
        </label>
        <Button disabled={!draft.trim()} onClick={() => {
          const c = draft.trim().toUpperCase();
          try { localStorage.setItem("disha.code", c); } catch { /* ignore */ }
          setCode(c);
        }}>{t("next")} →</Button>
      </Screen>
    );
  }

  const strongCount = rows.filter((r) => r.strong).length;

  return (
    <Screen
      title={t("teacherTitle")}
      onBack={() => go({ name: "home" })}
      right={<button onClick={() => setCode("")} className="rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold text-brand-dark">{code}</button>}
    >
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat value={rows.length} label={t("students")} />
        <Stat value={strongCount} label={t("strongMatch")} />
        <Stat value={pending} label={online ? "⇅" : "📴"} />
      </div>
      {pending > 0 && online && <Button kind="soft" onClick={() => void syncNow()}>⇅ Sync ({pending})</Button>}

      <WorkQueue students={students} />

      {rows.length === 0 && <p className="text-muted">{t("noStudents")}</p>}

      {rows.map(({ s, a, strong }) => (
        <StudentRow key={s.id} s={s} a={a} strong={strong} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} />
      ))}

      <div className="mt-4 flex flex-col gap-2">
        {!rows.some((r) => r.s.simulated)
          ? <Button kind="ghost" className="text-base" onClick={() => loadDemoClass(code)}>🧪 {t("loadDemo")}</Button>
          : <Button kind="ghost" className="text-base" onClick={() => clearDemoClass()}>🧹 {t("simulated")} ✕</Button>}
      </div>
    </Screen>
  );
}

/** Photos of students' work waiting for the teacher: confirm the AI's scores or correct them, one tap each. */
function WorkQueue({ students }: { students: Student[] }) {
  const { t } = useT();
  const queue = useLive(() => samplesToConfirm(students.map((s) => s.id)), [students], [] as StoredEvent[]);
  if (!queue.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-bold">📷 {t("workToCheck")} ({queue.length})</h2>
      {queue.map((e) => <SampleCard key={e.id} sample={e} student={students.find((s) => s.id === e.student_id)} />)}
    </section>
  );
}

function SampleCard({ sample, student }: { sample: StoredEvent; student?: Student }) {
  const { t, pick } = useT();
  const rubric = RUBRICS[String(sample.payload.rubric_id)] as unknown as RubricFull | undefined;
  const ai = (sample.payload.scores ?? {}) as Record<string, number>;
  const reasons = (sample.payload.reasons ?? {}) as Record<string, string>;
  const [scores, setScores] = useState<Record<string, number>>(ai);
  const media = useLive(() => db.media.get(String(sample.payload.media_ref ?? "")), [sample.id], undefined);
  const url = useMemo(() => (media ? URL.createObjectURL(media.blob) : null), [media]);
  if (!rubric) return null;
  const complete = rubric.criteria.every((c) => c.id in scores);
  const confirm = async () => {
    await recordEvent({ student_id: sample.student_id, kind: "rating", rater_id: await raterId(), refers_to: sample.id,
      payload: { scores } });
  };
  return (
    <article className="rounded-3xl bg-white p-4 shadow-sm">
      <p className="font-semibold">{student?.avatar} {student?.name} · {pick(rubric.name)}</p>
      {url ? <img src={url} alt="" className="mt-2 max-h-56 w-full rounded-2xl object-contain" />
        : <p className="mt-1 text-sm text-muted">{t("noPhotoHere")}</p>}
      <ul className="mt-3 flex flex-col gap-2">
        {rubric.criteria.map((c) => (
          <li key={c.id}>
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm font-medium">{pick(c.name)}</span>
              {[0, 1, 2].map((v) => (
                <button key={v} onClick={() => setScores({ ...scores, [c.id]: v })} aria-pressed={scores[c.id] === v}
                  className={`size-10 rounded-xl border-2 font-bold ${scores[c.id] === v ? "border-brand bg-brand text-white" : "border-line"}`}>
                  {v}
                </button>
              ))}
            </div>
            {reasons[c.id] && <p className="text-xs text-muted">🤖 {reasons[c.id]}</p>}
          </li>
        ))}
      </ul>
      <Button className="mt-3 w-full" disabled={!complete} onClick={() => void confirm()}>✔ {t("confirmScores")}</Button>
    </article>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function StudentRow({ s, a, strong, open, onToggle }: { s: Student; a: Analysis; strong: boolean; open: boolean; onToggle: () => void }) {
  const { t, pick } = useT();
  const top = a.careers.careers[0];
  const eligible = a.schemes.filter((x) => x.status === "eligible");
  const recommendedSchemes = new Set(a.recommendations.map((r) => r.payload.scheme_id));
  const recommendedCareers = new Set(a.recommendations.map((r) => r.payload.occupation_id));

  return (
    <article className={`rounded-3xl bg-white shadow-sm ${strong ? "ring-2 ring-sun" : ""}`}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 p-4 text-left" aria-expanded={open}>
        <span className="text-4xl">{s.avatar}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{s.name}</p>
          {top && <p className="truncate text-sm text-muted">{SECTOR[top.sector]?.emoji} {pick(kb.occupations[top.occupation_id].name)}</p>}
          <div className="mt-1 flex flex-wrap gap-1">
            {strong && <Pill tone="sun">⭐ {t("strongMatch")}</Pill>}
            <Pill tone="good">{t("eligibleCount", { n: eligible.length })}</Pill>
            {s.simulated && <Pill>🧪 {t("simulated")}</Pill>}
          </div>
        </div>
        <span className="text-xl text-muted">{open ? "▾" : "›"}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-line p-4">
          <div>
            <p className="mb-2 text-sm font-semibold text-muted">{t("strengths")}</p>
            <ul className="flex flex-col gap-2">
              {a.skills.map((sk) => (
                <li key={sk.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{pick(kb.skills[sk.id].name)}</p>
                    <p className="truncate text-xs text-muted">{sk.evidence.map((e) => e.text).join(" · ")}</p>
                  </div>
                  {sk.endorsed
                    ? <Pill tone="good">✔ {t("endorsedBy")}</Pill>
                    : <button onClick={() => void endorse(s.id, sk.id)}
                        className="rounded-xl bg-good-soft px-3 py-2 text-sm font-semibold text-good">✔ {t("endorse")}</button>}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-muted">{t("careers")}</p>
            <ul className="flex flex-col gap-2">
              {a.careers.careers.slice(0, 3).map((c) => (
                <li key={c.occupation_id} className="flex items-center gap-2">
                  <span className="flex-1">{SECTOR[c.sector]?.emoji} {pick(kb.occupations[c.occupation_id].name)} <span className="text-xs text-muted">{Math.round(c.score * 100)}%</span></span>
                  {recommendedCareers.has(c.occupation_id)
                    ? <Pill tone="good">⭐</Pill>
                    : <button onClick={() => addAction({ student_id: s.id, kind: "recommend", payload: { occupation_id: c.occupation_id }, by: "teacher" })}
                        className="rounded-xl bg-sun-soft px-3 py-2 text-sm font-semibold text-warn">⭐ {t("recommend")}</button>}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-muted">{t("eligibleNow")}</p>
            {eligible.length === 0 && <p className="text-sm text-muted">—</p>}
            <ul className="flex flex-col gap-2">
              {eligible.map((x) => (
                <li key={x.scheme_id} className="flex items-center gap-2">
                  <span className="flex-1">{pick(x.name)}</span>
                  {recommendedSchemes.has(x.scheme_id)
                    ? <Pill tone="good">⭐</Pill>
                    : <button onClick={() => addAction({ student_id: s.id, kind: "recommend", payload: { scheme_id: x.scheme_id }, by: "teacher" })}
                        className="rounded-xl bg-sun-soft px-3 py-2 text-sm font-semibold text-warn">⭐ {t("recommend")}</button>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </article>
  );
}
