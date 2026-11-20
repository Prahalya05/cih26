// Rule checks on the newer AI answers. Same logic as apps/api/app/services/guards.py (check_personalised, check_followup).
// The server checks first; the phone checks again so it never uses an AI answer it cannot verify.

export interface Dropped { value: string; reason: string }
export interface PersonalWhy { why: string; quote: string }

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The AI may only re-order the formula's shortlist, and each reason must quote her real words.
 * Ids outside the shortlist and repeats are dropped; shortlist ids the AI left out keep formula order at the end.
 */
export function checkPersonalised(
  raw: { order?: unknown; why?: unknown; items?: unknown } | null | undefined, shortlist: string[], quotes: string[],
): { order: string[]; why: Record<string, PersonalWhy>; dropped: Dropped[] } {
  const dropped: Dropped[] = [];
  const allowed = [...new Set(shortlist)];
  const order: string[] = [];
  for (const x of Array.isArray(raw?.order) ? raw!.order as unknown[] : []) {
    const id = String(x);
    if (!allowed.includes(id)) dropped.push({ value: id || "?", reason: "not in the formula's shortlist" });
    else if (!order.includes(id)) order.push(id);
  }
  const missing = allowed.filter((id) => !order.includes(id));
  if (missing.length && order.length) dropped.push({ value: missing.join(", "), reason: "left out by the AI: kept in formula order at the end" });
  order.push(...missing);

  const said = quotes.filter((q) => q?.trim()).map(norm);
  const why: Record<string, PersonalWhy> = {};
  // Accept both shapes: the server's checked map ({id: {why, quote}}) and the AI's raw list of items.
  const items: { id: string; why: string; quote: string }[] = Array.isArray(raw?.items)
    ? (raw!.items as { id: string; why: string; quote: string }[])
    : Object.entries((raw?.why ?? {}) as Record<string, PersonalWhy>).map(([id, w]) => ({ id, ...w }));
  for (const x of items) {
    const id = String(x?.id ?? ""), text = String(x?.why ?? "").trim(), quote = String(x?.quote ?? "").trim();
    if (!allowed.includes(id) || why[id] || !text) continue;
    if (quote && !said.some((s) => s.includes(norm(quote)))) {
      dropped.push({ value: `${id} "${quote.slice(0, 40)}"`, reason: "quote not found in what she said" });
      continue;
    }
    why[id] = { why: text.slice(0, 280), quote: quote.slice(0, 200) };
  }
  return { order, why, dropped };
}

const BANNED = ["caste", "religion", "phone number", "mobile number", "address", "aadhaar", "income", "salary of your",
  "சாதி", "மதம்", "முகவரி", "தொலைபேசி எண்", "जाति", "धर्म", "पता", "फ़ोन नंबर", "आधार"];

/** Keep a follow-up only if it is one short question that does not ask for personal data. */
export function checkFollowup(question: string | null | undefined): { question: string | null; dropped: Dropped[] } {
  let q = String(question ?? "").replace(/\s+/g, " ").trim();
  if (!q) return { question: null, dropped: [{ value: "(empty)", reason: "no question" }] };
  const hit = BANNED.find((w) => q.toLowerCase().includes(w));
  if (hit) return { question: null, dropped: [{ value: q.slice(0, 60), reason: `asks about '${hit}' (personal data)` }] };
  if (q.length > 220 || (q.match(/\?/g) ?? []).length > 2) return { question: null, dropped: [{ value: q.slice(0, 60), reason: "too long or more than one question" }] };
  if (!q.includes("?") && !q.includes("？")) q += "?";
  return { question: q, dropped: [] };
}

/**
 * When to ask a follow-up (a rule, not the AI): her answer found fewer than two interest areas, or was very short.
 * At most two follow-ups, so she is never stuck in a loop.
 */
export function isVague(text: string, found: number, asked: number): boolean {
  if (asked >= 2) return false;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return found < 2 || words < 6;
}
