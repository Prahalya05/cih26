// Demo story data (Step 13.1), kept free of browser code so engine tests can check it.
// Demo stories (Step 13.1): three made-up students whose levels change step by step, built from the same
// evidence events real students produce, using real questions from the bank. Everything stays on the phone,
// so the demo runs in airplane mode.

import { ulid, type EvidenceEvent } from "@disha/engine";

const DAY = 86_400_000;
const STORY_DAYS = 42; // the story starts six weeks ago and ends today
export const DEVICE = "demo_phone";

type NewEv = Omit<EvidenceEvent, "id" | "student_id" | "device_id" | "created_at"> & { ref?: string; key?: string };

export interface StoryStep {
  day: number;
  label: { en: string; ta: string };
  events: NewEv[];
}

const answers = (subskill: string, ids: string[], right: boolean[]): NewEv[] =>
  ids.map((item_id, i) => ({ kind: "item_response", subskill_id: subskill, item_id, payload: { correct: right[i], ms: 9000 } }));

const game = (domain: string, ids: string[], right: boolean[]): NewEv[] =>
  ids.map((item_id, i) => ({ kind: "aptitude_response", item_id, payload: { domain, correct: right[i], ms: 7000 } }));

const range = (prefix: string, n: number, pad = 2) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(pad, "0")}`);

/** Seed index in demo.ts -> story. Step 0 is what the student said or tapped (made from her answers). */
export const STORIES: Record<number, StoryStep[]> = {
  // Meena, Class 10: the worked example. "She says she can" -> test -> photo -> teacher -> paid orders.
  0: [
    { day: 1, label: { en: "6 questions on machine stitching", ta: "இயந்திரத் தையலில் 6 கேள்விகள்" },
      events: answers("ss_stitch_machine", ["it_sth_01", "it_sth_02", "it_sth_03", "it_sth_04", "it_sth_05", "it_sth_06"],
        [true, true, true, true, false, true]) },
    { day: 2, label: { en: "Puzzle games: spatial, numbers, machines", ta: "புதிர் விளையாட்டுகள்" },
      events: [
        ...game("apt_spatial", range("apt_spat_", 10), [true, true, true, true, true, true, true, false, true, true]),
        ...game("apt_numeric", range("apt_num_", 8), [true, true, true, true, false, true, false, true]),
        ...game("apt_mechanical", ["apt_mech_chain2", "apt_mech_chain3", "apt_mech_chain4", "apt_mech_fast0", "apt_mech_fast1"],
          [true, true, false, true, false]),
      ] },
    { day: 8, label: { en: "Photo of a blouse, checked against the checklist", ta: "பிளவுஸ் புகைப்படம் சரிபார்ப்பு" },
      events: [{ kind: "work_sample", skill_id: "sk_stitching", key: "sample",
        payload: { rubric_id: "rb_stitching", scorer: "ai", scores: { seams: 2, even: 1, edges: 1, fit: 2, shape: 2 } } }] },
    { day: 15, label: { en: "Her teacher confirms the photo score", ta: "ஆசிரியர் மதிப்பெண்ணை உறுதிசெய்கிறார்" },
      events: [{ kind: "rating", rater_id: "rater_demo_teacher", ref: "sample",
        payload: { scores: { seams: 2, even: 2, edges: 2, fit: 2, shape: 2 } } }] },
    { day: 20, label: { en: "5 paid blouse orders, confirmed by the buyers", ta: "5 பணம் பெற்ற ஆர்டர்கள், வாங்குபவர்கள் உறுதி" },
      events: [0, 1, 2, 3, 4].flatMap((k): NewEv[] => [
        { kind: "order", skill_id: "sk_stitching", key: `order${k}`, payload: { amount_inr: 350, what: "Blouse" } },
        { kind: "rating", rater_id: `buyer_demo_${k}`, ref: `order${k}`, payload: { on_time: true, quality: true, rehire: true } },
      ]) },
  ],
  // Karthik, Class 11: claims nothing, but is very good at the machine puzzles -> "could learn" careers.
  1: [
    { day: 3, label: { en: "Machine puzzles: almost all right, even the hard ones", ta: "இயந்திரப் புதிர்கள்: கிட்டத்தட்ட அனைத்தும் சரி" },
      events: game("apt_mechanical",
        ["apt_mech_chain2", "apt_mech_chain4", "apt_mech_chain6", "apt_mech_chain7", "apt_mech_fast2", "apt_mech_fast3", "apt_mech_fast4", "apt_mech_lever0"],
        [true, true, true, true, true, false, true, true]) },
    { day: 3, label: { en: "Shape puzzles: strong", ta: "வடிவப் புதிர்கள்: சிறப்பு" },
      events: game("apt_spatial", range("apt_spat_", 10), [true, true, true, true, true, true, false, true, true, true]) },
    { day: 4, label: { en: "Number puzzles: average", ta: "எண் புதிர்கள்: சராசரி" },
      events: game("apt_numeric", range("apt_num_", 8), [true, true, true, false, true, false, false, true]) },
  ],
  // Arun, Class 12: says he prices goods in his father's shop; the test shows he is still learning.
  3: [
    { day: 1, label: { en: "6 questions on cost, price and profit: none right", ta: "செலவு, விலை, லாபம்: 6 கேள்விகளில் ஒன்றும் சரியில்லை" },
      events: answers("ss_money_pricing", ["it_mnp_01", "it_mnp_02", "it_mnp_03", "it_mnp_04", "it_mnp_05", "it_mnp_06"],
        [false, false, false, false, false, false]) },
  ],
};

/** The story's events with real ids and times (day 0 = six weeks ago). */
export function storyEvents(studentId: string, steps: StoryStep[], now = Date.now()): EvidenceEvent[][] {
  const start = now - STORY_DAYS * DAY;
  const ids: Record<string, string> = {};
  let n = 0;
  return steps.map((step) => step.events.map(({ ref, key, ...e }) => {
    const at = start + step.day * DAY + n++ * 1000;
    const id = ulid(at);
    if (key) ids[key] = id;
    return { ...e, id, student_id: studentId, device_id: DEVICE, created_at: at,
      ...(ref ? { refers_to: ids[ref] } : {}) } as EvidenceEvent;
  }));
}

