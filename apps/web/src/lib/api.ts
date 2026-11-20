// Where the Disha API is, and this phone's registration with it.
//
// A phone registers once with a join code (the class code, or a teacher's secret code) and keeps the device
// token it gets back. Every call that touches student data sends that token; the server then only lets the
// phone see its own school. Nothing here is needed offline.

import { db } from "./db";
import { deviceId } from "./events";

export const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

const TOKEN = "device_token";
const ROLE = "device_role";
const JOIN_KEY = "disha.join"; // the code this phone registered with (a teacher code is not the class code)
const CLASS_KEY = "disha.code"; // the class code students are filed under

const read = (k: string) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export type Role = "student" | "teacher" | "funder" | "employer";
export interface Registration { role: Role; class_code: string }

/** Registers this phone with a join code. Returns null if offline, the code is unknown, or the server says no. */
export async function register(code: string): Promise<Registration | null> {
  try {
    const res = await fetch(`${API}/v2/devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: await deviceId(), code: code.trim().toUpperCase() }),
    });
    if (!res.ok) return null;
    const out = (await res.json()) as { token: string } & Registration;
    await db.meta.put({ key: TOKEN, value: out.token });
    await db.meta.put({ key: ROLE, value: out.role });
    write(JOIN_KEY, code.trim().toUpperCase());
    return { role: out.role, class_code: out.class_code };
  } catch {
    return null;
  }
}

/** "teacher" or "student" once registered; null before. */
export async function deviceRole(): Promise<Role | null> {
  return ((await db.meta.get(ROLE))?.value as Role | undefined) ?? null;
}

async function token(): Promise<string | null> {
  const saved = (await db.meta.get(TOKEN))?.value;
  if (typeof saved === "string" && saved) return saved;
  const code = read(JOIN_KEY) || read(CLASS_KEY);
  if (!code || !(await register(code))) return null;
  return ((await db.meta.get(TOKEN))?.value as string | undefined) ?? null;
}

/**
 * fetch() to the API with this phone's token. A phone that is not registered yet registers with its saved code
 * first; if the server no longer accepts the token, it registers again once and retries.
 * Throws only when the network fails, like fetch().
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = async (tok: string) =>
    fetch(`${API}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${tok}` } });
  let tok = await token();
  if (!tok) return new Response(null, { status: 401 });
  let res = await send(tok);
  if (res.status === 401 && (await db.meta.get("session"))) {
    // A signed-in account whose token stopped working (signed out elsewhere, or switched off): sign in again.
    await db.meta.delete("session");
    await db.meta.delete(TOKEN);
    window.dispatchEvent(new Event("disha:session"));
    return res;
  }
  if (res.status === 401) {
    await db.meta.delete(TOKEN);
    tok = await token();
    if (tok) res = await send(tok);
  }
  return res;
}
