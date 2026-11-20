// My documents: take a photo of each document. An AI takes a first look (what kind is it, does the name match); the
// photo is not stored on the server; a teacher who sees the original marks it verified. rule.apply_docs and
// rule.paycheck read only the status. ID numbers are never read out or kept.

import { useEffect, useState } from "react";
import type { Go } from "../App";
import { Card, Pill, Screen } from "../components/ui";
import { Icon } from "../components/Icon";
import { WhyButton } from "../components/WhyFlow";
import { useT, type StringKey } from "../lib/i18n";
import { DOC_KINDS, fetchDocs, uploadDoc, cachedDocs, type DocRow } from "../lib/docs";
import { emit } from "../lib/xray";
import { db, type Student } from "../lib/db";
import { useLive } from "../components/ui";
import type { DocKind } from "@disha/engine";

const SHOWN: DocKind[] = ["id_proof", "marksheet", "income_certificate", "ration_card_bpl", "community_certificate", "bank_passbook", "scholarship_letter", "photo"];

export default function Docs({ go, id }: { go: Go; id: string }) {
  const { t } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined as Student | undefined);
  const [docs, setDocs] = useState<Record<string, DocRow>>(() => cachedDocs(id));
  const [busy, setBusy] = useState<DocKind | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void fetchDocs(id).then(setDocs); }, [id]);

  const upload = async (kind: DocKind, file: File) => {
    setBusy(kind); setError("");
    const r = await uploadDoc(id, kind, file);
    setBusy(null);
    if ("error" in r) { setError(String(r.error)); return; }
    const n = r.ai_note;
    emit({ step: "opportunities", source: n?.model ? "AI_CHECKED" : "RULE", ref: n?.model ? "ai.doc_check" : "rule.apply_docs",
      title: `${kind}: AI first look`, subject: `doc:${kind}`, output: "uploaded → waits for a teacher",
      why: n?.model ? [`AI says kind: ${n.kind} ${n.kind_matches ? "✓" : "✗"}`, `name matches: ${n.name_matches ? "✓" : "✗"}`, `readable: ${n.readable ? "✓" : "✗"}`,
        "rule: ID numbers removed from the AI's note", "rule: the AI never verifies → status 'uploaded' until a teacher sees the original"]
        : ["AI not available → the teacher looks"],
      ai: n?.model ? { model: n.model } : undefined });
    setDocs({ ...docs, [kind]: r });
  };

  return (
    <Screen title={t("myDocs")} onBack={() => go(student ? { name: "results", id, tab: "opps" } : { name: "home" })}>
      <p className="text-muted">{t("docsHint")}</p>
      <p className="flex items-start gap-2 rounded-xl bg-good-soft p-3 text-sm text-good"><Icon name="shield" className="mt-0.5 size-4 shrink-0" />{t("docsPrivacy")}</p>
      {error && <p className="rounded-xl bg-bad-soft p-3 text-sm text-bad">{error}</p>}
      {SHOWN.filter((k) => (DOC_KINDS as readonly string[]).includes(k)).map((kind) => {
        const d = docs[kind];
        const status = d?.status ?? "missing";
        return (
          <Card key={kind}>
            <div className="flex items-center gap-3">
              <span className={`flex size-10 items-center justify-center rounded-full ${status === "verified" ? "bg-good-soft text-good" : status === "uploaded" ? "bg-sun-soft text-warn" : status === "rejected" ? "bg-bad-soft text-bad" : "bg-paper text-muted"}`}>
                <Icon name={status === "verified" ? "check" : status === "uploaded" ? "clock" : status === "rejected" ? "x" : "idcard"} className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-bold">{t(`doc_${kind}` as StringKey)}</p>
                <Pill tone={status === "verified" ? "good" : status === "uploaded" ? "sun" : status === "rejected" ? "bad" : "neutral"}>{t(`docStatus_${status}` as StringKey)}</Pill>
              </div>
              <label className={`inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-sm font-bold ${status === "verified" ? "border border-line" : "bg-brand text-white"}`}>
                <Icon name="camera" className="size-4" />{busy === kind ? "…" : status === "missing" ? t("addPhoto") : t("retake")}
                <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" disabled={!!busy}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(kind, f); e.target.value = ""; }} />
              </label>
            </div>
            {d?.ai_note?.model && status === "uploaded" && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-muted"><Icon name="bot" className="size-3.5 shrink-0" />
                {d.ai_note.kind_matches === false ? t("aiWrongKind") : d.ai_note.name_matches === false ? t("aiNameMismatch") : t("aiLooksOk")} {t("teacherWillCheck")}
              </p>
            )}
            {status === "uploaded" && <div className="mt-1"><WhyButton subject={`doc:${kind}`} title={t(`doc_${kind}` as StringKey)} /></div>}
          </Card>
        );
      })}
    </Screen>
  );
}
