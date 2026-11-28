// The decision X-ray store: every decision the app makes (RULE, AI, or AI checked by a rule), in order.
// Screens call emit(); the X-ray panel and the "Why?" sheets read from here. Nothing here changes a result.
//
// Turn the panel on with ?xray=1 (or a long press on the Disha logo). ?xray=replay opens a saved session.
// The last 200 decisions are kept in this browser's localStorage so a refresh doesn't lose the demo.

import { decisionId, type Decision } from "@disha/engine";
import { useEffect, useState } from "react";

const KEY = "disha.xray";
const ON_KEY = "disha.xray.on";
const MAX = 200;

const sigOf = (d: Pick<Decision, "output" | "why">) => `${d.output}|${d.why.join("|")}`;
let list: Decision[] = load();
// dedupe key -> last result, so re-renders (and page reloads) don't record the same decision again
const seen = new Map<string, string>(list.filter((d) => d.key).map((d) => [d.key!, sigOf(d)]));
const listeners = new Set<() => void>();

function load(): Decision[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Decision[]; } catch { return []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch { /* private mode */ }
}
const notify = () => listeners.forEach((f) => f());

/** Adds a decision. With a dedupe key, the same decision with the same output is recorded only once. */
export function emit(d: Omit<Decision, "id" | "at"> & Partial<Pick<Decision, "id" | "at">>, dedupe?: string) {
  if (dedupe) {
    const sig = sigOf(d);
    if (seen.get(dedupe) === sig) return;
    seen.set(dedupe, sig);
  }
  list = [...list, { ...d, id: d.id ?? decisionId(), at: d.at ?? Date.now(), ...(dedupe ? { key: dedupe } : {}) }].slice(-MAX);
  save();
  notify();
}

export function clearDecisions() {
  list = [];
  seen.clear();
  save();
  notify();
}

export function replaceDecisions(next: Decision[]) {
  list = next.slice(-MAX);
  seen.clear();
  for (const d of list) if (d.key) seen.set(d.key, sigOf(d));
  save();
  notify();
}

export const allDecisions = () => list;

export function useDecisions(): Decision[] {
  const [, set] = useState(0);
  useEffect(() => {
    const f = () => set((n) => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  return list;
}

/** Decisions about one thing (e.g. "career:occ_electrician"), oldest first. */
export const decisionsFor = (subject: string, from: Decision[] = list) => from.filter((d) => d.subject === subject);

export function summary(from: Decision[] = list) {
  const rule = from.filter((d) => d.source === "RULE").length;
  const ai = from.filter((d) => d.source !== "RULE").length;
  const checked = from.filter((d) => d.source === "AI_CHECKED").length;
  const dropped = from.reduce((s, d) => s + (d.ai?.dropped?.length ?? 0), 0);
  const fallbacks = from.filter((d) => d.ai?.fallback).length;
  return { total: from.length, rule, ai, checked, dropped, fallbacks };
}

// ---------- panel on/off ----------

const params = () => new URLSearchParams(location.search);
export const xrayReplay = () => params().get("xray") === "replay";

export function xrayInitiallyOn(): boolean {
  const p = params().get("xray");
  if (p === "0") { try { localStorage.removeItem(ON_KEY); } catch { /* ignore */ } return false; }
  if (p) { try { localStorage.setItem(ON_KEY, "1"); } catch { /* ignore */ } return true; }
  try { return localStorage.getItem(ON_KEY) === "1"; } catch { return false; }
}

/** Whether X-ray (demo) mode is on right now, without changing it. */
export function xrayIsOn(): boolean {
  try { return localStorage.getItem(ON_KEY) === "1"; } catch { return false; }
}

export function setXrayOn(on: boolean) {
  try { if (on) localStorage.setItem(ON_KEY, "1"); else localStorage.removeItem(ON_KEY); } catch { /* ignore */ }
}

/** Downloads the session as JSON (for replay without internet). */
export function exportSession() {
  const blob = new Blob([JSON.stringify({ app: "disha", kind: "xray-session", at: Date.now(), decisions: list }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `disha-xray-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importSession(file: File): Promise<Decision[]> {
  const data = JSON.parse(await file.text()) as { decisions?: Decision[] };
  if (!Array.isArray(data.decisions)) throw new Error("Not a Disha X-ray session file");
  return data.decisions;
}
