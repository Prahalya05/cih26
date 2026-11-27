// A teacher's profile. Students see it (bio, subjects, experience, courses); the teacher edits her own here.

import { useEffect, useState } from "react";
import type { Go } from "../App";
import { Button, Card, Pill, Screen } from "../components/ui";
import { Icon } from "../components/Icon";
import { useT } from "../lib/i18n";
import { call, isError, useAccount } from "../lib/auth";
import { PlanPill, unitName } from "./Courses";
import type { Plan } from "../lib/courses";

interface TP { id: string; name: string; school?: string | null; bio?: string | null; subjects: string[]; languages: string[]; years?: number | null;
  qualification?: string | null; district?: string | null; avatar: string; learners: number;
  courses: { id: string; title: string; plan: Plan; price_inr: number; skill_id: string; modules: number; published: boolean; period_days?: number }[] }

const AVATARS = ["🧑‍🏫", "👩‍🏫", "👨‍🏫", "🧕", "👳", "🧑‍🔧", "🧑‍🌾", "🧑‍🍳", "🧑‍💻", "🧑‍⚕️"];

export default function TeacherProfile({ go, teacherId }: { go: Go; teacherId?: string }) {
  const { t, pick } = useT();
  const account = useAccount();
  const own = !teacherId || teacherId === account?.id;
  const [p, setP] = useState<TP | null>(null);
  const [edit, setEdit] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!account) return;
    void call<TP>(own ? "/v2/teachers/me/profile" : `/v2/teachers/${encodeURIComponent(teacherId!)}`).then((r) => (isError(r) ? setError(r.error) : setP(r)));
  }, [teacherId, account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen title={own ? t("myTeacherProfile") : t("teacherProfile")} onBack={own ? () => go({ name: "account" }) : () => go({ name: account?.role === "teacher" ? "teacherCourses" : "courses" })}>
      {error && <p className="rounded-xl bg-sun-soft p-3 text-warn">{error}</p>}
      {p && !edit && (
        <>
          <Card className="flex flex-col items-center gap-2 text-center">
            <span className="flex size-20 items-center justify-center rounded-full bg-brand-soft text-5xl">{p.avatar}</span>
            <p className="text-xl font-extrabold">{p.name}</p>
            <p className="text-sm text-muted">{[p.school, p.district].filter(Boolean).join(" · ")}</p>
            <div className="flex flex-wrap justify-center gap-1">
              {p.years != null && <Pill tone="brand">{t("yearsTeaching", { n: p.years })}</Pill>}
              <Pill>{t("learnersN", { n: p.learners })}</Pill>
              {p.languages.map((l) => <Pill key={l}>{l}</Pill>)}
            </div>
          </Card>
          {p.bio && <Card><p className="eyebrow mb-1">{t("about")}</p><p className="whitespace-pre-line">{p.bio}</p></Card>}
          {(p.subjects.length > 0 || p.qualification) && (
            <Card>
              {p.subjects.length > 0 && <><p className="eyebrow mb-1">{t("subjects")}</p><div className="flex flex-wrap gap-1">{p.subjects.map((s) => <Pill key={s} tone="good">{s}</Pill>)}</div></>}
              {p.qualification && <p className="mt-2 text-sm"><b>{t("qualification")}:</b> {p.qualification}</p>}
            </Card>
          )}
          <h2 className="text-lg font-extrabold">{t("courses")}</h2>
          {p.courses.length === 0 && <p className="text-muted">{t("noCoursesYet")}</p>}
          {p.courses.map((c) => (
            <Card key={c.id}>
              <button className="flex w-full items-start gap-2 text-left" onClick={() => go({ name: "course", courseId: c.id })}>
                <span className="min-w-0 flex-1"><span className="block font-bold">{c.title}</span><span className="text-sm text-muted">{unitName(pick, c.skill_id)} · {t("lessonsN", { n: c.modules })}</span></span>
                <PlanPill c={{ ...c, period_days: c.period_days ?? 30 }} />
              </button>
            </Card>
          ))}
          {own && <Button kind="soft" onClick={() => setEdit(true)}><Icon name="pencil" className="size-5" />{t("editProfile")}</Button>}
        </>
      )}
      {p && edit && <EditForm p={p} onSaved={(np) => { setP(np); setEdit(false); }} />}
    </Screen>
  );
}

function EditForm({ p, onSaved }: { p: TP; onSaved: (p: TP) => void }) {
  const { t } = useT();
  const [bio, setBio] = useState(p.bio ?? "");
  const [subjects, setSubjects] = useState(p.subjects.join(", "));
  const [languages, setLanguages] = useState(p.languages.join(", "));
  const [years, setYears] = useState(p.years != null ? String(p.years) : "");
  const [qual, setQual] = useState(p.qualification ?? "");
  const [district, setDistrict] = useState(p.district ?? "");
  const [avatar, setAvatar] = useState(p.avatar);
  const [error, setError] = useState("");
  const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const field = "min-h-12 rounded-xl border border-line bg-surface px-3 text-base";
  const save = async () => {
    const r = await call<TP>("/v2/teachers/me/profile", { method: "PUT", body: JSON.stringify({ bio: bio || null, subjects: split(subjects), languages: split(languages),
      years: years ? Number(years) : null, qualification: qual || null, district: district || null, avatar }) });
    if (isError(r)) setError(r.error); else onSaved(r);
  };
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">{AVATARS.map((a) => <button key={a} onClick={() => setAvatar(a)} className={`size-11 rounded-xl border text-2xl ${avatar === a ? "border-brand bg-brand-soft" : "border-line"}`}>{a}</button>)}</div>
      <textarea className={`${field} min-h-24 py-2`} placeholder={t("bioHint")} value={bio} onChange={(e) => setBio(e.target.value)} />
      <input className={field} placeholder={t("subjectsHint")} value={subjects} onChange={(e) => setSubjects(e.target.value)} />
      <input className={field} placeholder={t("languagesHint")} value={languages} onChange={(e) => setLanguages(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <input className={field} placeholder={t("yearsHint")} inputMode="numeric" value={years} onChange={(e) => setYears(e.target.value.replace(/\D/g, ""))} />
        <input className={field} placeholder={t("district")} value={district} onChange={(e) => setDistrict(e.target.value)} />
      </div>
      <input className={field} placeholder={t("qualification")} value={qual} onChange={(e) => setQual(e.target.value)} />
      {error && <p className="rounded-lg bg-bad-soft p-2 text-sm text-bad">{error}</p>}
      <Button onClick={() => void save()}>{t("save")}</Button>
    </Card>
  );
}
