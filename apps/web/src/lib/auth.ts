// Sign-in: phone number or email + a one-time code. The server gives back a device token (the same kind a class code
// gives), so every other call keeps working. The session (who is signed in) is kept on the phone so the app opens
// offline; signing out clears it and kills the token on the server.

import { useEffect, useState } from "react";
import { API, apiFetch } from "./api";
import { db } from "./db";
import { deviceId } from "./events";

export type AccountRole = "student" | "teacher" | "funder" | "employer";

export interface Account {
  id: string;
  role: AccountRole;
  name: string;
  org?: string | null;
  login: string; // masked: 98•••••210
  school_id?: string | null;
  class_code?: string | null;
  student_id?: string | null;
}

const SESSION = "session";
const TOKEN = "device_token";
const ROLE = "device_role";
const EVENT = "disha:session";

export interface OtpSent { sent_to: string; kind: "phone" | "email"; new_account: boolean; delivery: "email" | "demo"; minutes: number; demo_code?: string }

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

export interface NewAccount { role: AccountRole; name: string; org?: string; join_code?: string; privacy_ok: boolean }

export async function verifyOtp(login: string, code: string, extra?: NewAccount): Promise<Account | { error: string }> {
  try {
    const res = await fetch(`${API}/v2/auth/verify`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login, code, device_id: await deviceId(), ...(extra ?? {}) }),
    });
    if (!res.ok) return { error: await errorOf(res) };
    const out = (await res.json()) as { token: string; account: Account };
    await db.meta.put({ key: TOKEN, value: out.token });
    await db.meta.put({ key: ROLE, value: out.account.role });
    await db.meta.put({ key: SESSION, value: out.account });
    if (out.account.class_code) { try { localStorage.setItem("disha.code", out.account.class_code); } catch { /* private mode */ } }
    window.dispatchEvent(new Event(EVENT));
    return out.account;
  } catch { return { error: "No internet. Sign-in needs the internet once." }; }
}

export async function currentAccount(): Promise<Account | null> {
  return ((await db.meta.get(SESSION))?.value as Account | undefined) ?? null;
}

export async function saveAccount(a: Account) {
  await db.meta.put({ key: SESSION, value: a });
  window.dispatchEvent(new Event(EVENT));
}

export async function signOut() {
  try { await apiFetch("/v2/auth/logout", { method: "POST" }); } catch { /* offline: the token is forgotten anyway */ }
  await db.meta.delete(SESSION);
  await db.meta.delete(TOKEN);
  await db.meta.delete(ROLE);
  try { localStorage.removeItem("disha.join"); } catch { /* ignore */ }
  window.dispatchEvent(new Event(EVENT));
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
    await db.meta.delete(SESSION);
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
