// Learn: courses made by teachers. "Suggested for you" comes from a fixed rule (rule.course_recommend): the course
// trains a skill one of her top careers needs, or a gap for an internship/job she is "Almost" ready for.

import { recommendCourses } from "@disha/engine";
import { useEffect, useMemo, useState } from "react";
import type { Go } from "../App";
import { Button, Card, Pill, Screen, useLive } from "../components/ui";
import { Icon } from "../components/Icon";
import { useT, type StringKey } from "../lib/i18n";
import { kb } from "../lib/kb";
import { isError, useAccount } from "../lib/auth";
import { listCourses, type CourseRow } from "../lib/courses";
import { db, type Action, type Student } from "../lib/db";
import { analyse, EMPTY_PROFILE } from "../lib/profile";
import { profileOf } from "../lib/skills";
import { emit } from "../lib/xray";

export const unitName = (pick: (o: { en: string; ta?: string | null }) => string, id: string) =>
  pick(kb.graph?.subskills[id]?.name ?? kb.skills[id]?.name ?? { en: id });

export function PlanPill({ c }: { c: Pick<CourseRow, "plan" | "price_inr" | "period_days"> }) {
  const { t } = useT();
  if (c.plan === "free") return <Pill tone="good">{t("planFree")}</Pill>;
  if (c.plan === "per_module") return <Pill tone="brand">{t("planPerModule", { n: c.price_inr })}</Pill>;
  return <Pill tone="sun">{t("planSubscription", { n: c.price_inr, d: c.period_days })}</Pill>;
}

export default function Courses({ go }: { go: Go }) {
  const { t, pick, lang } = useT();
  const account = useAccount();
  const [courses, setCourses] = useState<CourseRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void listCourses().then((r) => (isError(r) ? setError(r.error) : setCourses(r.courses))); }, []);
  const sid = account?.student_id ?? "";
  const student = useLive(() => (sid ? db.students.get(sid) : Promise.resolve(undefined)), [sid], undefined as Student | undefined);
  const actions = useLive(() => (sid ? db.actions.where("student_id").equals(sid).toArray() : Promise.resolve([] as Action[])), [sid], [] as Action[]);
  const profile = useLive(() => (sid ? profileOf(sid) : Promise.resolve(EMPTY_PROFILE)), [sid], EMPTY_PROFILE);

  const suggested = useMemo(() => {
    if (!courses || !student) return [];
    const a = analyse(student, actions, lang, profile);
    const top = a.careers.careers.slice(0, 3).map((c) => ({ id: c.occupation_id, name: kb.occupations[c.occupation_id]?.name.en ?? c.occupation_id }));
    const almost = a.opportunities.filter((x) => x.r.status === "almost").map((x) => ({ opp: x.opp.title.en, gaps: x.r.gaps }));
    return recommendCourses(kb.graph!, courses, profile.units, top, almost);
  }, [courses, student, actions, profile, lang]);
  useEffect(() => {
    for (const s of suggested) emit({ step: "skills", source: "RULE", ref: "rule.course_recommend", title: `Course suggested: ${s.course.title}`,
      subject: `course:${s.course.id}`, output: s.reason, why: s.why }, `suggest:${s.course.id}`);
  }, [suggested]);
  const suggestedIds = new Set(suggested.map((s) => s.course.id));

  return (
    <Screen title={t("learnTitle")}>
      <p className="text-muted">{t("learnHint")}</p>
      <Button kind="soft" onClick={() => go({ name: "findTeacher" })}><Icon name="compass" className="size-5" />{t("findTeacher")}</Button>
      {error && <p className="rounded-xl bg-sun-soft p-3 text-sm text-warn">{error}</p>}
      {courses?.length === 0 && <p className="text-muted">{t("noCoursesYet")}</p>}
      {suggested.length > 0 && <p className="eyebrow !text-good">{t("suggestedForYou")}</p>}
      {[...(courses ?? [])].sort((x, y) => Number(suggestedIds.has(y.id)) - Number(suggestedIds.has(x.id))).map((c) => {
        const s = suggested.find((x) => x.course.id === c.id);
        return (
          <Card key={c.id} className={s ? "border-good/50" : ""}>
            <button className="w-full text-left" onClick={() => go({ name: "course", courseId: c.id })}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-extrabold leading-snug">{c.title}</p>
                  <p className="text-sm text-muted">{unitName(pick, c.skill_id)} · {t("lessonsN", { n: c.modules })} · {t(`langName_${c.language}` as StringKey)}</p>
                </div>
                <PlanPill c={c} />
              </div>
              {s && <p className="mt-2 rounded-lg bg-good-soft px-2 py-1 text-sm text-good"><Icon name="spark" className="mr-1 inline size-4" />{s.why[0]}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted">{t("byTeacher", { name: c.teacher_name })}</span>
                {c.subscribed && <Pill tone="good">{t("subscribed")}</Pill>}
                {(c.passed ?? 0) > 0 && <Pill tone="good"><Icon name="check" className="size-3.5" />{t("passedN", { n: c.passed!, total: c.modules })}</Pill>}
              </div>
            </button>
            <button className="mt-2 text-sm font-bold text-accent-dark" onClick={() => go({ name: "teacherProfile", teacherId: c.teacher_id })}>{t("seeTeacher")} →</button>
          </Card>
        );
      })}
    </Screen>
  );
}
