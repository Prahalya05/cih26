// My resume: made by Disha from my record (verified skills marked), with lines I add myself. I can also upload an
// old resume: the AI reads it and proposes skills with quotes; a rule keeps only catalogue skills whose quote is
// really in the document, and I choose which to add (they count as "I said it", not as proof).

import { useMemo, useState } from "react";
import type { Go } from "../App";
import { Button, Card, Pill, Screen, useLive } from "../components/ui";
import { Icon } from "../components/Icon";
import { useT } from "../lib/i18n";
import { db, type Action, type Student } from "../lib/db";
import { kb } from "../lib/kb";
import { analyse, EMPTY_PROFILE } from "../lib/profile";
import { profileOf } from "../lib/skills";
import { buildResume, loadExtras, saveExtras, type ResumeExtras } from "../lib/resume";
import { apiFetch } from "../lib/api";
import { recordEvents } from "../lib/events";
import { emit } from "../lib/xray";
import { compressImage } from "../lib/samples";
import type { Profile } from "@disha/engine";

interface ReadOut { skills: { id: string; quote: string }[]; education: string[]; experience: string[]; trace: { model: string; latency_ms: number; kept: string[]; dropped: { value: string; reason: string }[] } }

export default function Resume({ go, id }: { go: Go; id: string }) {
  const { t, pick, lang } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined as Student | undefined);
  const actions = useLive(() => db.actions.where("student_id").equals(id).toArray(), [id], [] as Action[]);
  const profile = useLive(() => profileOf(id), [id], EMPTY_PROFILE as Profile);
  const [extras, setExtrasState] = useState<ResumeExtras>(() => loadExtras(id));
  const [line, setLine] = useState("");
  const [lineKind, setLineKind] = useState<"education" | "experience">("experience");
  const [read, setRead] = useState<ReadOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const setExtras = (x: ResumeExtras) => { setExtrasState(x); saveExtras(id, x); };

  const resume = useMemo(() => (student ? buildResume(student, analyse(student, actions, lang, profile), profile, extras) : null), [student, actions, profile, extras, lang]);
  if (!student || !resume) return null;

  const upload = async (file: File) => {
    setBusy(true); setError(""); setRead(null);
    const form = new FormData();
    form.append("file", file.type === "application/pdf" ? file : await compressImage(file), file.type === "application/pdf" ? "cv.pdf" : "cv.jpg");
    try {
      const res = await apiFetch("/v2/resume/read", { method: "POST", body: form });
      const out = await res.json();
      if (!res.ok) { setError(typeof out.detail === "string" ? out.detail : "Could not read it"); return; }
      setRead(out as ReadOut);
      const r = out as ReadOut;
      emit({ step: "skills", source: "AI_CHECKED", ref: "ai.resume_read", title: `Resume read: ${r.skills.length} skills kept, ${r.trace.dropped.length} dropped`,
        subject: `resume:${id}`, output: r.skills.map((s) => s.id).join(", ") || "none",
        why: [...r.skills.map((s) => `${s.id} ✓ quote found: "${s.quote}"`), ...r.trace.dropped.map((d) => `${d.value} ✗ ${d.reason}`), "kept skills count as self-reports (weight 0.5), never as proof"],
        ai: { model: r.trace.model, latency_ms: r.trace.latency_ms, kept: r.trace.kept, dropped: r.trace.dropped } });
    } catch { setError(t("needInternet")); } finally { setBusy(false); }
  };

  const addFromUpload = async () => {
    if (!read) return;
    // Skills from the old resume: recorded as things she says (self_report), so they move her level only gently.
    await recordEvents(read.skills.map((s) => ({ student_id: id, kind: "self_report" as const, skill_id: s.id, payload: { source: "text", evidence: s.quote, from: "resume" } })));
    setExtras({ ...extras, education: [...new Set([...extras.education, ...read.education])], experience: [...new Set([...extras.experience, ...read.experience])],
      uploaded_skills: [...extras.uploaded_skills, ...read.skills.filter((s) => !extras.uploaded_skills.some((u) => u.id === s.id))] });
    setRead(null);
  };

  return (
    <Screen title={t("myResume")} onBack={() => go({ name: "results", id, tab: "opps" })}>
      <Card className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-12 items-center justify-center rounded-full bg-paper text-3xl">{student.avatar}</span>
          <div className="min-w-0 flex-1">
            <p className="text-xl font-extrabold">{resume.first_name}</p>
            {resume.headline && <p className="text-sm text-muted">{resume.headline}</p>}
          </div>
          <Pill tone="good"><Icon name="shield" className="size-3.5" />{t("madeByDisha")}</Pill>
        </div>
        <div>
          <p className="eyebrow mb-1">{t("skills")}</p>
          {resume.skills.length === 0 && <p className="text-sm text-muted">{t("noSkillsYet")}</p>}
          <ul className="flex flex-col gap-1.5">
            {resume.skills.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                {s.verified ? <Icon name="check" className="size-4 text-good" /> : <Icon name="mic" className="size-4 text-faint" />}
                <span className="flex-1">{pick(kb.skills[s.id]?.name ?? { en: s.id })}{s.level ? ` · L${s.level}` : ""}</span>
                <Pill tone={s.verified ? "good" : "neutral"}>{s.verified ? t("verifiedSkill") : t("saysSkill")}</Pill>
                <button aria-label="hide" onClick={() => setExtras({ ...extras, hidden: [...extras.hidden, s.id] })} className="text-faint"><Icon name="x" className="size-4" /></button>
              </li>
            ))}
          </ul>
          {extras.hidden.length > 0 && <button className="mt-1 text-xs font-bold text-accent-dark" onClick={() => setExtras({ ...extras, hidden: [] })}>{t("showHidden", { n: extras.hidden.length })}</button>}
        </div>
        {resume.education.length > 0 && <div><p className="eyebrow mb-1">{t("education")}</p>{resume.education.map((e) => <p key={e} className="text-sm">• {e}</p>)}</div>}
        {resume.experience.length > 0 && <div><p className="eyebrow mb-1">{t("experience")}</p>{resume.experience.map((e) => <p key={e} className="text-sm">• {e}</p>)}</div>}
        <p className="text-xs text-muted">{t("resumeSharesOnly")}</p>
      </Card>

      <Card className="flex flex-col gap-2">
        <p className="font-bold">{t("addLine")}</p>
        <div className="flex gap-1.5">
          {(["experience", "education"] as const).map((k) => (
            <button key={k} onClick={() => setLineKind(k)} className={`rounded-full border px-3 py-1 text-sm font-bold ${lineKind === k ? "border-brand bg-brand text-white" : "border-line"}`}>{t(k)}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={line} onChange={(e) => setLine(e.target.value)} placeholder={t("addLineHint")} className="min-h-12 flex-1 rounded-xl border border-line px-3" />
          <Button className="!min-h-12" disabled={!line.trim()} onClick={() => { setExtras({ ...extras, [lineKind]: [...extras[lineKind], line.trim()] }); setLine(""); }}><Icon name="plus" className="size-5" /></Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-2">
        <p className="font-bold">{t("uploadOldResume")}</p>
        <p className="text-sm text-muted">{t("uploadOldResumeHint")}</p>
        <label className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-accent font-bold text-accent-dark">
          <Icon name="camera" className="size-5" />{busy ? t("thinking") : t("addPhoto")}
          <input type="file" accept="image/*,application/pdf" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
        </label>
        {error && <p className="rounded-lg bg-sun-soft p-2 text-sm text-warn">{error}</p>}
        {read && (
          <div className="flex flex-col gap-2 rounded-xl bg-paper p-3">
            {read.skills.map((s) => <p key={s.id} className="text-sm"><Icon name="check" className="inline size-4 text-good" /> {pick(kb.skills[s.id]?.name ?? { en: s.id })} <span className="text-muted">“{s.quote}”</span></p>)}
            {read.trace.dropped.map((d, i) => <p key={i} className="text-xs text-muted line-through">{d.value}: {d.reason}</p>)}
            {read.education.map((e) => <p key={e} className="text-sm">🎓 {e}</p>)}
            {read.experience.map((e) => <p key={e} className="text-sm">💼 {e}</p>)}
            <Button onClick={() => void addFromUpload()}><Icon name="plus" className="size-5" />{t("addToResume")}</Button>
          </div>
        )}
      </Card>

      <Button kind="soft" onClick={() => go({ name: "docs", id })}><Icon name="clipboard" className="size-5" />{t("myDocs")}</Button>
    </Screen>
  );
}
