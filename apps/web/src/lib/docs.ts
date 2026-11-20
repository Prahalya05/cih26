// Documents for applications and donor checks. The phone keeps the photo; the server keeps only each document's
// status (uploaded → verified/rejected by a teacher) and the AI's first-look note. rule.apply_docs reads the status.

import { DOC_KINDS, type DocKind, type DocStatus } from "@disha/engine";
import { call, isError } from "./auth";
import { apiFetch } from "./api";
import { compressImage } from "./samples";

export { DOC_KINDS };
export interface DocRow { kind: DocKind; status: DocStatus; ai_note?: { kind?: string; kind_matches?: boolean; name_matches?: boolean; readable?: boolean; note?: string; model?: string | null; income_inr_read?: number } | null; income_inr?: number | null; checked_at?: string | null }

const cacheKey = (id: string) => `disha.docs.${id}`;

export function cachedDocs(studentId: string): Record<string, DocRow> {
  try { return JSON.parse(localStorage.getItem(cacheKey(studentId)) ?? "{}"); } catch { return {}; }
}

export async function fetchDocs(studentId: string): Promise<Record<string, DocRow>> {
  const r = await call<{ docs: DocRow[] }>(`/v2/docs/${encodeURIComponent(studentId)}`);
  if (isError(r)) return cachedDocs(studentId);
  const out = Object.fromEntries(r.docs.map((d) => [d.kind, d]));
  try { localStorage.setItem(cacheKey(studentId), JSON.stringify(out)); } catch { /* full */ }
  return out;
}

export async function uploadDoc(studentId: string, kind: DocKind, file: File): Promise<DocRow | { error: string }> {
  const form = new FormData();
  form.append("student_id", studentId);
  form.append("kind", kind);
  const blob = file.type === "application/pdf" ? file : await compressImage(file);
  form.append("image", blob, file.type === "application/pdf" ? "doc.pdf" : "doc.jpg");
  try {
    const res = await apiFetch("/v2/docs/check", { method: "POST", body: form });
    if (!res.ok) return { error: (await res.json().catch(() => ({}))).detail ?? `Error ${res.status}` };
    return (await res.json()) as DocRow;
  } catch { return { error: "No internet" }; }
}

export async function verifyDoc(studentId: string, kind: DocKind, ok: boolean, income_inr?: number) {
  return call("/v2/docs/verify", { method: "POST", body: JSON.stringify({ student_id: studentId, kind, ok, income_inr }) });
}

export const statusOf = (docs: Record<string, DocRow>): Partial<Record<DocKind, DocStatus>> =>
  Object.fromEntries(Object.values(docs).map((d) => [d.kind, d.status]));
