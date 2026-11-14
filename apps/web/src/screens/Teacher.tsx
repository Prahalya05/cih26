
import { useEffect, useMemo, useState } from "react";
import type { Go } from "../App";
import { Button, Pill, Screen, useLive, useOnline } from "../components/ui";
import { addAction, db, type Action, type Student } from "../lib/db";
import { raterId, recordEvent } from "../lib/events";
import { profileOf } from "../lib/skills";
import type { Profile } from "@disha/engine";
import { clearDemoClass, loadDemoClass, storyOf } from "../lib/demo";
import { playStory } from "../lib/stories";
import { useT } from "../lib/i18n";
import { kb } from "../lib/kb";
import { SECTOR } from "../lib/labels";
import { analyse, isStrongMatch, type Analysis } from "../lib/profile";
import { pullCohort, syncNow } from "../lib/sync";
import { rubricFor, samplesToConfirm } from "../lib/samples";
import type { StoredEvent } from "../lib/db";

const savedCode = () => {
  try {
    return localStorage.getItem("disha.code") ?? "";
  } catch {
    return "";
  }
};

/** A teacher confirms a skill: kept as a v1 action and as a rating event. */
async function endorse(studentId: string, skillId: string) {
  await addAction({
    student_id: studentId,
    kind: "endorse",
    payload: { skill_id: skillId },
    by: "teacher",
  });

  await recordEvent({
    student_id: studentId,
    kind: "rating",
    rater_id: await raterId(),
    skill_id: skillId,
    payload: { endorse: true },
  });
}

export default function Teacher({ go }: { go: Go }) {
  const { t, lang } = useT();
  const online = useOnline();
  const [code, setCode] = useState(savedCode);
  const [draft, setDraft] = useState(code);
  const [open, setOpen] = useState<string | null>(null);

  const students = useLive(
    () =>
      code
        ? db.students.where("facilitator_code").equals(code).toArray()
        : Promise.resolve([] as Student[]),
    [code],
    [] as Student[],
  );

  const actions = useLive(() => db.actions.toArray(), [], [] as Action[]);

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
      const a = analyse(
        s,
        actions.filter((x) => x.student_id === s.id),
        lang,
        profiles[s.id],
      );
      return { s, a, strong: isStrongMatch(a) };
    });

    return list.sort(
      (x, y) =>
        Number(y.strong) - Number(x.strong) ||
        (y.a.careers.careers[0]?.score ?? 0) -
          (x.a.careers.careers[0]?.score ?? 0),
    );
  }, [students, actions, lang, profiles]);

  if (!code) {
    return (
      <Screen title={t("teacherTitle")} onBack={() => go({ name: "home" })}>
        <div className="flex flex-col gap-5">
          <section className="rounded-3xl border border-line bg-white p-6 text-center shadow-sm">
            <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-3xl bg-brand-soft text-4xl">
              👩‍🏫
            </div>
            <h2 className="text-xl font-bold">{t("teacherTitle")}</h2>
          </section>

          <section className="rounded-3xl border border-line bg-white p-5 shadow-sm">
            <label className="flex flex-col gap-2">
              <span className="font-semibold">{t("facilitatorCode")}</span>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="PSG01"
                className="min-h-14 rounded-2xl border-2 border-line bg-paper px-4 text-lg uppercase outline-none focus:border-brand"
              />
            </label>

            <div className="mt-4">
              <Button
                disabled={!draft.trim()}
                onClick={() => {
                  const c = draft.trim().toUpperCase();
                  try {
                    localStorage.setItem("disha.code", c);
                  } catch {
                    /* ignore */
                  }
                  setCode(c);
                }}
              >
                {t("next")} →
              </Button>
            </div>
          </section>
        </div>
      </Screen>
    );
  }

  const strongCount = rows.filter((r) => r.strong).length;

  return (
    <Screen
      title={t("teacherTitle")}
      onBack={() => go({ name: "home" })}
      right={
        <button
          onClick={() => setCode("")}
          className="rounded-full bg-brand-soft px-3 py-2 text-sm font-semibold text-brand-dark"
        >
          {code}
        </button>
      }
    >
      <div className="flex flex-col gap-5 pb-4">
        {/* Dashboard statistics */}
        <section className="grid grid-cols-3 gap-2">
          <Stat value={rows.length} label={t("students")} />
          <Stat value={strongCount} label={t("strongMatch")} />
          <Stat value={pending} label={online ? "⇅" : "📴"} />
        </section>

        {/* Synchronisation */}
        {pending > 0 && online && (
          <Button kind="soft" onClick={() => void syncNow()}>
            ⇅ Sync ({pending})
          </Button>
        )}

        {/* Work waiting for review */}
        <WorkQueue students={students} />

        {/* Student list */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">{t("students")}</h2>
            <Pill tone="brand">{rows.length}</Pill>
          </div>

          {rows.length === 0 && (
            <div className="rounded-3xl border border-line bg-white p-6 text-center">
              <div className="mb-3 text-4xl">👩‍🎓</div>
              <p className="text-sm text-muted">{t("noStudents")}</p>
            </div>
          )}

          {rows.map(({ s, a, strong }) => (
            <StudentRow
              key={s.id}
              s={s}
              a={a}
              strong={strong}
              open={open === s.id}
              onToggle={() => setOpen(open === s.id ? null : s.id)}
              go={go}
            />
          ))}
        </section>

        {/* Demo class controls */}
        <div className="flex flex-col gap-2 rounded-3xl border border-line bg-white p-4 shadow-sm">
          {!rows.some((r) => r.s.simulated) ? (
            <Button
              kind="ghost"
              className="text-base"
              onClick={() => loadDemoClass(code)}
            >
              🧪 {t("loadDemo")}
            </Button>
          ) : (
            <Button
              kind="ghost"
              className="text-base"
              onClick={() => clearDemoClass()}
            >
              🧹 {t("simulated")} ✕
            </Button>
          )}
        </div>
      </div>
    </Screen>
  );
}

/** Photos of students' work waiting for the teacher. */
function WorkQueue({ students }: { students: Student[] }) {
  const { t } = useT();

  const queue = useLive(
    () => samplesToConfirm(students.map((s) => s.id)),
    [students],
    [] as StoredEvent[],
  );

  if (!queue.length) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">📷 {t("workToCheck")}</h2>
        <Pill tone="sun">{queue.length}</Pill>
      </div>

      {queue.map((e) => (
        <SampleCard
          key={e.id}
          sample={e}
          student={students.find((s) => s.id === e.student_id)}
        />
      ))}
    </section>
  );
}

function SampleCard({
  sample,
  student,
}: {
  sample: StoredEvent;
  student?: Student;
}) {
  const { t, pick } = useT();
  const rubric = rubricFor(student, String(sample.payload.rubric_id));
  const ai = (sample.payload.scores ?? {}) as Record<string, number>;
  const reasons = (sample.payload.reasons ?? {}) as Record<string, string>;

  const [scores, setScores] = useState<Record<string, number>>(ai);

  const media = useLive(
    () => db.media.get(String(sample.payload.media_ref ?? "")),
    [sample.id],
    undefined,
  );

  const url = useMemo(
    () => (media ? URL.createObjectURL(media.blob) : null),
    [media],
  );

  if (!rubric) return null;

  const complete = rubric.criteria.every((c) => c.id in scores);

  const confirm = async () => {
    await recordEvent({
      student_id: sample.student_id,
      kind: "rating",
      rater_id: await raterId(),
      refers_to: sample.id,
      payload: { scores },
    });
  };

  return (
    <article className="rounded-3xl border border-line bg-white p-4 shadow-sm">
      <div className="mb-3">
        <p className="font-bold">
          {student?.avatar} {student?.name}
        </p>
        <p className="mt-1 text-sm text-muted">{pick(rubric.name)}</p>
      </div>

      {url ? (
        <img
          src={url}
          alt=""
          className="max-h-56 w-full rounded-2xl bg-paper object-contain"
        />
      ) : (
        <p className="rounded-2xl bg-paper p-3 text-sm text-muted">
          {t("noPhotoHere")}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {rubric.criteria.map((c) => (
          <div key={c.id} className="rounded-2xl bg-paper p-3">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm font-semibold">
                {pick(c.name)}
              </span>

              {[0, 1, 2].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setScores({ ...scores, [c.id]: v })}
                  aria-pressed={scores[c.id] === v}
                  className={`flex size-9 shrink-0 items-center justify-center rounded-xl border-2 text-sm font-bold ${
                    scores[c.id] === v
                      ? "border-brand bg-brand text-white"
                      : "border-line bg-white text-muted"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>

            {reasons[c.id] && (
              <p className="mt-2 text-xs leading-5 text-muted">
                🤖 {reasons[c.id]}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4">
        <Button
          className="w-full"
          disabled={!complete}
          onClick={() => void confirm()}
        >
          ✔ {t("confirmScores")}
        </Button>
      </div>
    </article>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-3 text-center shadow-sm">
      <p className="text-2xl font-bold text-brand-dark">{value}</p>
      <p className="mt-1 text-xs leading-4 text-muted">{label}</p>
    </div>
  );
}

function StudentRow({
  s,
  a,
  strong,
  open,
  onToggle,
  go,
}: {
  s: Student;
  a: Analysis;
  strong: boolean;
  open: boolean;
  onToggle: () => void;
  go: Go;
}) {
  const { t, pick } = useT();

  const top = a.careers.careers[0];
  const eligible = a.schemes.filter((x) => x.status === "eligible");

  const recommendedSchemes = new Set(
    a.recommendations.map((r) => r.payload.scheme_id),
  );

  const recommendedCareers = new Set(
    a.recommendations.map((r) => r.payload.occupation_id),
  );

  return (
    <article
      className={`overflow-hidden rounded-3xl border bg-white shadow-sm ${
        strong ? "border-sun ring-2 ring-sun/50" : "border-line"
      }`}
    >
      {/* Student summary */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-4 text-left"
        aria-expanded={open}
      >
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-3xl">
          {s.avatar}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{s.name}</p>

          {top && (
            <p className="mt-1 truncate text-sm text-muted">
              {SECTOR[top.sector]?.emoji}{" "}
              {pick(kb.occupations[top.occupation_id].name)}
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-1">
            {strong && (
              <Pill tone="sun">⭐ {t("strongMatch")}</Pill>
            )}
            <Pill tone="good">
              {t("eligibleCount", { n: eligible.length })}
            </Pill>
            {s.simulated && <Pill>🧪 {t("simulated")}</Pill>}
          </div>
        </div>

        <span className="text-xl text-muted">{open ? "▾" : "›"}</span>
      </button>

      {/* Expanded student details */}
      {open && (
        <div className="flex flex-col gap-5 border-t border-line bg-paper/60 p-4">
          {storyOf(s.id) && (
            <button
              onClick={() => {
                go({ name: "results", id: s.id, tab: "strengths" });
                void playStory(s.id, storyOf(s.id)!);
              }}
              className="min-h-12 rounded-2xl bg-brand px-3 text-base font-semibold text-white"
            >
              ▶ {t("playStory")}
            </button>
          )}

          {/* Teacher rating actions */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => go({ name: "rate", id: s.id, mode: "term" })}
              className="min-h-14 rounded-2xl border border-brand/20 bg-brand-soft px-3 text-sm font-semibold text-brand-dark"
            >
              📋 {t("rateTerm")}
            </button>

            <button
              onClick={() => go({ name: "rate", id: s.id, mode: "taster" })}
              className="min-h-14 rounded-2xl border border-sun/30 bg-sun-soft px-3 text-sm font-semibold text-warn"
            >
              🧑‍🔧 {t("rateTaster")}
            </button>
          </div>

          {/* Strengths */}
          <section className="rounded-2xl border border-line bg-white p-4">
            <p className="mb-3 font-bold">{t("strengths")}</p>

            <ul className="flex flex-col gap-3">
              {a.skills.map((sk) => (
                <li
                  key={sk.id}
                  className="flex items-center gap-2 border-b border-line pb-3 last:border-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {pick(kb.skills[sk.id].name)}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      {sk.evidence.map((e) => e.text).join(" · ")}
                    </p>
                  </div>

                  {sk.endorsed ? (
                    <Pill tone="good">✔ {t("endorsedBy")}</Pill>
                  ) : (
                    <button
                      onClick={() => void endorse(s.id, sk.id)}
                      className="rounded-xl bg-good-soft px-3 py-2 text-sm font-semibold text-good"
                    >
                      ✔ {t("endorse")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* Career recommendations */}
          <section className="rounded-2xl border border-line bg-white p-4">
            <p className="mb-3 font-bold">{t("careers")}</p>

            <ul className="flex flex-col gap-3">
              {a.careers.careers.slice(0, 3).map((c) => (
                <li
                  key={c.occupation_id}
                  className="flex items-center gap-2"
                >
                  <span className="min-w-0 flex-1 text-sm font-medium">
                    {SECTOR[c.sector]?.emoji}{" "}
                    {pick(kb.occupations[c.occupation_id].name)}
                    <span className="ml-1 text-xs text-muted">
                      {Math.round(c.score * 100)}%
                    </span>
                  </span>

                  {recommendedCareers.has(c.occupation_id) ? (
                    <Pill tone="good">⭐</Pill>
                  ) : (
                    <button
                      onClick={() =>
                        addAction({
                          student_id: s.id,
                          kind: "recommend",
                          payload: { occupation_id: c.occupation_id },
                          by: "teacher",
                        })
                      }
                      className="rounded-xl bg-sun-soft px-3 py-2 text-sm font-semibold text-warn"
                    >
                      ⭐ {t("recommend")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* Eligible schemes */}
          <section className="rounded-2xl border border-line bg-white p-4">
            <p className="mb-3 font-bold">{t("eligibleNow")}</p>

            {eligible.length === 0 && (
              <p className="text-sm text-muted">—</p>
            )}

            <ul className="flex flex-col gap-3">
              {eligible.map((x) => (
                <li
                  key={x.scheme_id}
                  className="flex items-center gap-2"
                >
                  <span className="min-w-0 flex-1 text-sm font-medium">
                    {pick(x.name)}
                  </span>

                  {recommendedSchemes.has(x.scheme_id) ? (
                    <Pill tone="good">⭐</Pill>
                  ) : (
                    <button
                      onClick={() =>
                        addAction({
                          student_id: s.id,
                          kind: "recommend",
                          payload: { scheme_id: x.scheme_id },
                          by: "teacher",
                        })
                      }
                      className="rounded-xl bg-sun-soft px-3 py-2 text-sm font-semibold text-warn"
                    >
                      ⭐ {t("recommend")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </article>
  );
}
