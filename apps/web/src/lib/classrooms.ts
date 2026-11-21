// Online classrooms: teachers make them, students ask to join, the teacher decides (server: routers/classrooms.py).

import { call, currentAccount, isError, saveAccount, type Account } from "./auth";
import { patchStudent } from "./db";

export interface Classroom {
  code: string; name: string; about: string | null; language: string | null; state: string | null; district: string | null;
  min_age: number | null; max_age: number | null; seats: number; seats_left: number; members: number; open: boolean;
  teacher: string | null; school: string | null; online: boolean; waiting?: number; near?: number;
}
export interface RoomDraft {
  name: string; about?: string; language?: string; state?: string; district?: string;
  min_age?: number; max_age?: number; seats: number; open: boolean;
}
export interface JoinRequest {
  id: string; status: "pending" | "approved" | "declined" | "cancelled" | "left"; created_at: string;
  code: string; name: string; teacher: string;
}
export interface IncomingRequest {
  id: string; name: string; age: number; state: string | null; district: string | null; note: string | null;
  status: "pending" | "approved"; created_at: string;
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const makeClassroom = (d: RoomDraft) =>
  call<{ classroom: Classroom; account: Account }>("/v2/classrooms", { method: "POST", ...json(d) });
export const editClassroom = (code: string, d: RoomDraft) =>
  call<{ classroom: Classroom }>(`/v2/classrooms/${encodeURIComponent(code)}`, { method: "PATCH", ...json(d) });
export const myClassrooms = () => call<{ classrooms: Classroom[]; verification: CheckState }>("/v2/classrooms/mine");
export const roomRequests = (code: string) => call<{ requests: IncomingRequest[] }>(`/v2/classrooms/${encodeURIComponent(code)}/requests`);
export const decide = (id: string, approve: boolean) =>
  call<{ status: string; reason?: string }>(`/v2/classrooms/requests/${encodeURIComponent(id)}/decide`, { method: "POST", ...json({ approve }) });

export function searchClassrooms(f: { age?: number; state?: string; district?: string; language?: string; q?: string }) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== "") p.set(k, String(v));
  return call<{ classrooms: Classroom[] }>(`/v2/classrooms?${p}`);
}
export const askToJoin = (code: string, b: { age: number; state?: string; district?: string; note?: string }) =>
  call<{ id: string; status: string }>(`/v2/classrooms/${encodeURIComponent(code)}/join`, { method: "POST", ...json(b) });
export const cancelRequest = (id: string) => call<{ status: string }>(`/v2/classrooms/requests/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Her requests; when the server says she is now in a class, the phone files her under that class too. */
export async function myRequests(): Promise<{ requests: JoinRequest[]; account: Account } | { error: string }> {
  const r = await call<{ requests: JoinRequest[]; account: Account }>("/v2/classrooms/requests/mine");
  if (isError(r)) return r;
  await fileUnderClass(r.account);
  return r;
}

export async function leaveClassroom(): Promise<Account | { error: string }> {
  const r = await call<{ account: Account }>("/v2/classrooms/leave", { method: "POST" });
  if (isError(r)) return r;
  await fileUnderClass(r.account);
  return r.account;
}

/** Saves the account and puts her profile on this phone in its class (or out of it), so the next sync goes there. */
export async function fileUnderClass(account: Account) {
  const before = await currentAccount();
  if (before?.school_id === account.school_id && before?.class_code === account.class_code) return; // nothing changed
  await saveAccount(account);
  const code = account.class_code ?? "";
  try { if (code) localStorage.setItem("disha.code", code); else localStorage.removeItem("disha.code"); } catch { /* private mode */ }
  if (account.role === "student" && account.student_id) {
    await patchStudent(account.student_id, (s) => ({ ...s, facilitator_code: code || undefined }));
  }
}

// ---------- teacher check (a Disha reviewer looks at one teaching proof) ----------

export type CheckStatus = "by_school" | "approved" | "pending" | "rejected" | "none";
export interface CheckState { status: CheckStatus; reason: string | null; doc_kind: string | null }
export const DOC_KINDS = ["school_id", "tet", "bed", "appointment", "other"] as const;
export const isChecked = (s?: CheckState | null) => s?.status === "by_school" || s?.status === "approved";

export const myCheck = () => call<CheckState>("/v2/classrooms/verification");

/** Shrinks the photo on the phone (longest side 1600 px, JPEG) so it uploads quickly and stays under the limit. */
export async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file; // the server still checks type and size
  }
}

export async function sendProof(kind: string, note: string, file: File) {
  const form = new FormData();
  form.set("kind", kind);
  if (note.trim()) form.set("note", note.trim());
  form.set("photo", await shrinkPhoto(file), "proof.jpg");
  return call<CheckState>("/v2/classrooms/verification", { method: "POST", body: form });
}
