// Teacher courses on the phone: catalogue, lessons, payments (Razorpay test mode or a labelled demo), quizzes.
// The server decides which lessons are open and marks quizzes (rule.course_access); a pass is recorded here as a
// "task" evidence event for her skill level, closing the learn → prove loop.

import { call, isError } from "./auth";
import { recordEvent } from "./events";
import { emit } from "./xray";

export type Plan = "free" | "per_module" | "subscription";
export interface CourseRow { id: string; school_id?: string | null; title: string; description?: string; language: string; skill_id: string; plan: Plan; price_inr: number; period_days: number;
  teacher_id: string; teacher_name: string; modules: number; subscribed?: boolean; lessons_bought?: number; passed?: number }
export interface Lesson { id: string; position: number; title: string; open: boolean; why: string; subskill_id?: string; quiz_count: number; passed: boolean; score?: number;
  body?: string; video_url?: string; quiz?: { q: string; options: string[] }[]; answers?: number[] }
export interface CourseDetail { course: CourseRow & { published: boolean; school_id?: string | null }; lessons: Lesson[]; subscription_until: string | null;
  payments: "razorpay" | "demo" | "off"; razorpay_key: string | null }

export const listCourses = () => call<{ courses: CourseRow[]; payments: string }>("/v2/courses");
export const getCourse = (id: string) => call<CourseDetail>(`/v2/courses/${encodeURIComponent(id)}`);

type RazorpayHandlerResp = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
declare global { interface Window { Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (e: string, f: () => void) => void } } }

function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

/** Pays for a lesson (per_module) or a subscription. Resolves "paid", "cancelled" or an error message. */
export async function pay(courseId: string, moduleId: string | undefined, confirmDemo: (amount: number) => Promise<boolean>): Promise<"paid" | "cancelled" | string> {
  const out = await call<{ purchase_id: string; provider: "razorpay" | "demo"; amount_inr: number; order_id?: string; key_id?: string; course_title: string }>(
    `/v2/courses/${encodeURIComponent(courseId)}/checkout`, { method: "POST", body: JSON.stringify({ module_id: moduleId ?? null }) });
  if (isError(out)) return out.error;
  const done = (how: string) => emit({ step: "payouts", source: "RULE", ref: "guard.payment_signature", title: `Course payment ₹${out.amount_inr}: ${how}`,
    subject: `course:${courseId}`, output: how, why: [`price set by the server: ₹${out.amount_inr}`, out.provider === "razorpay"
      ? "Razorpay test mode; the server checked HMAC-SHA256(order_id|payment_id) before unlocking" : "demo payment: no money moved (no Razorpay keys on this server)", "→ rule.course_access re-checked: lesson(s) open"] });
  if (out.provider === "demo") {
    if (!(await confirmDemo(out.amount_inr))) return "cancelled";
    const r = await call(`/v2/payments/${out.purchase_id}/demo-pay`, { method: "POST" });
    if (isError(r)) return r.error;
    done("paid (demo)");
    return "paid";
  }
  if (!(await loadRazorpay()) || !window.Razorpay) return "Could not load Razorpay. Check the internet.";
  return await new Promise((resolve) => {
    const rz = new window.Razorpay!({
      key: out.key_id, order_id: out.order_id, amount: out.amount_inr * 100, currency: "INR", name: "Disha", description: out.course_title,
      handler: async (resp: RazorpayHandlerResp) => {
        const v = await call("/v2/payments/verify", { method: "POST", body: JSON.stringify({ purchase_id: out.purchase_id, ...resp }) });
        if (isError(v)) resolve(v.error); else { done("paid (Razorpay test mode)"); resolve("paid"); }
      },
      modal: { ondismiss: () => resolve("cancelled") },
    });
    rz.open();
  });
}

export interface QuizResult { score: number; right: number; total: number; passed: boolean; pass_mark: number; evidence: { subskill_id: string; score: number } | null; correct: number[] }

/** Sends answers to the server to be marked. A pass becomes a task event for her skill level. */
export async function submitQuiz(moduleId: string, answers: number[], studentId: string | null | undefined, courseId: string): Promise<QuizResult | { error: string }> {
  const r = await call<QuizResult>(`/v2/modules/${encodeURIComponent(moduleId)}/quiz`, { method: "POST", body: JSON.stringify({ answers }) });
  if (isError(r)) return { error: r.error };
  if (r.passed && r.evidence && studentId) {
    await recordEvent({ student_id: studentId, kind: "task", subskill_id: r.evidence.subskill_id, payload: { score: r.evidence.score, source: "course", course_id: courseId, module_id: moduleId } });
  }
  emit({ step: "skills", source: "RULE", ref: "rule.course_access", title: `Lesson quiz: ${r.right}/${r.total} ${r.passed ? "passed" : "not yet"}`, subject: `course:${courseId}`,
    output: r.passed ? "pass → skill evidence" : "not passed", why: [`marked on the server (answers never sent to the phone)`, `score ${Math.round(r.score * 100)}% vs pass mark ${r.pass_mark * 100}%`,
      r.passed ? `→ "task" evidence for ${r.evidence?.subskill_id} (weight 2), her level updates` : "→ no evidence yet; try again"] });
  return r;
}
