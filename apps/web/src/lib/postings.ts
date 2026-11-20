// Jobs posted by teachers (her school) and employers (everyone), fetched from the server and kept for offline use.
// They join the bundled opportunities, so the same readiness rule sorts them.

import type { Opportunity } from "@disha/engine";
import { apiFetch } from "./api";

const KEY = "disha.postings";

function load(): Opportunity[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Opportunity[]; } catch { return []; }
}

/** Posted jobs known to this phone (updated in place by refreshPostings). */
export const POSTED: Opportunity[] = load();

export async function refreshPostings(): Promise<void> {
  try {
    const res = await apiFetch("/v2/postings");
    if (!res.ok) return;
    const list = ((await res.json()).postings as { opportunity: Opportunity }[]).map((p) => p.opportunity);
    POSTED.splice(0, POSTED.length, ...list);
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* full */ }
    window.dispatchEvent(new Event("disha:postings"));
  } catch { /* offline */ }
}
