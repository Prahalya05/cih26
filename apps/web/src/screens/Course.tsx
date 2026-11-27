// One course: its lessons (open or locked, with the reason from rule.course_access), payment for a lesson or a
// subscription, the lesson itself (text and video), and a quiz the server marks.

import { useEffect, useState } from "react";
import type { Go } from "../App";
import { Button, Card, Pill, Screen } from "../components/ui";
import { Icon } from "../components/Icon";
import { WhyButton } from "../components/WhyFlow";
import { useT } from "../lib/i18n";
import { isError, useAccount } from "../lib/auth";
import { getCourse, pay, submitQuiz, type CourseDetail, type Lesson, type QuizResult } from "../lib/courses";
import { PlanPill, unitName } from "./Courses";

function youtubeEmbed(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{6,})/);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}

export default function Course({ go, courseId }: { go: Go; courseId: string }) {
  const { t, pick } = useT();
  const account = useAccount();
  const [d, setD] = useState<CourseDetail | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoAsk, setDemoAsk] = useState<{ amount: number; resolve: (ok: boolean) => void } | null>(null);
  const load = async () => { const r = await getCourse(courseId); if (isError(r)) setError(r.error); else setD(r); };
  useEffect(() => { void load(); }, [courseId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Screen title="…" onBack={() => go({ name: account?.role === "teacher" ? "teacherCourses" : "courses" })}>{error && <p className="rounded-xl bg-sun-soft p-3 text-warn">{error}</p>}</Screen>;
  const c = d.course;
  const own = account?.id === c.teacher_id;
  const canBuy = account?.role === "student" && d.payments !== "off";

  const buy = async (lesson?: Lesson) => {
    setBusy(true); setError("");
    const r = await pay(c.id, lesson?.id, (amount) => new Promise((resolve) => setDemoAsk({ amount, resolve })));
    setBusy(false);
    if (r === "paid") await load(); else if (r !== "cancelled") setError(r);
  };

  return (
    <Screen title={c.title} onBack={() => go({ name: account?.role === "teacher" ? "teacherCourses" : "courses" })}>
      <Card>
        <div className="flex items-start gap-2">
          <p className="flex-1 text-sm text-muted">{unitName(pick, c.skill_id)}</p>
          <PlanPill c={c} />
        </div>
        {c.description && <p className="mt-2">{c.description}</p>}
        <button className="mt-2 text-sm font-bold text-accent-dark" onClick={() => go({ name: "teacherProfile", teacherId: c.teacher_id })}>{t("byTeacher", { name: c.teacher_name })} →</button>
        {d.subscription_until && <p className="mt-2"><Pill tone="good">{t("subscribedUntil", { date: new Date(d.subscription_until).toLocaleDateString() })}</Pill></p>}
        {c.plan === "subscription" && !d.subscription_until && canBuy && (
          <Button className="mt-3 w-full" disabled={busy} onClick={() => void buy()}><Icon name="wallet" className="size-5" />{t("subscribeFor", { n: c.price_inr, d: c.period_days })}</Button>
        )}
        {d.payments === "demo" && c.plan !== "free" && <p className="mt-2 text-xs text-muted"><Icon name="info" className="mr-1 inline size-3.5" />{t("demoPaymentsNote")}</p>}
        {own && <Button kind="soft" className="mt-3 w-full" onClick={() => go({ name: "courseBuilder", courseId: c.id })}><Icon name="pencil" className="size-5" />{t("editCourse")}</Button>}
      </Card>
      {error && <p className="rounded-xl bg-bad-soft p-3 text-sm text-bad">{error}</p>}

      <h2 className="text-lg font-extrabold">{t("lessons")}</h2>
      {d.lessons.map((l) => (
        <Card key={l.id} className={l.open ? "" : "bg-paper"}>
          <button className="flex w-full items-center gap-3 text-left" onClick={() => l.open && setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id}>
            <span className={`flex size-9 items-center justify-center rounded-full font-bold ${l.passed ? "bg-good-soft text-good" : l.open ? "bg-brand-soft text-brand" : "bg-line text-muted"}`}>
              {l.passed ? <Icon name="check" className="size-5" /> : l.open ? l.position + 1 : <Icon name="lock" className="size-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{l.title}</span>
              <span className="block text-xs text-muted">{l.why}</span>
            </span>
            {l.open && <Icon name={open === l.id ? "chevronDown" : "chevron"} className="size-5 text-faint" />}
          </button>
          {!l.open && c.plan === "per_module" && canBuy && (
            <Button kind="soft" className="mt-2 w-full !min-h-11 text-sm" disabled={busy} onClick={() => void buy(l)}><Icon name="wallet" className="size-4" />{t("buyLesson", { n: c.price_inr })}</Button>
          )}
          {open === l.id && l.open && <LessonView lesson={l} courseId={c.id} studentId={account?.student_id} own={own} onPassed={() => void load()} />}
        </Card>
      ))}
      <WhyButton subject={`course:${c.id}`} title={c.title} />

      {demoAsk && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center">
          <div className="w-full max-w-md rounded-t-3xl bg-paper p-5 sm:rounded-3xl">
            <p className="text-lg font-extrabold">{t("demoPayTitle")}</p>
            <p className="mt-2">{t("demoPayBody", { n: demoAsk.amount })}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button kind="ghost" onClick={() => { demoAsk.resolve(false); setDemoAsk(null); }}>{t("cancel")}</Button>
              <Button onClick={() => { demoAsk.resolve(true); setDemoAsk(null); }}>{t("payDemo", { n: demoAsk.amount })}</Button>
            </div>
          </div>
        </div>
      )}
    </Screen>
  );
}

function LessonView({ lesson, courseId, studentId, own, onPassed }: { lesson: Lesson; courseId: string; studentId?: string | null; own: boolean; onPassed: () => void }) {
  const { t } = useT();
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState("");
  const embed = lesson.video_url ? youtubeEmbed(lesson.video_url) : null;
  const quiz = lesson.quiz ?? [];
  const send = async () => {
    setError("");
    const r = await submitQuiz(lesson.id, answers, studentId, courseId);
    if ("error" in r) setError(r.error); else { setResult(r); if (r.passed) onPassed(); }
  };
  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
      {embed && <iframe src={embed} title={lesson.title} className="aspect-video w-full rounded-xl" allow="encrypted-media" allowFullScreen />}
      {lesson.video_url && !embed && <a href={lesson.video_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 font-bold text-accent-dark"><Icon name="play" className="size-4" />{t("watchVideo")}</a>}
      {lesson.body && <p className="whitespace-pre-line leading-relaxed">{lesson.body}</p>}
      {quiz.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl bg-paper p-3">
          <p className="font-bold">{t("quiz")}</p>
          {quiz.map((q, i) => (
            <div key={i}>
              <p className="font-semibold">{i + 1}. {q.q}</p>
              <div className="mt-1 flex flex-col gap-1.5">
                {q.options.map((o, k) => {
                  const right = result?.correct[i] === k || (own && lesson.answers?.[i] === k);
                  const wrong = result && answers[i] === k && result.correct[i] !== k;
                  return (
                    <button key={k} onClick={() => !result && setAnswers((a) => { const n = [...a]; n[i] = k; return n; })}
                      className={`min-h-11 rounded-lg border px-3 text-left text-sm ${right && (result || own) ? "border-good bg-good-soft" : wrong ? "border-bad bg-bad-soft" : answers[i] === k ? "border-brand bg-brand-soft" : "border-line bg-surface"}`}>{o}</button>
                  );
                })}
              </div>
            </div>
          ))}
          {!result && !own && <Button disabled={answers.filter((x) => x !== undefined).length < quiz.length} onClick={() => void send()}>{t("checkAnswers")}</Button>}
          {result && <p className={`rounded-lg p-2 text-sm font-bold ${result.passed ? "bg-good-soft text-good" : "bg-sun-soft text-warn"}`}>{t(result.passed ? "quizPassed" : "quizNotYet", { right: result.right, total: result.total })}</p>}
          {result && !result.passed && <Button kind="ghost" onClick={() => { setResult(null); setAnswers([]); }}>{t("tryAgain")}</Button>}
          {error && <p className="text-sm text-bad">{error}</p>}
        </div>
      )}
      {lesson.passed && !result && <Pill tone="good"><Icon name="check" className="size-3.5" />{t("lessonPassed")}</Pill>}
    </div>
  );
}
