import { useEffect, useMemo, useRef, useState } from "react";
import type { Go } from "../App";
import { Button, Pill, Screen, useLive, useOnline } from "../components/ui";
import { addAction, db, type Action, type Student } from "../lib/db";
import { raterId, recordEvent } from "../lib/events";
import { profileOf } from "../lib/skills";
import type { Profile } from "@disha/engine";
import { clearDemoClass, loadDemoClass, storyOf } from "../lib/demo";
import { playStory } from "../lib/stories";
import { useT } from "../lib/i18n";
import { kb, opportunityById } from "../lib/kb";
import { SECTOR } from "../lib/labels";
import { analyse, isStrongMatch, type Analysis } from "../lib/profile";
import { pullCohort, syncNow } from "../lib/sync";
import { deviceRole, register, type Role } from "../lib/api";
import { linkSchoolCode, useAccount } from "../lib/auth";
import { TeacherAreaTabs } from "../components/TeacherAreaTabs";
import { autoConfirmed, rubricFor, samplesToConfirm } from "../lib/samples";
import { DocsPanel, OverridePanel, SuggestPanel } from "../components/TeacherTools";
import type { MediaRow, StoredEvent } from "../lib/db";
import { Icon } from "../components/Icon";
import { integrityOf, SERIOUS, type Flag, type IntegritySummary } from "../lib/integrity";

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
  const [schoolErr, setSchoolErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const role = useLive(() => deviceRole(), [code, joining], null as Role | null);
  // A signed-in teacher's class comes from her account; the tab bar replaces the back arrow.
  const account = useAccount();
  const back = account ? undefined : () => go({ name: "home" });
  const isOnlineRoom = code.startsWith("ONL-");
  useEffect(() => {
    if (account?.school_kind === "school" && account.class_code && !code) {
      setCode(account.class_code);
    }
  }, [account?.school_kind, account?.class_code]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (account && account.school_kind !== "school") {
      return (
        <Screen title={t("teacherTitle")} onBack={back}>
          <TeacherAreaTabs area="school" account={account} go={go} />
          <div className="rounded-2xl border border-line bg-surface p-4 flex flex-col gap-2">
            <p className="text-lg font-extrabold">{t("onlineOnlyTeacherTitle")}</p>
            <p className="text-sm text-muted">{t("onlineOnlyTeacherHint")}</p>
            <Button onClick={() => go({ name: "classrooms" })}><Icon name="users" className="size-5" />{t("onlineClassrooms")}</Button>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-4 flex flex-col gap-2">
            <p className="font-bold">{t("linkSchoolTitle")}</p>
            <p className="text-sm text-muted">{t("linkSchoolHint")}</p>
            <input value={draft} onChange={(e) => setDraft(e.target.value.toUpperCase())} placeholder="TCH-01"
              className="min-h-12 rounded-xl border border-line bg-paper px-3 text-base uppercase" />
            {schoolErr && <p role="alert" className="rounded-xl bg-bad-soft p-2.5 text-sm font-semibold text-bad">{schoolErr}</p>}
            <Button kind="soft" disabled={!draft.trim() || joining} onClick={async () => {
              setJoining(true); setSchoolErr("");
              const r = await linkSchoolCode(draft.trim());
              setJoining(false);
              if ("error" in r) setSchoolErr(r.error);
              else if (r.class_code) { setCode(r.class_code); setDraft(""); }
            }}>{t("linkSchoolButton")}</Button>
          </div>
        </Screen>
      );
    }
    return (
      <Screen title={t("teacherTitle")} onBack={back}>
        <TeacherAreaTabs area="school" account={account} go={go} />
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t("facilitatorCode")}</span>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="PSG01"
            className="min-h-14 rounded-xl border border-line bg-surface px-4 text-lg uppercase" />
        </label>
        <p className="text-muted">{t("teacherCodeHint")}</p>
        {account && <Button kind="soft" onClick={() => go({ name: "classrooms" })}><Icon name="users" className="size-5" />{t("teachOnline")}</Button>}
        <Button disabled={!draft.trim() || joining} onClick={async () => {
          const typed = draft.trim().toUpperCase();
          // A teacher code registers this phone as a teacher's phone and tells us which class it is for.
          // Offline (or for the made-up demo class) the code is used as typed.
          setJoining(true);
          const reg = online ? await register(typed) : null;
          setJoining(false);
          const c = reg?.class_code ?? typed;
          try { localStorage.setItem("disha.code", c); } catch { /* ignore */ }
          setCode(c);
        }}>{t("next")} <Icon name="next" className="size-5" /></Button>
      </Screen>
    );
  }

  const strongCount = rows.filter((r) => r.strong).length;

  return (
    <Screen
      title={t("teacherTitle")}
      onBack={back}
      right={<button onClick={() => (account ? go({ name: "classrooms" }) : setCode(""))} className="rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold text-brand-dark">{code}</button>}
    >
      <TeacherAreaTabs
        area={isOnlineRoom ? "online" : "school"}
        account={account}
        go={go}
        onSelectSchool={() => {
          if (account?.school_kind === "school" && account.class_code) setCode(account.class_code);
          else setCode("");
        }}
      />
      <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
        <span className="font-bold text-brand">
          {isOnlineRoom ? t("onlineClassroomTag", { code }) : t("schoolClassTag", { code })}
          {!isOnlineRoom && account?.school_name ? ` · ${account.school_name}` : ""}
        </span>
        {isOnlineRoom && (
          <button onClick={() => go({ name: "classrooms" })} className="text-xs font-bold text-accent-dark underline">
            {t("backToOnlineRooms")}
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat value={rows.length} label={t("students")} />
        <Stat value={strongCount} label={t("strongMatch")} />
        <Stat value={pending} label={online ? "Sync" : "Offline"} />
      </div>
      {pending > 0 && online && <Button kind="soft" onClick={() => void syncNow()}><Icon name="sync" className="size-5" />Sync ({pending})</Button>}
      {role === "student" && <p className="rounded-xl bg-brand-soft p-3 text-sm">{t("notTeacherPhone")}</p>}

      <WorkQueue students={students} />

      {rows.length === 0 && <p className="text-muted">{t("noStudents")}</p>}

      {rows.map(({ s, a, strong }) => (
        <StudentRow key={s.id} s={s} a={a} profile={profiles[s.id]} strong={strong} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} go={go} />
      ))}

      <div className="mt-4 flex flex-col gap-2">
        {!rows.some((r) => r.s.simulated)
          ? <Button kind="ghost" className="text-base" onClick={() => loadDemoClass(code)}><Icon name="flask" className="size-5" />{t("loadDemo")}</Button>
          : <Button kind="ghost" className="text-base" onClick={() => clearDemoClass()}><Icon name="x" className="size-5" />{t("simulated")}</Button>}
      </div>
    </Screen>
  );
}

/** Photos of students' work waiting for the teacher: confirm the AI's scores or correct them, one tap each. */
function WorkQueue({ students }: { students: Student[] }) {
  const { t } = useT();
  const queue = useLive(() => samplesToConfirm(students.map((s) => s.id)), [students], [] as StoredEvent[]);
  const auto = useLive(() => autoConfirmed(students.map((s) => s.id)), [students], [] as StoredEvent[]);
  if (!queue.length && !auto.length) return null;
  return (
    <section className="flex flex-col gap-3">
      {auto.length > 0 && (
        <details className="rounded-2xl border border-good/40 bg-good-soft p-3">
          <summary className="cursor-pointer font-bold text-good"><Icon name="check" className="mr-1 inline size-4" />{t("autoConfirmedN", { n: auto.length })}</summary>
          <p className="mt-1 text-xs text-muted">{t("autoConfirmedHint")}</p>
          <div className="mt-2 flex flex-col gap-2">{auto.map((e) => <SampleCard key={e.id} sample={e} student={students.find((s) => s.id === e.student_id)} />)}</div>
        </details>
      )}
      <h2 className="flex items-center gap-2 text-xl font-extrabold"><Icon name="camera" className="size-5 text-accent-dark" />{t("workToCheck")} <span className="font-mono text-base text-muted">{queue.length}</span></h2>
      {queue.map((e) => <SampleCard key={e.id} sample={e} student={students.find((s) => s.id === e.student_id)} />)}
    </section>
  );
}

function SampleCard({ sample, student }: { sample: StoredEvent; student?: Student }) {
  const { t, pick } = useT();
  const rubric = rubricFor(student, String(sample.payload.rubric_id));
  const ai = (sample.payload.scores ?? {}) as Record<string, number>;
  const reasons = (sample.payload.reasons ?? {}) as Record<string, string>;
  const times = (sample.payload.times ?? {}) as Record<string, string>;
  const safetyNotes = (sample.payload.safety ?? []) as { time: string; note: string }[];
  const player = useRef<HTMLVideoElement>(null);
  const jump = (mmss: string) => {
    const [m, s] = mmss.split(":").map(Number);
    if (player.current) { player.current.currentTime = m * 60 + s; void player.current.play(); }
  };
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
    <article className="rounded-2xl bg-surface p-4 border border-line">
      <p className="font-semibold">{student?.avatar} {student?.name} · {pick(rubric.name)}</p>
      {url && media?.blob.type.startsWith("video/")
        ? <video ref={player} src={url} controls playsInline className="mt-2 max-h-56 w-full rounded-xl bg-black" />
        : url ? <img src={url} alt="" className="mt-2 max-h-56 w-full rounded-xl object-contain" />
        : <p className="mt-1 text-sm text-muted">{t("noPhotoHere")}</p>}
      <LongClips sample={sample} />
      <SystemChecks sample={sample} />
      {safetyNotes.map((n, i) => <p key={i} className="mt-1 flex gap-1.5 text-sm text-warn"><Icon name="alert" className="mt-0.5 size-4" /><span><span className="font-mono">{n.time}</span> {n.note}</span></p>)}
      <ul className="mt-3 flex flex-col gap-2">
        {rubric.criteria.map((c) => (
          <li key={c.id}>
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm font-medium">{pick(c.name)}</span>
              {[0, 1, 2].map((v) => (
                <button key={v} onClick={() => setScores({ ...scores, [c.id]: v })} aria-pressed={scores[c.id] === v}
                  className={`size-10 rounded-xl border font-bold ${scores[c.id] === v ? "border-brand bg-brand text-white" : "border-line"}`}>
                  {v}
                </button>
              ))}
            </div>
            {reasons[c.id] && <p className="mt-1 text-xs text-muted"><Icon name="bot" className="mr-1 inline size-3.5 align-[-2px]" />{times[c.id] && (
              <button className="mr-1 rounded bg-brand-soft px-1 font-mono text-brand" onClick={() => jump(times[c.id])}>▶ {times[c.id]}</button>
            )}{reasons[c.id]}</p>}
          </li>
        ))}
      </ul>
      <Button className="mt-3 w-full" disabled={!complete} onClick={() => void confirm()}><Icon name="check" className="size-5" />{t("confirmScores")}</Button>
    </article>
  );
}

/** What the rules said about this video: is it really her (rule.identity), and why the system did or did not confirm it. */
function SystemChecks({ sample }: { sample: StoredEvent }) {
  const { t } = useT();
  const id = sample.payload.identity as { status: string; why: string[] } | undefined;
  const auto = sample.payload.autoconfirm as { decision: string; why: string[] } | undefined;
  // trust score: a fixed rule over the warnings while filming (not the AI); separate from the skill score
  const trust = sample.payload.trust as { score: number; band: "high" | "medium" | "low"; why: string[] } | undefined;
  const odd = (sample.payload.suspicious ?? []) as { time: string; note: string }[];
  if (!id && !auto && !trust) return null;
  return (
    <details className="mt-2 rounded-lg bg-paper p-2 text-xs">
      <summary className="flex cursor-pointer flex-wrap items-center gap-1">
        {id && <Pill tone={id.status === "verified" ? "good" : id.status === "mismatch" ? "bad" : "sun"}><Icon name="scan" className="size-3.5" />{t(`identity_${id.status}` as "identity_verified")}</Pill>}
        {auto && <Pill tone={auto.decision === "auto_confirm" ? "good" : "neutral"}>{auto.decision === "auto_confirm" ? t("systemConfirmed") : t("needsTeacher")}</Pill>}
        {trust && <Pill tone={trust.band === "high" ? "good" : trust.band === "medium" ? "sun" : "bad"}><Icon name="shield" className="size-3.5" />{t("trustScore", { n: trust.score })}</Pill>}
      </summary>
      {odd.length > 0 && <ul className="mt-1">{odd.map((x, i) => <li key={i}><span className="font-mono">{x.time}</span> {x.note}</li>)}</ul>}
      <ul className="mt-1 font-mono">{[...(trust?.why ?? []), ...(id?.why ?? []), ...(auto?.why ?? [])].map((w, i) => <li key={i}>{w}</li>)}</ul>
    </details>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl bg-surface p-3 border border-line">
      <p className="text-2xl font-extrabold">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function StudentRow({ s, a, profile, strong, open, onToggle, go }: { s: Student; a: Analysis; profile?: Profile; strong: boolean; open: boolean; onToggle: () => void; go: Go }) {
  const { t, pick } = useT();
  const top = a.careers.careers[0];
  const fair = useLive(async () => integrityOf(await db.events.where("student_id").equals(s.id).toArray()), [s.id], [] as IntegritySummary[]);
  const needsLook = fair.some((f) => f.serious);
  const eligible = a.schemes.filter((x) => x.status === "eligible");
  const recommendedSchemes = new Set(a.recommendations.map((r) => r.payload.scheme_id));
  const recommendedCareers = new Set(a.recommendations.map((r) => r.payload.occupation_id));

  return (
    <article className={`rounded-2xl bg-surface border border-line ${strong ? "ring-2 ring-sun" : ""}`}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 p-4 text-left" aria-expanded={open}>
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-paper text-3xl">{s.avatar}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{s.name}</p>
          {top && <p className="truncate text-sm text-muted">{pick(kb.occupations[top.occupation_id].name)}</p>}
          <div className="mt-1 flex flex-wrap gap-1">
            {strong && <Pill tone="sun"><Icon name="star" className="size-3.5" />{t("strongMatch")}</Pill>}
            <Pill tone="good">{t("eligibleCount", { n: eligible.length })}</Pill>
            {needsLook && <Pill tone="bad"><Icon name="alert" className="size-3.5" />{t("integrityNeedsLook")}</Pill>}
            {s.simulated && <Pill><Icon name="flask" className="size-3.5" />{t("simulated")}</Pill>}
          </div>
        </div>
        <Icon name={open ? "chevronDown" : "chevron"} className="size-5 text-faint" />
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-line p-4">
          {fair.length > 0 && <FairCheck rows={fair} />}
          {storyOf(s.id) && (
            <button onClick={() => { go({ name: "results", id: s.id, tab: "strengths" }); void playStory(s.id, storyOf(s.id)!); }}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand px-3 text-base font-bold text-white"><Icon name="play" className="size-4" />{t("playStory")}</button>
          )}
          <button onClick={() => go({ name: "studentProfile", id: s.id })}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-bold"><Icon name="users" className="size-4" />{t("openProfile")}</button>
          <button onClick={() => go({ name: "graph", id: s.id, from: { name: "teacher" } })}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-accent bg-surface px-3 text-sm font-bold text-accent-dark"><Icon name="chain" className="size-4" />{t("viewMap")}</button>
          {a.applications.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold text-muted">{t("applications")}</p>
              <ul className="flex flex-col gap-2">
                {a.applications.map((ap) => {
                  const oid = String(ap.payload.opportunity_id);
                  const opp = opportunityById[oid];
                  if (!opp) return null;
                  const rec = a.recommendations.some((r) => r.payload.opportunity_id === oid);
                  return (
                    <li key={ap.id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{pick(opp.title)}</span>
                        <span className="block text-xs text-muted">{t(`opp_${String(ap.payload.readiness) as "ready" | "almost" | "later"}`)}{ap.payload.message ? ` · “${String(ap.payload.message)}”` : ""}</span>
                      </span>
                      {rec ? <Pill tone="good"><Icon name="star" className="size-3.5" /></Pill>
                        : <button onClick={() => addAction({ student_id: s.id, kind: "recommend", payload: { opportunity_id: oid }, by: "teacher" })}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-sun-soft px-3 py-2 text-sm font-bold text-warn"><Icon name="star" className="size-4" />{t("recommend")}</button>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <SuggestPanel s={s} a={a} />
          <OverridePanel s={s} profile={profile} />
          <DocsPanel s={s} />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => go({ name: "rate", id: s.id, mode: "term" })} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-soft px-3 text-sm font-bold text-brand"><Icon name="clipboard" className="size-4" />{t("rateTerm")}</button>
            <button onClick={() => go({ name: "rate", id: s.id, mode: "taster" })} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-sun-soft px-3 text-sm font-bold text-warn"><Icon name="wrench" className="size-4" />{t("rateTaster")}</button>
          </div>
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
                    ? <Pill tone="good"><Icon name="check" className="size-3.5" />{t("endorsedBy")}</Pill>
                    : <button onClick={() => void endorse(s.id, sk.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-good-soft px-3 py-2 text-sm font-bold text-good"><Icon name="check" className="size-4" />{t("endorse")}</button>}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-muted">{t("careers")}</p>
            <ul className="flex flex-col gap-2">
              {a.careers.careers.slice(0, 3).map((c) => (
                <li key={c.occupation_id} className="flex items-center gap-2">
                  <span className="flex-1">{pick(kb.occupations[c.occupation_id].name)} <span className="text-xs text-muted">{Math.round(c.score * 100)}%</span></span>
                  {recommendedCareers.has(c.occupation_id)
                    ? <Pill tone="good"><Icon name="star" className="size-3.5" /></Pill>
                    : <button onClick={() => addAction({ student_id: s.id, kind: "recommend", payload: { occupation_id: c.occupation_id }, by: "teacher" })}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-sun-soft px-3 py-2 text-sm font-bold text-warn"><Icon name="star" className="size-4" />{t("recommend")}</button>}
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
                    ? <Pill tone="good"><Icon name="star" className="size-3.5" /></Pill>
                    : <button onClick={() => addAction({ student_id: s.id, kind: "recommend", payload: { scheme_id: x.scheme_id }, by: "teacher" })}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-sun-soft px-3 py-2 text-sm font-bold text-warn"><Icon name="star" className="size-4" />{t("recommend")}</button>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </article>
  );
}

/** Fair-test check per sub-skill: how many answers carried a warning, and which warnings. */
function FairCheck({ rows }: { rows: IntegritySummary[] }) {
  const { t, pick } = useT();
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-muted"><Icon name="scan" className="size-4" />{t("integrityTitle")}</p>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.subskill} className={`rounded-xl border p-3 ${r.serious ? "border-bad/30 bg-bad-soft" : r.flagged ? "border-sun/40 bg-sun-soft" : "border-line"}`}>
            <div className="flex items-center gap-2">
              <span className="flex-1 font-medium">{pick(kb.graph!.subskills[r.subskill]?.name ?? { en: r.subskill })}</span>
              {r.mode !== "camera" && <Pill><Icon name="eyeOff" className="size-3.5" />{t("integrityOff")}</Pill>}
            </div>
            <p className={`text-sm ${r.serious ? "text-bad" : r.flagged ? "text-warn" : "text-muted"}`}>
              {r.flagged ? t("integrityFlagged", { flagged: r.flagged, total: r.answers }) : t("integrityClean", { total: r.answers })}
            </p>
            {r.flagged > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {(Object.entries(r.counts) as [Flag, number][]).sort((x, y) => y[1] - x[1]).map(([f, n]) => (
                  <Pill key={f} tone={SERIOUS.has(f) ? "bad" : "sun"}>{t(`flag_${f}` as "flag_phone")} · {n}</Pill>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {rows.some((r) => r.flagged) && <p className="mt-2 text-xs text-muted">{t("integrityHint")}</p>}
    </div>
  );
}

/** A long task's full-speed clips (busiest moments and the finished work), if they are on this phone. */
function LongClips({ sample }: { sample: StoredEvent }) {
  const { t } = useT();
  const refs = (sample.payload.clip_refs ?? []) as { ref: string; at: number; why: "active" | "final" }[];
  const rows = useLive(() => db.media.bulkGet(refs.map((r) => r.ref)), [sample.id], [] as (MediaRow | undefined)[]);
  const urls = useMemo(() => rows.map((m) => (m ? URL.createObjectURL(m.blob) : null)), [rows]);
  if (sample.payload.mode !== "long") return null;
  return (
    <div className="mt-2 flex flex-col gap-1 text-sm">
      <p className="text-muted">{t("longTaskNote")}</p>
      {refs.map((r, i) => urls[i] && (
        <figure key={r.ref}>
          <figcaption className="font-mono text-xs text-muted">
            {Math.floor(r.at / 60)}:{String(r.at % 60).padStart(2, "0")} · {r.why === "final" ? t("clipFinal") : t("clipBusy")}
          </figcaption>
          <video src={urls[i]!} controls playsInline className="max-h-40 w-full rounded-lg bg-black" />
        </figure>
      ))}
    </div>
  );
}
