// Sign-in: phone number or email + a one-time code. The server gives back a device token (the same kind a class code
// gives), so every other call keeps working. The session (who is signed in) is kept on the phone so the app opens
// offline; signing out clears it and kills the token on the server.

import { useEffect, useState } from "react";
import { API, apiFetch } from "./api";
import { db, type Action, type StoredEvent, type Student } from "./db";
import { deviceId } from "./events";
import { clearPostings } from "./postings";
import { refreshSkillState } from "./skills";

export type AccountRole = "student" | "teacher" | "funder" | "employer";

export interface Account {
  id: string;
  role: AccountRole;
  name: string;
  org?: string | null;
  login: string; // masked: 98•••••210
  school_id?: string | null;
  school_kind?: "school" | "online" | null;
  school_name?: string | null;
  class_code?: string | null;
  student_id?: string | null;
  /** all her profiles (up to 3, server setting STUDENT_PROFILES_MAX); student_id is the first */
  student_ids?: string[];
  student_profiles_max?: number;
}

/** A student account's profiles: the list from the server, or the single id from an older server. */
export const profileIds = (a: Account): string[] => a.student_ids?.length ? a.student_ids : a.student_id ? [a.student_id] : [];

const SESSION = "session";
const TOKEN = "device_token";
const ROLE = "device_role";
const LAST_ACCOUNT = "last_account_id";
const EVENT = "disha:session";

export interface OtpSent { sent_to: string; kind: "phone" | "email"; new_account: boolean; delivery: "email" | "demo"; minutes: number; demo_code?: string }

/** Wipes all user-scoped records from IndexedDB and localStorage so accounts never leak data on shared phones. */
export async function clearLocalUserData(): Promise<void> {
  await db.transaction("rw", [db.students, db.actions, db.events, db.skillState, db.media, db.meta], async () => {
    await db.students.clear();
    await db.actions.clear();
    await db.events.clear();
    await db.skillState.clear();
    await db.media.clear();
    await db.meta.bulkDelete([SESSION, TOKEN, ROLE, LAST_ACCOUNT, "event_cursor", "pending_erasures"]);
  });
  try {
    localStorage.removeItem("disha.code");
    localStorage.removeItem("disha.join");
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("disha.docs.") || k.startsWith("disha.story."))) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
  clearPostings();
}

async function hydrateMyProfile(studentId: string): Promise<void> {
  if (await db.students.get(studentId)) return;
  const r = await call<{ student: Student | null; actions: Omit<Action, "synced">[]; events: StoredEvent[] }>(
    `/v2/auth/me/profile?student_id=${encodeURIComponent(studentId)}`);
  if (isError(r) || !r.student) return;
  await db.transaction("rw", db.students, db.actions, db.events, async () => {
    await db.students.put({ ...r.student!, synced_at: r.student!.updated_at });
    for (const a of r.actions) await db.actions.put({ ...a, synced: 1 });
    for (const e of r.events) await db.events.put({ ...e, synced: 1 });
  });
  await refreshSkillState(studentId);
}

async function errorOf(res: Response): Promise<string> {
  try {
    const d = (await res.json()).detail;
    return typeof d === "string" ? d : d?.message ?? "Something went wrong";
  } catch { return "Something went wrong"; }
}

export async function requestOtp(login: string): Promise<OtpSent | { error: string }> {
  try {
    const res = await fetch(`${API}/v2/auth/otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login }) });
    return res.ok ? await res.json() : { error: await errorOf(res) };
  } catch { return { error: "No internet. Sign-in needs the internet once." }; }
}

export interface NewAccount { role: AccountRole; mode?: "school" | "online"; name: string; org?: string; join_code?: string; privacy_ok: boolean }

export async function verifyOtp(login: string, code: string, extra?: NewAccount): Promise<Account | { error: string }> {
  try {
    const res = await fetch(`${API}/v2/auth/verify`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login, code, device_id: await deviceId(), ...(extra ?? {}) }),
    });
    if (!res.ok) return { error: await errorOf(res) };
    const out = (await res.json()) as { token: string; account: Account };
    const prevId = (await db.meta.get(LAST_ACCOUNT))?.value as string | undefined;
    if (prevId && prevId !== out.account.id) await clearLocalUserData();
    await db.meta.put({ key: TOKEN, value: out.token });
    await db.meta.put({ key: ROLE, value: out.account.role });
    await db.meta.put({ key: SESSION, value: out.account });
    await db.meta.put({ key: LAST_ACCOUNT, value: out.account.id });
    try {
      if (out.account.class_code) localStorage.setItem("disha.code", out.account.class_code);
      else localStorage.removeItem("disha.code");
    } catch { /* private mode */ }
    if (out.account.role === "student") {
      for (const sid of profileIds(out.account)) await hydrateMyProfile(sid).catch(() => undefined);
    }
    window.dispatchEvent(new Event(EVENT));
    return out.account;
  } catch { return { error: "No internet. Sign-in needs the internet once." }; }
}

export async function currentAccount(): Promise<Account | null> {
  return ((await db.meta.get(SESSION))?.value as Account | undefined) ?? null;
}

export async function saveAccount(a: Account) {
  await db.meta.put({ key: SESSION, value: a });
  await db.meta.put({ key: LAST_ACCOUNT, value: a.id });
  window.dispatchEvent(new Event(EVENT));
}

export async function signOut() {
  try { await apiFetch("/v2/auth/logout", { method: "POST" }); } catch { /* offline: the token is forgotten anyway */ }
  await clearLocalUserData();
  window.dispatchEvent(new Event(EVENT));
}

/** Refreshes the signed-in account from the server so approvals (e.g. online classroom join) and school links propagate. */
export async function refreshAccount(): Promise<Account | null> {
  const cur = await currentAccount();
  if (!cur || !navigator.onLine) return cur;
  const fresh = await call<Account>("/v2/auth/me");
  if (isError(fresh)) return cur;
  const changed =
    fresh.school_id !== cur.school_id ||
    fresh.class_code !== cur.class_code ||
    fresh.school_kind !== cur.school_kind ||
    fresh.school_name !== cur.school_name ||
    fresh.student_id !== cur.student_id ||
    profileIds(fresh).join() !== profileIds(cur).join();
  if (changed) {
    await saveAccount(fresh);
    try {
      if (fresh.class_code) localStorage.setItem("disha.code", fresh.class_code);
      else if (fresh.role === "student") localStorage.removeItem("disha.code");
    } catch { /* private mode */ }
    if (fresh.role === "student") {
      for (const sid of profileIds(fresh)) {
        if (await db.students.get(sid)) {
          await db.students.update(sid, { facilitator_code: fresh.class_code ?? undefined, updated_at: Date.now() });
        }
      }
    }
  }
  if (fresh.role === "student") {
    for (const sid of profileIds(fresh)) await hydrateMyProfile(sid).catch(() => undefined);
  }
  return fresh;
}

export async function linkSchoolCode(joinCode: string): Promise<Account | { error: string }> {
  const r = await call<{ account: Account }>("/v2/auth/me/school", { method: "POST", body: JSON.stringify({ join_code: joinCode }) });
  if (isError(r)) return { error: r.error };
  await saveAccount(r.account);
  if (r.account.class_code) {
    try { localStorage.setItem("disha.code", r.account.class_code); } catch { /* private mode */ }
  }
  return r.account;
}

/** The signed-in account, or null; undefined while loading. Updates on sign-in and sign-out. */
export function useAccount(): Account | null | undefined {
  const [acc, setAcc] = useState<Account | null | undefined>(undefined);
  useEffect(() => {
    const load = () => void currentAccount().then(setAcc);
    load();
    window.addEventListener(EVENT, load);
    return () => window.removeEventListener(EVENT, load);
  }, []);
  return acc;
}

/** Called when the server says the token is no longer valid for a signed-in account. */
export async function sessionExpired() {
  if (await currentAccount()) {
    await db.meta.bulkDelete([SESSION, TOKEN, ROLE]);
    window.dispatchEvent(new Event(EVENT));
  }
}

/** JSON helper for signed-in calls: returns the parsed body, or {error}. */
export async function call<T>(path: string, init: RequestInit = {}): Promise<T | { error: string; status: number; detail?: unknown }> {
  try {
    const res = await apiFetch(path, { ...init, headers: { ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...(init.headers as Record<string, string>) } });
    if (res.ok) return (await res.json()) as T;
    let detail: unknown;
    try { detail = (await res.json()).detail; } catch { /* no body */ }
    const msg = typeof detail === "string" ? detail : (detail as { message?: string })?.message ?? `Error ${res.status}`;
    return { error: msg, status: res.status, detail };
  } catch {
    return { error: "No internet", status: 0 };
  }
}

export const isError = (x: unknown): x is { error: string; status: number; detail?: unknown } => !!x && typeof x === "object" && "error" in x;
