// Teacher tools inside a student's card:
//   - Override a skill level (rule.override): a reason is required; lowering applies fully, raising is shown to her
//     but never counts as proof for a donor's payout.
//   - Check documents: see the AI's first look, mark verified (she saw the original) or rejected; write the income
//     printed on an income certificate (used by the donor pay check).
//   - Suggest an internship, job, scheme or career, with a note the student sees.

import { useEffect, useState } from "react";
import type { DocKind, Profile } from "@disha/engine";
import { OVERRIDE_RULE } from "@disha/engine";
import { addAction, type Student } from "../lib/db";
import { raterId, recordEvent } from "../lib/events";
import { useT, type StringKey } from "../lib/i18n";
import { kb } from "../lib/kb";
import type { Analysis } from "../lib/profile";
import { fetchDocs, verifyDoc, type DocRow } from "../lib/docs";
import { emit } from "../lib/xray";
import { Icon } from "./Icon";
import { Button, Pill } from "./ui";

export function OverridePanel({ s, profile }: { s: Student; profile?: Profile }) {
  const { t, pick } = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [level, setLevel] = useState(2);
  const [reason, setReason] = useState("");
  const units = Object.values(profile?.units ?? {}).filter((u) => u.n > 0).sort((a, b) => b.level - a.level).slice(0, 12);
  if (!units.length) return null;
  const name = (id: string) => pick(kb.graph?.subskills[id]?.name ?? kb.skills[id]?.name ?? { en: id });

  const save = async (unit: string, from: number) => {
    await recordEvent({ student_id: s.id, kind: "rating", rater_id: await raterId(), subskill_id: kb.graph?.subskills[unit] ? unit : undefined,
      skill_id: kb.graph?.subskills[unit] ? kb.graph.subskills[unit].skill : unit, payload: { level, override: true, reason: reason.trim() } });
    emit({ step: "skills", source: "RULE", ref: "rule.override", title: `Teacher override: ${name(unit)} ${from} → ${level}`, subject: `skill:${unit}`,
      output: `level ${level}`, why: [`computed level ${from}, teacher set ${level}`, `reason: "${reason.trim()}"`,
        level > from ? "raised → shown to her, but not proof for payouts (rule.paycheck)" : "lowered → applies fully"] });
    setOpen(null); setReason("");
  };

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-muted"><Icon name="pencil" className="size-4" />{t("levelsWithOverride")}</p>
      <ul className="flex flex-col gap-2">
        {units.map((u) => {
          const ov = (u as typeof u & { override?: { from: number; to: number; reason: string; up: boolean } }).override;
          return (
            <li key={u.id} className="rounded-xl border border-line p-2.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{name(u.id)}</span>
                <Pill tone={u.strong ? "good" : "neutral"}>L{u.level}</Pill>
                {ov && <Pill tone="sun">{t("overridden", { from: ov.from })}</Pill>}
                <button onClick={() => { setOpen(open === u.id ? null : u.id); setLevel(u.level); }} className="rounded-lg bg-brand-soft px-2 py-1 text-xs font-bold text-brand">{t("change")}</button>
              </div>
              {ov && <p className="mt-1 text-xs text-muted">“{ov.reason}”</p>}
              {open === u.id && (
                <div className="mt-2 flex flex-col gap-2">
                  <div className="flex gap-1.5">
                    {[1, 2, 3, 4].map((l) => <button key={l} onClick={() => setLevel(l)} className={`size-10 rounded-lg border font-bold ${level === l ? "border-brand bg-brand text-white" : "border-line"}`}>{l}</button>)}
                  </div>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("overrideReason")} className="min-h-11 rounded-lg border border-line px-3 text-sm" />
                  {level > u.level && <p className="text-xs text-warn">{t("overrideUpNote")}</p>}
                  <Button className="!min-h-11 text-sm" disabled={reason.trim().length < OVERRIDE_RULE.minReasonChars || level === u.level}
                    onClick={() => void save(u.id, ov?.from ?? u.level)}>{t("saveOverride")}</Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function DocsPanel({ s }: { s: Student }) {
  const { t } = useT();
  const [docs, setDocs] = useState<Record<string, DocRow>>({});
  const [income, setIncome] = useState("");
  useEffect(() => { void fetchDocs(s.id).then(setDocs); }, [s.id]);
  const rows = Object.values(docs);
  if (!rows.length) return null;
  const decide = async (kind: DocKind, ok: boolean) => {
    const r = await verifyDoc(s.id, kind, ok, kind === "income_certificate" && income ? Number(income) : undefined);
    if (!("error" in (r as object))) setDocs(await fetchDocs(s.id));
  };
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-muted"><Icon name="clipboard" className="size-4" />{t("documents")}</p>
      <ul className="flex flex-col gap-2">
        {rows.map((d) => (
          <li key={d.kind} className="rounded-xl border border-line p-2.5 text-sm">
            <div className="flex items-center gap-2">
              <span className="flex-1 font-medium">{t(`doc_${d.kind}` as StringKey)}</span>
              <Pill tone={d.status === "verified" ? "good" : d.status === "rejected" ? "bad" : "sun"}>{t(`docStatus_${d.status}` as StringKey)}</Pill>
            </div>
            {d.ai_note?.model && <p className="mt-1 text-xs text-muted"><Icon name="bot" className="inline size-3.5" /> {d.ai_note.kind_matches ? "✓" : "✗"} {t("aiKind")} · {d.ai_note.name_matches ? "✓" : "✗"} {t("aiName")}{d.ai_note.income_inr_read ? ` · ₹${d.ai_note.income_inr_read.toLocaleString("en-IN")}` : ""}</p>}
            {d.status === "uploaded" && (
              <>
                {d.kind === "income_certificate" && (
                  <input value={income} onChange={(e) => setIncome(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder={t("incomeOnCert")}
                    className="mt-2 min-h-10 w-full rounded-lg border border-line px-3" />
                )}
                <p className="mt-1 text-xs text-muted">{t("verifyHint")}</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button onClick={() => void decide(d.kind, true)} className="min-h-10 rounded-lg bg-good-soft font-bold text-good">✓ {t("verifiedSawOriginal")}</button>
                  <button onClick={() => void decide(d.kind, false)} className="min-h-10 rounded-lg bg-bad-soft font-bold text-bad">✗ {t("reject")}</button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SuggestPanel({ s, a }: { s: Student; a: Analysis }) {
  const { t, pick } = useT();
  const [open, setOpen] = useState(false);
  const [pickId, setPickId] = useState("");
  const [note, setNote] = useState("");
  const opts = [
    ...a.opportunities.filter((x) => x.r.status !== "later").slice(0, 15).map((x) => ({ key: `opp:${x.opp.id}`, label: `💼 ${pick(x.opp.title)} · ${t(`opp_${x.r.status}`)}` })),
    ...a.schemes.filter((x) => x.status !== "not_eligible").slice(0, 15).map((x) => ({ key: `sch:${x.scheme_id}`, label: `💰 ${pick(x.name)}` })),
  ];
  const send = async () => {
    const [kind, id] = [pickId.slice(0, 3), pickId.slice(4)];
    await addAction({ student_id: s.id, kind: "recommend", by: "teacher",
      payload: { ...(kind === "opp" ? { opportunity_id: id } : { scheme_id: id }), note: note.trim() || undefined } });
    setOpen(false); setPickId(""); setNote("");
  };
  if (!open) return <Button kind="soft" className="!min-h-12 text-sm" onClick={() => setOpen(true)}><Icon name="star" className="size-4" />{t("suggestToHer")}</Button>;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-sun/40 bg-sun-soft p-3">
      <select value={pickId} onChange={(e) => setPickId(e.target.value)} className="min-h-11 rounded-lg border border-line bg-surface px-2 text-sm">
        <option value="">{t("chooseSuggestion")}</option>
        {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("noteForHer")} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm" />
      <Button className="!min-h-11 text-sm" disabled={!pickId} onClick={() => void send()}><Icon name="send" className="size-4" />{t("send")}</Button>
    </div>
  );
}
