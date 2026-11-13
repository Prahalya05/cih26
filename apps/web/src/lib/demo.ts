// A made-up class for the demo, clearly marked as simulated everywhere it appears.
// Real 30/90-day outcomes can't exist before the finale, so we don't pretend they do.

import { CARDS, type Riasec } from "../data/cards";
import { db, eventsFromLegacy, type Student } from "./db";
import { deviceId } from "./events";

interface Seed {
  name: string;
  avatar: string;
  likes: Riasec[];
  chips: Record<string, string[]>;
  facts: Record<string, unknown>;
  said?: { qid: string; text: string; skills: string[] };
}

const SEEDS: Seed[] = [
  { name: "மீனா (Meena)", avatar: "🦋", likes: ["A", "E", "R"],
    chips: { home: ["sk_stitching", "sk_money_handling"], free_time: ["sk_drawing", "sk_colour_design"] },
    facts: { age: 16, gender: "female", level: "10", school_6_to_12: "govt", tamil_medium: true, category: "sc", family_income_inr: 80000 },
    said: { qid: "home", text: "அக்கம்பக்கத்து அக்காக்களுக்கு பிளவுஸ் தைத்துக் கொடுப்பேன்", skills: ["sk_stitching"] } },
  { name: "கார்த்திக் (Karthik)", avatar: "🐅", likes: ["R", "I"],
    chips: { home: ["sk_machine_repair"], asked_for_help: ["sk_electrical_basic", "sk_tools_handling"], subjects: ["sk_science"] },
    facts: { age: 17, gender: "male", level: "11", school_6_to_12: "govt", tamil_medium: true, category: "mbc", family_income_inr: 200000 } },
  { name: "பிரியா (Priya)", avatar: "🌻", likes: ["S", "I"],
    chips: { home: ["sk_caring_people"], asked_for_help: ["sk_teaching_explaining"], subjects: ["sk_science", "sk_english_basic"] },
    facts: { age: 15, gender: "female", level: "9", school_6_to_12: "govt", tamil_medium: true, category: "sc", family_income_inr: 80000 } },
  { name: "அருண் (Arun)", avatar: "🌳", likes: ["R", "E"],
    chips: { home: ["sk_crop_farming", "sk_animal_care"], lead: ["sk_driving"] },
    facts: { age: 18, gender: "male", level: "12", school_6_to_12: "aided", tamil_medium: true, category: "bc", family_income_inr: 200000 } },
  { name: "திவ்யா (Divya)", avatar: "⭐", likes: ["C", "I"],
    chips: { free_time: ["sk_computer_basic"], subjects: ["sk_basic_math", "sk_coding"] },
    facts: { age: 19, gender: "female", level: "diploma", year_of_study: 1, course_type: "technical", school_6_to_12: "govt", tamil_medium: true, category: "mbc", family_income_inr: 200000 } },
  { name: "சுரேஷ் (Suresh)", avatar: "🐘", likes: ["E", "S"],
    chips: { asked_for_help: ["sk_selling", "sk_organising"], lead: ["sk_leadership", "sk_communication"] },
    facts: { age: 20, gender: "male", level: "ug", year_of_study: 3, school_6_to_12: "private", tamil_medium: false, category: "general", family_income_inr: 300000 } },
  { name: "காவ்யா (Kavya)", avatar: "🪔", likes: ["A", "S"],
    chips: { free_time: ["sk_photography", "sk_drawing"], lead: ["sk_communication"] },
    facts: { age: 16, gender: "female", level: "10", school_6_to_12: "aided", tamil_medium: true, category: "bc", family_income_inr: 200000 } },
  { name: "முருகன் (Murugan)", avatar: "🐓", likes: ["R", "C"],
    chips: { home: ["sk_cooking", "sk_animal_care"], asked_for_help: ["sk_tools_handling"] },
    facts: { age: 17, gender: "male", level: "out", school_6_to_12: "govt", tamil_medium: true, category: "sc", family_income_inr: 80000 } },
];

export async function loadDemoClass(code: string) {
  const now = Date.now();
  const students: Student[] = SEEDS.map((seed, i) => {
    const cards: Record<string, boolean> = {};
    for (const c of CARDS) cards[c.id] = seed.likes.includes(c.letter);
    const answers: Student["answers"] = {};
    for (const [qid, chips] of Object.entries(seed.chips)) answers[qid] = { qid, chips };
    if (seed.said) {
      const a = answers[seed.said.qid] ?? { qid: seed.said.qid, chips: [] };
      answers[seed.said.qid] = {
        ...a, transcript: seed.said.text, via: "gemini",
        extracted: seed.said.skills.map((id) => ({ id, confidence: 0.8, evidence: seed.said!.text, source: "voice" as const })),
      };
    }
    return {
      id: `demo_${code}_${i}`, name: seed.name, avatar: seed.avatar, facilitator_code: code,
      consent: { at: now }, cards, answers, factAnswers: { state: "TN", ...seed.facts },
      simulated: true, updated_at: now - i * 60_000,
    };
  });
  await db.students.bulkPut(students);
  const device = await deviceId();
  const events = students.flatMap((s) => eventsFromLegacy(s, [], device));
  await db.events.bulkPut(events.map((e) => ({ ...e, synced: 1 as const }))); // demo events never leave the phone
}

export async function clearDemoClass() {
  const ids = (await db.students.filter((s) => !!s.simulated).primaryKeys()) as string[];
  await db.transaction("rw", [db.students, db.actions, db.events, db.skillState], async () => {
    await db.students.bulkDelete(ids);
    await db.actions.where("student_id").anyOf(ids).delete();
    await db.events.where("student_id").anyOf(ids).delete();
    await db.skillState.where("student_id").anyOf(ids).delete();
  });
}
