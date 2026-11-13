import { useEffect, useMemo, useState } from "react";
import type { Go } from "../App";
import { Button, Pill, Screen, useLive, useOnline } from "../components/ui";
import { addAction, db, type Action, type Student } from "../lib/db";
import { clearDemoClass, loadDemoClass } from "../lib/demo";
import { useT } from "../lib/i18n";
import { kb } from "../lib/kb";
import { SECTOR } from "../lib/labels";
import { analyse, isStrongMatch, type Analysis } from "../lib/profile";
import { pullCohort, syncNow } from "../lib/sync";

const savedCode = () => { try { return localStorage.getItem("disha.code") ?? ""; } catch { return ""; } };

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
  const pending = actions.filter((a) => !a.synced).length;

  useEffect(() => {
    if (code && online) void pullCohort(code);
  }, [code, online]);

  const rows = useMemo(() => {
    const list = students.map((s) => {
      const a = analyse(s, actions.filter((x) => x.student_id === s.id), lang);
      return { s, a, strong: isStrongMatch(a) };
    });
    return list.sort((x, y) => Number(y.strong) - Number(x.strong) || (y.a.careers.careers[0]?.score ?? 0) - (x.a.careers.careers[0]?.score ?? 0));
  }, [students, actions, lang]);

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
                    : <button onClick={() => addAction({ student_id: s.id, kind: "endorse", payload: { skill_id: sk.id }, by: "teacher" })}
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
