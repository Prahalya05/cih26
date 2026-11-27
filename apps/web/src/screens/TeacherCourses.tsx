// Teacher: my courses, learners and earnings (Disha keeps 10%), plus browsing online courses across Disha.

import { useEffect, useState } from "react";
import type { Go } from "../App";
import { Button, Card, Pill, Screen } from "../components/ui";
import { Icon } from "../components/Icon";
import { useT, type StringKey } from "../lib/i18n";
import { call, isError } from "../lib/auth";
import { listCourses, type CourseRow } from "../lib/courses";
import { PlanPill, unitName } from "./Courses";

type Mine = CourseRow & { published: boolean; learners: number; gross: number; earned_inr: number; fee_inr: number; demo_paid: number };

export default function TeacherCourses({ go }: { go: Go }) {
  const { t, pick } = useT();
  const [tab, setTab] = useState<"mine" | "browse">("mine");
  const [data, setData] = useState<{ courses: Mine[]; total: { gross: number; earned_inr: number } } | null>(null);
  const [catalog, setCatalog] = useState<CourseRow[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void call<typeof data>("/v2/courses/mine").then((r) => (isError(r) ? setError(r.error) : setData(r)));
    void listCourses().then((r) => { if (!isError(r)) setCatalog(r.courses); });
  }, []);

  const filtered = (catalog ?? []).filter((c) => {
    const term = q.trim().toLowerCase();
    if (!term) return true;
    const skill = unitName(pick, c.skill_id).toLowerCase();
    return `${c.title} ${c.teacher_name} ${skill}`.toLowerCase().includes(term);
  });

  return (
    <Screen title={t("tabCourses")}>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-line/60 p-1 text-sm font-bold" role="tablist">
        <button role="tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")}
          className={`min-h-10 rounded-lg ${tab === "mine" ? "bg-surface text-brand shadow-sm" : "text-muted"}`}>
          {t("myCourses")}
        </button>
        <button role="tab" aria-selected={tab === "browse"} onClick={() => setTab("browse")}
          className={`min-h-10 rounded-lg ${tab === "browse" ? "bg-surface text-brand shadow-sm" : "text-muted"}`}>
          {t("tabBrowseCourses")}
        </button>
      </div>

      {tab === "mine" && (
        <>
          <div className="grid grid-cols-2 gap-2 text-center">
            <Card><p className="text-2xl font-extrabold">₹{(data?.total.earned_inr ?? 0).toLocaleString("en-IN")}</p><p className="text-xs text-muted">{t("youEarned")}</p></Card>
            <Card><p className="text-2xl font-extrabold">{data?.courses.reduce((s, c) => s + c.learners, 0) ?? 0}</p><p className="text-xs text-muted">{t("payingLearners")}</p></Card>
          </div>
          <p className="text-xs text-muted">{t("feeNote")}</p>
          <Button onClick={() => go({ name: "courseBuilder" })}><Icon name="plus" className="size-5" />{t("newCourse")}</Button>
          {error && <p className="rounded-xl bg-sun-soft p-3 text-sm text-warn">{error}</p>}
          {data?.courses.length === 0 && <p className="text-muted">{t("noCoursesMine")}</p>}
          {data?.courses.map((c) => (
            <Card key={c.id}>
              <button className="w-full text-left" onClick={() => go({ name: "course", courseId: c.id })}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold">{c.title}</p>
                    <p className="text-sm text-muted">{unitName(pick, c.skill_id)} · {t("lessonsN", { n: c.modules })}</p>
                  </div>
                  <PlanPill c={c} />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Pill tone={c.published ? "good" : "neutral"}>{c.published ? t("published") : t("draft")}</Pill>
                  <Pill tone={c.school_id ? "neutral" : "brand"}>{t(c.school_id ? "badgeSchoolOnly" : "badgeOpenOnline")}</Pill>
                  <Pill>{t("learnersN", { n: c.learners })}</Pill>
                  <Pill tone="brand">₹{c.earned_inr} {t("earned")}</Pill>
                  {c.demo_paid > 0 && <Pill tone="sun">{t("demoPaymentsN", { n: c.demo_paid })}</Pill>}
                </div>
              </button>
              <button className="mt-2 text-sm font-bold text-accent-dark" onClick={() => go({ name: "courseBuilder", courseId: c.id })}>{t("editCourse")} →</button>
            </Card>
          ))}
        </>
      )}

      {tab === "browse" && (
        <>
          <p className="text-muted">{t("learnHint")}</p>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchCoursesPlaceholder")}
            className="min-h-12 rounded-xl border border-line bg-surface px-3 text-base" />
          {catalog && filtered.length === 0 && <p className="text-muted">{t("noCoursesYet")}</p>}
          {filtered.map((c) => (
            <Card key={c.id}>
              <button className="w-full text-left" onClick={() => go({ name: "course", courseId: c.id })}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-extrabold leading-snug">{c.title}</p>
                    <p className="text-sm text-muted">{unitName(pick, c.skill_id)} · {t("lessonsN", { n: c.modules })} · {t(`langName_${c.language}` as StringKey)}</p>
                  </div>
                  <PlanPill c={c} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted">{t("byTeacher", { name: c.teacher_name })}</span>
                  <Pill tone={c.school_id ? "neutral" : "brand"}>{t(c.school_id ? "badgeSchoolOnly" : "badgeOpenOnline")}</Pill>
                </div>
              </button>
              <button className="mt-2 text-sm font-bold text-accent-dark" onClick={() => go({ name: "teacherProfile", teacherId: c.teacher_id })}>{t("seeTeacher")} →</button>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
