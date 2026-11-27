// Teacher: make or edit a course: title, the skill it trains, plan (free / pay per lesson / subscription) and price,
// then lessons with text, a video link and a short quiz. Publishing needs at least one lesson.

import { useEffect, useState } from "react";
import type { Go } from "../App";
import { Button, Card, Pill, Screen } from "../components/ui";
import { Icon } from "../components/Icon";
import { useT } from "../lib/i18n";
import { kb } from "../lib/kb";
import { call, isError, useAccount } from "../lib/auth";
import { getCourse, type CourseDetail, type Plan } from "../lib/courses";

/** Units a quiz can give evidence for: every sub-skill, and skills that have no sub-skills. */
function trainable(pick: (o: { en: string; ta?: string | null }) => string) {
  const out: { id: string; label: string }[] = [];
  for (const [sid, s] of Object.entries(kb.skills)) {
    const subs = kb.graph?.bySkill[sid] ?? [];
    if (subs.length) for (const u of subs) out.push({ id: u, label: `${pick(s.name)} · ${pick(kb.graph!.subskills[u].name)}` });
    else out.push({ id: sid, label: pick(s.name) });
  }
  return out;
}

interface Q { q: string; options: string[]; answer: number }

export default function CourseBuilder({ go, courseId }: { go: Go; courseId?: string }) {
  const { t, pick } = useT();
  const account = useAccount();
  const units = trainable(pick);
  const [id, setId] = useState(courseId);
  const [d, setD] = useState<CourseDetail | null>(null);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [language, setLanguage] = useState("ta");
  const [skill, setSkill] = useState(units[0]?.id ?? "");
  const [plan, setPlan] = useState<Plan>("free");
  const [price, setPrice] = useState("49");
  const [period, setPeriod] = useState("30");
  const [openToAll, setOpenToAll] = useState(() => account?.school_kind !== "school");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = async (cid: string) => {
    const r = await getCourse(cid);
    if (isError(r)) { setError(r.error); return; }
    setD(r);
    const c = r.course;
    setTitle(c.title); setDesc(c.description ?? ""); setLanguage(c.language); setSkill(c.skill_id); setPlan(c.plan);
    setPrice(String(c.price_inr || 49)); setPeriod(String(c.period_days)); setOpenToAll(c.school_id == null);
  };
  useEffect(() => { if (id) void load(id); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setError(""); setSaved(false);
    const body = JSON.stringify({ title, description: desc || null, language, skill_id: skill, plan, price_inr: plan === "free" ? 0 : Number(price), period_days: Number(period), open_to_all: openToAll });
    const r = id ? await call(`/v2/courses/${id}`, { method: "PUT", body }) : await call<{ id: string }>("/v2/courses", { method: "POST", body });
    if (isError(r)) { setError(r.error); return; }
    if (!id) setId((r as { id: string }).id);
    else await load(id);
    setSaved(true);
  };
  const publish = async (on: boolean) => {
    const r = await call(`/v2/courses/${id}/publish?published=${on}`, { method: "POST" });
    if (isError(r)) setError(r.error); else await load(id!);
  };
  const field = "min-h-12 rounded-xl border border-line bg-surface px-3 text-base";

  return (
    <Screen title={id ? t("editCourse") : t("newCourse")} onBack={() => go({ name: "teacherCourses" })}>
      <Card className="flex flex-col gap-3">
        <input className={field} placeholder={t("courseTitle")} value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className={`${field} min-h-20 py-2`} placeholder={t("courseDescription")} value={desc} onChange={(e) => setDesc(e.target.value)} />
        <label className="flex flex-col gap-1 text-sm font-semibold">{t("skillTrained")}
          <select className={field} value={skill} onChange={(e) => setSkill(e.target.value)}>
            {units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
        </label>
        <div className="flex gap-1.5">
          {(["ta", "hi", "en"] as const).map((l) => (
            <button key={l} onClick={() => setLanguage(l)} className={`rounded-full border px-3 py-1 text-sm font-bold ${language === l ? "border-brand bg-brand text-white" : "border-line"}`}>{l === "ta" ? "தமிழ்" : l === "hi" ? "हिन्दी" : "English"}</button>
          ))}
        </div>
        <p className="text-sm font-semibold">{t("planLabel")}</p>
        <div className="grid grid-cols-3 gap-1.5">
          {(["free", "per_module", "subscription"] as const).map((p) => (
            <button key={p} onClick={() => setPlan(p)} className={`min-h-12 rounded-xl border px-2 text-sm font-bold ${plan === p ? "border-brand bg-brand text-white" : "border-line"}`}>
              {t(p === "free" ? "planFreeShort" : p === "per_module" ? "planPerModuleShort" : "planSubscriptionShort")}
            </button>
          ))}
        </div>
        {plan !== "free" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs font-semibold">{plan === "per_module" ? t("pricePerLesson") : t("pricePerPeriod")}
              <input className={field} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} /></label>
            {plan === "subscription" && <label className="flex flex-col gap-1 text-xs font-semibold">{t("periodDays")}
              <input className={field} inputMode="numeric" value={period} onChange={(e) => setPeriod(e.target.value.replace(/\D/g, ""))} /></label>}
          </div>
        )}
        <p className="text-xs text-muted">{t("previewNote")}</p>
        <p className="text-sm font-semibold">{t("courseVisibility")}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setOpenToAll(false)} aria-pressed={!openToAll}
            className={`flex flex-col items-start gap-0.5 rounded-xl border p-2.5 text-left ${!openToAll ? "border-brand bg-brand-soft" : "border-line"}`}>
            <span className="text-sm font-bold">{t("visibilitySchool")}</span>
            <span className="text-xs text-muted">{t("visibilitySchoolHint")}</span>
          </button>
          <button type="button" onClick={() => setOpenToAll(true)} aria-pressed={openToAll}
            className={`flex flex-col items-start gap-0.5 rounded-xl border p-2.5 text-left ${openToAll ? "border-brand bg-brand-soft" : "border-line"}`}>
            <span className="text-sm font-bold">{t("visibilityOnline")}</span>
            <span className="text-xs text-muted">{t("visibilityOnlineHint")}</span>
          </button>
        </div>
        {error && <p className="rounded-lg bg-bad-soft p-2 text-sm text-bad">{error}</p>}
        {saved && <p className="rounded-lg bg-good-soft p-2 text-sm text-good">{t("saved")}</p>}
        <Button disabled={title.trim().length < 3 || (plan !== "free" && !Number(price))} onClick={() => void save()}>{t("save")}</Button>
      </Card>

      {id && d && (
        <>
          <div className="flex items-center gap-2">
            <h2 className="flex-1 text-lg font-extrabold">{t("lessons")}</h2>
            <Pill tone={d.course.published ? "good" : "neutral"}>{d.course.published ? t("published") : t("draft")}</Pill>
          </div>
          {d.lessons.map((l) => (
            <Card key={l.id} className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-full bg-brand-soft font-bold text-brand">{l.position + 1}</span>
              <span className="flex-1 font-bold">{l.title} <span className="text-xs font-normal text-muted">· {t("quizN", { n: l.quiz_count })}</span></span>
              <button aria-label="delete" onClick={async () => { await call(`/v2/modules/${l.id}`, { method: "DELETE" }); void load(id); }} className="text-faint"><Icon name="trash" className="size-5" /></button>
            </Card>
          ))}
          <LessonForm courseId={id} units={units} defaultUnit={skill} onAdded={() => void load(id)} />
          <Button kind={d.course.published ? "ghost" : "primary"} onClick={() => void publish(!d.course.published)}>
            <Icon name={d.course.published ? "eyeOff" : "send"} className="size-5" />{d.course.published ? t("unpublish") : t("publishCourse")}
          </Button>
        </>
      )}
    </Screen>
  );
}

function LessonForm({ courseId, units, defaultUnit, onAdded }: { courseId: string; units: { id: string; label: string }[]; defaultUnit: string; onAdded: () => void }) {
  const { t } = useT();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [video, setVideo] = useState("");
  const [unit, setUnit] = useState(defaultUnit);
  const [quiz, setQuiz] = useState<Q[]>([]);
  const [error, setError] = useState("");
  const field = "min-h-11 rounded-lg border border-line bg-surface px-3 text-sm";
  const add = async () => {
    setError("");
    const r = await call(`/v2/courses/${courseId}/modules`, { method: "POST", body: JSON.stringify({
      title, body: body || null, video_url: video.trim() || null, subskill_id: unit || null,
      quiz: quiz.filter((q) => q.q.trim() && q.options.filter((o) => o.trim()).length >= 2).map((q) => ({ ...q, options: q.options.filter((o) => o.trim()) })) }) });
    if (isError(r)) { setError(r.error); return; }
    setTitle(""); setBody(""); setVideo(""); setQuiz([]); onAdded();
  };
  return (
    <Card className="flex flex-col gap-2">
      <p className="font-bold">{t("addLesson")}</p>
      <input className={field} placeholder={t("lessonTitle")} value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className={`${field} min-h-24 py-2`} placeholder={t("lessonBody")} value={body} onChange={(e) => setBody(e.target.value)} />
      <input className={field} placeholder={t("videoLink")} value={video} onChange={(e) => setVideo(e.target.value)} />
      <select className={field} value={unit} onChange={(e) => setUnit(e.target.value)}>
        {units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
      </select>
      {quiz.map((q, i) => (
        <div key={i} className="flex flex-col gap-1.5 rounded-lg bg-paper p-2">
          <input className={field} placeholder={t("question")} value={q.q} onChange={(e) => setQuiz(quiz.map((x, k) => (k === i ? { ...x, q: e.target.value } : x)))} />
          {q.options.map((o, k) => (
            <div key={k} className="flex items-center gap-2">
              <input type="radio" name={`ans${i}`} checked={q.answer === k} onChange={() => setQuiz(quiz.map((x, j) => (j === i ? { ...x, answer: k } : x)))} className="size-5" aria-label="correct answer" />
              <input className={`${field} flex-1`} placeholder={`${t("option")} ${k + 1}`} value={o}
                onChange={(e) => setQuiz(quiz.map((x, j) => (j === i ? { ...x, options: x.options.map((y, m) => (m === k ? e.target.value : y)) } : x)))} />
            </div>
          ))}
          <p className="text-xs text-muted">{t("markCorrect")}</p>
        </div>
      ))}
      {quiz.length < 10 && <button className="text-sm font-bold text-accent-dark" onClick={() => setQuiz([...quiz, { q: "", options: ["", "", ""], answer: 0 }])}>+ {t("addQuestion")}</button>}
      {error && <p className="rounded-lg bg-bad-soft p-2 text-sm text-bad">{error}</p>}
      <Button disabled={title.trim().length < 2} onClick={() => void add()}><Icon name="plus" className="size-5" />{t("addLesson")}</Button>
    </Card>
  );
}
