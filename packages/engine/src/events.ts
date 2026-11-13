// Evidence events: the permanent record of everything a student did or someone said about her.
// Events are never edited. Skill levels are always recomputed from them (see skillState.ts).
// Keep in step with apps/api/app/schemas.py (validate_event).

export type EvidenceKind =
  | "self_report"        // she said it (voice, tap or typed)
  | "family_report"      // a parent or friend said it
  | "item_response"      // an answer to a test question
  | "task"               // a simulated task or game score
  | "aptitude_response"  // an answer in an aptitude game
  | "interest_choice"    // a picture-pair or career-card choice
  | "work_sample"        // a photo or video of her work, scored on a checklist
  | "rating"             // a teacher, mentor or buyer rating, or a confirmation of another event
  | "order"              // a paid job she logged
  | "taster";            // a mentor's rating after a career taster

export const EVIDENCE_KINDS: EvidenceKind[] = [
  "self_report", "family_report", "item_response", "task", "aptitude_response",
  "interest_choice", "work_sample", "rating", "order", "taster",
];

export interface EvidenceEvent {
  id: string;            // ULID: sorts by time
  student_id: string;
  device_id: string;
  kind: EvidenceKind;
  skill_id?: string;
  subskill_id?: string;
  item_id?: string;
  payload: Record<string, unknown>;
  rater_id?: string;
  refers_to?: string;    // e.g. a teacher rating that confirms a work sample, or a buyer confirming an order
  created_at: number;    // ms since 1970, phone clock
}

// ---------- ULID (no dependency, works in the browser and Node) ----------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 26-character ULID: 10 characters of time (ms), 16 of randomness. */
export function ulid(now = Date.now(), random: () => number = defaultRandom): string {
  let t = now;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD.charAt(Math.floor(random() * 32));
  return time + rand;
}

function defaultRandom(): number {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  return Math.random();
}

export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

// ---------- validation ----------

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isLevel = (x: unknown) => x === 1 || x === 2 || x === 3 || x === 4;
const isScore = (x: unknown) => x === 0 || x === 1 || x === 2;

/** Returns a list of problems; empty means the event is valid. */
export function validateEvent(e: EvidenceEvent, now = Date.now()): string[] {
  const errs: string[] = [];
  const p = e.payload ?? {};
  if (!ULID_RE.test(e.id ?? "")) errs.push("id must be a ULID");
  if (!e.student_id) errs.push("student_id is required");
  if (!e.device_id) errs.push("device_id is required");
  if (!EVIDENCE_KINDS.includes(e.kind)) errs.push(`unknown kind ${e.kind}`);
  if (!isNum(e.created_at)) errs.push("created_at must be a number");
  else if (e.created_at > now + 24 * 3600 * 1000) errs.push("created_at is in the future");
  const target = e.subskill_id || e.skill_id;

  switch (e.kind) {
    case "self_report":
    case "family_report":
      if (!target) errs.push("needs skill_id or subskill_id");
      if (!["voice", "tap", "text"].includes(String(p.source))) errs.push("payload.source must be voice, tap or text");
      if (p.retracted !== undefined && typeof p.retracted !== "boolean") errs.push("payload.retracted must be true or false");
      break;
    case "item_response":
      if (!e.subskill_id || !e.item_id) errs.push("needs subskill_id and item_id");
      if (typeof p.correct !== "boolean") errs.push("payload.correct must be true or false");
      if (!isNum(p.ms) || (p.ms as number) < 0) errs.push("payload.ms must be a positive number");
      break;
    case "task":
      if (!e.subskill_id) errs.push("needs subskill_id");
      if (!isNum(p.score) || (p.score as number) < 0 || (p.score as number) > 1) errs.push("payload.score must be 0-1");
      break;
    case "aptitude_response":
      if (!e.item_id) errs.push("needs item_id");
      if (!String(p.domain ?? "").startsWith("apt_")) errs.push("payload.domain must be an aptitude id");
      if (typeof p.correct !== "boolean") errs.push("payload.correct must be true or false");
      if (!isNum(p.ms)) errs.push("payload.ms must be a number");
      break;
    case "interest_choice":
      if (typeof p.card !== "string" || typeof p.like !== "boolean") errs.push("payload needs card and like");
      break;
    case "work_sample": {
      if (!e.skill_id) errs.push("needs skill_id");
      if (typeof p.rubric_id !== "string") errs.push("payload.rubric_id is required");
      if (p.scorer !== "ai" && p.scorer !== "teacher" && p.scorer !== "pending") errs.push("payload.scorer must be ai, teacher or pending");
      const scores = p.scores as Record<string, unknown> | undefined;
      if (p.scorer !== "pending" && (!scores || !Object.keys(scores).length || !Object.values(scores).every(isScore))) errs.push("payload.scores must map criteria to 0, 1 or 2");
      break;
    }
    case "rating":
      if (!e.rater_id) errs.push("needs rater_id");
      if (e.refers_to) {
        if (p.scores !== undefined && !Object.values(p.scores as object).every(isScore)) errs.push("payload.scores must be 0, 1 or 2");
      } else {
        if (!target) errs.push("needs skill_id or subskill_id");
        if (!isLevel(p.level) && p.endorse !== true) errs.push("payload.level must be 1-4 (or endorse: true)");
      }
      break;
    case "order":
      if (!e.skill_id) errs.push("needs skill_id");
      if (!isNum(p.amount_inr) || (p.amount_inr as number) < 0) errs.push("payload.amount_inr must be a number");
      break;
    case "taster": {
      if (!e.rater_id) errs.push("needs rater_id");
      const levels = p.levels as Record<string, unknown> | undefined;
      if (!levels || !Object.keys(levels).length || !Object.values(levels).every(isLevel)) errs.push("payload.levels must map sub-skills to 1-4");
      break;
    }
  }
  return errs;
}
