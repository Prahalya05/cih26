// Schemes are fetched from the server (GET /v1/schemes), not only taken from the copy bundled in the app.
//
// Start-up order: the last list fetched (saved in this browser) is used straight away, else the bundled copy.
// Then, when online, the server's current list is fetched (ETag, so an unchanged list costs almost nothing)
// and the app re-checks eligibility with it. Eligibility itself is still the same json-logic rules, run on the phone.

import type { Rule, Scheme } from "@disha/engine";
import { useEffect, useState } from "react";
import { API } from "./api";
import { kb } from "./kb";
import { emit } from "./xray";

const KEY = "disha.schemes";
const REFRESH_MS = 10 * 60_000;

export interface CatalogInfo {
  source: "bundled" | "server" | "saved";
  version?: string;
  updated_at?: string | null;
  fetched_at?: number;
  count: number;
}

interface Saved { version: string; updated_at?: string | null; fetched_at: number; schemes: Scheme[]; rules: Rule[] }

const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x])) as Record<string, T>;
const bundledRules = { ...kb.rules };
let info: CatalogInfo = { source: "bundled", count: Object.keys(kb.schemes).length };
const listeners = new Set<() => void>();

function apply(c: Saved, source: CatalogInfo["source"]) {
  // Rules for things that are not schemes (e.g. opportunity rules) stay from the bundle.
  kb.schemes = byId(c.schemes);
  kb.rules = { ...bundledRules, ...byId(c.rules) };
  info = { source, version: c.version, updated_at: c.updated_at, fetched_at: c.fetched_at, count: c.schemes.length };
  listeners.forEach((f) => f());
}

function valid(c: unknown): c is Saved {
  const x = c as Saved;
  return !!x && typeof x.version === "string" && Array.isArray(x.schemes) && Array.isArray(x.rules) && x.schemes.length > 0;
}

try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
  if (valid(saved)) apply(saved, "saved");
} catch { /* private mode or broken copy: the bundled list is used */ }

let inflight: Promise<void> | null = null;

/** Fetches the current scheme list. Safe to call often: one request at a time, and at most every 10 minutes. */
export function refreshSchemes(force = false): Promise<void> {
  if (!navigator.onLine) return Promise.resolve();
  if (!force && info.source === "server" && info.fetched_at && Date.now() - info.fetched_at < REFRESH_MS) return Promise.resolve();
  inflight ??= (async () => {
    try {
      const headers: Record<string, string> = info.version ? { "If-None-Match": `"${info.version}"` } : {};
      const res = await fetch(`${API}/v1/schemes`, { headers });
      if (res.status === 304 && info.version) {
        info = { ...info, source: "server", fetched_at: Date.now() };
        listeners.forEach((f) => f());
        return;
      }
      if (!res.ok) return;
      const body = await res.json();
      if (!valid(body)) return;
      const before = info.version;
      const c: Saved = { version: body.version, updated_at: body.updated_at, fetched_at: Date.now(), schemes: body.schemes, rules: body.rules };
      apply(c, "server");
      try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage full or private mode */ }
      if (before !== c.version) {
        emit({ step: "schemes", source: "RULE", ref: "data.scheme_catalog", title: `Scheme list fetched from the server: ${c.schemes.length} schemes`,
          output: `version ${c.version}`, why: [`server list ${c.version}${before ? ` replaces ${before}` : " replaces the bundled copy"}`,
            "eligibility is re-checked on the phone with the same json-logic rules"] }, "scheme_catalog");
      }
    } catch { /* offline or server down: keep what we have */ } finally { inflight = null; }
  })();
  return inflight;
}

export const schemeCatalog = () => info;

/** Re-renders when a new scheme list arrives; the returned version can be used as a memo dependency. */
export function useSchemeCatalog(): CatalogInfo {
  const [, set] = useState(0);
  useEffect(() => {
    const f = () => set((n) => n + 1);
    listeners.add(f);
    void refreshSchemes();
    return () => { listeners.delete(f); };
  }, []);
  return info;
}
