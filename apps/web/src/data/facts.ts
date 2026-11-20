// Questions that collect the facts scheme rules need. The first group is asked up front;
// the rest are asked only when a scheme says "need more info".

import type { Facts } from "@disha/engine";

export interface Option {
  value: string | number | boolean;
  en: string;
  ta: string;
  emoji?: string;
}

export interface FactQuestion {
  key: string;
  en: string;
  ta: string;
  options?: Option[];
  number?: { min: number; max: number };
}

const yesNo: Option[] = [
  { value: true, en: "Yes", ta: "ஆம்", emoji: "✅" },
  { value: false, en: "No", ta: "இல்லை", emoji: "❌" },
];

/** "level" is not a rule fact itself; it sets stage, current_class and passed_class together. */
export const LEVEL_OPTIONS: Option[] = [
  { value: "8", en: "Class 8", ta: "8ஆம் வகுப்பு" },
  { value: "9", en: "Class 9", ta: "9ஆம் வகுப்பு" },
  { value: "10", en: "Class 10", ta: "10ஆம் வகுப்பு" },
  { value: "11", en: "Class 11", ta: "11ஆம் வகுப்பு" },
  { value: "12", en: "Class 12", ta: "12ஆம் வகுப்பு" },
  { value: "iti", en: "ITI", ta: "ஐடிஐ" },
  { value: "diploma", en: "Diploma", ta: "பட்டயப் படிப்பு" },
  { value: "ug", en: "College (degree)", ta: "கல்லூரி (பட்டம்)" },
  { value: "out", en: "Not studying now", ta: "இப்போது படிக்கவில்லை" },
];

export const FACT_QUESTIONS: Record<string, FactQuestion> = {
  age: { key: "age", en: "How old are you?", ta: "உங்கள் வயது என்ன?", number: { min: 10, max: 30 } },
  gender: {
    key: "gender", en: "You are a…", ta: "நீங்கள்…",
    options: [
      { value: "female", en: "Girl", ta: "பெண்", emoji: "👧" },
      { value: "male", en: "Boy", ta: "ஆண்", emoji: "👦" },
      { value: "other", en: "Other", ta: "மூன்றாம் பாலினம்", emoji: "🧑" },
    ],
  },
  level: { key: "level", en: "What are you studying now?", ta: "இப்போது என்ன படிக்கிறீர்கள்?", options: LEVEL_OPTIONS },
  school_6_to_12: {
    key: "school_6_to_12", en: "Where did you study Classes 6 to 12?", ta: "6 முதல் 12 வரை எங்கு படித்தீர்கள்?",
    options: [
      { value: "govt", en: "Government school", ta: "அரசுப் பள்ளி", emoji: "🏫" },
      { value: "aided", en: "Government-aided school", ta: "அரசு உதவி பெறும் பள்ளி", emoji: "🏛️" },
      { value: "private", en: "Private school", ta: "தனியார் பள்ளி", emoji: "🏢" },
    ],
  },
  tamil_medium: { key: "tamil_medium", en: "Did you study in Tamil medium?", ta: "தமிழ் வழியில் படித்தீர்களா?", options: yesNo },
  category: {
    key: "category", en: "Community category", ta: "சமூகப் பிரிவு",
    options: [
      { value: "sc", en: "SC", ta: "ஆதிதிராவிடர் (SC)" },
      { value: "st", en: "ST", ta: "பழங்குடியினர் (ST)" },
      { value: "mbc", en: "MBC", ta: "மிகப் பிற்படுத்தப்பட்டோர் (MBC)" },
      { value: "bc", en: "BC", ta: "பிற்படுத்தப்பட்டோர் (BC)" },
      { value: "general", en: "General", ta: "பொதுப் பிரிவு" },
    ],
  },
  family_income_inr: {
    key: "family_income_inr", en: "Family income in a year", ta: "குடும்பத்தின் ஆண்டு வருமானம்",
    options: [
      { value: 80000, en: "Under ₹1 lakh", ta: "₹1 லட்சத்திற்குக் கீழ்" },
      { value: 200000, en: "₹1 – 2.5 lakh", ta: "₹1 – 2.5 லட்சம்" },
      { value: 300000, en: "₹2.5 – 3.5 lakh", ta: "₹2.5 – 3.5 லட்சம்" },
      { value: 600000, en: "₹3.5 – 8 lakh", ta: "₹3.5 – 8 லட்சம்" },
      { value: 900000, en: "Over ₹8 lakh", ta: "₹8 லட்சத்திற்கு மேல்" },
    ],
  },
  // Asked only when a scheme needs them:
  disability_percent: {
    key: "disability_percent", en: "Do you have a disability certificate of 40% or more?", ta: "40% அல்லது அதற்கு மேல் மாற்றுத்திறன் சான்றிதழ் உள்ளதா?",
    options: [{ value: 40, en: "Yes", ta: "ஆம்", emoji: "✅" }, { value: 0, en: "No", ta: "இல்லை", emoji: "❌" }],
  },
  course_type: {
    key: "course_type", en: "Is your course technical (engineering, polytechnic)?", ta: "உங்கள் படிப்பு தொழில்நுட்பப் படிப்பா (பொறியியல், பாலிடெக்னிக்)?",
    options: [{ value: "technical", en: "Yes, technical", ta: "ஆம்", emoji: "⚙️" }, { value: "general", en: "No", ta: "இல்லை", emoji: "📚" }],
  },
  year_of_study: {
    key: "year_of_study", en: "Which year are you in?", ta: "எத்தனையாவது ஆண்டு படிக்கிறீர்கள்?",
    options: [1, 2, 3, 4].map((n) => ({ value: n, en: `Year ${n}`, ta: `${n}ஆம் ஆண்டு` })),
  },
  lateral_entry: { key: "lateral_entry", en: "Did you join directly in year 2 (lateral entry)?", ta: "நேரடியாக 2ஆம் ஆண்டில் சேர்ந்தீர்களா?", options: yesNo },
  studying_full_time: { key: "studying_full_time", en: "Are you studying full-time now?", ta: "இப்போது முழுநேரமாகப் படிக்கிறீர்களா?", options: yesNo },
  final_year: { key: "final_year", en: "Is this your final year?", ta: "இது உங்கள் இறுதி ஆண்டா?", options: yesNo },
  full_time_job: { key: "full_time_job", en: "Do you have a full-time job?", ta: "முழுநேர வேலை உள்ளதா?", options: yesNo },
  govt_job_family: { key: "govt_job_family", en: "Does anyone in your family have a regular government job?", ta: "குடும்பத்தில் யாருக்காவது நிரந்தர அரசு வேலை உள்ளதா?", options: yesNo },
  class7_percent: {
    key: "class7_percent", en: "Marks in Class 7", ta: "7ஆம் வகுப்பு மதிப்பெண்",
    options: [
      { value: 45, en: "Under 50%", ta: "50%க்குக் கீழ்" },
      { value: 52, en: "50 – 55%", ta: "50 – 55%" },
      { value: 60, en: "Over 55%", ta: "55%க்கு மேல்" },
    ],
  },
  // Aim High: the Class 11–12 group or the degree decides which higher-study doors are still open.
  stream: {
    key: "stream", en: "Which group are you in (Class 11–12)?", ta: "11–12இல் எந்தப் பிரிவு?",
    options: [
      { value: "pcmb", en: "Biology + Maths", ta: "உயிரியல் + கணிதம்", emoji: "🧬" },
      { value: "pcm", en: "Maths + Computer Science", ta: "கணிதம் + கணினி அறிவியல்", emoji: "➗" },
      { value: "pcb", en: "Pure Science (Biology, no Maths)", ta: "தூய அறிவியல் (உயிரியல்)", emoji: "🌿" },
      { value: "commerce", en: "Commerce", ta: "வணிகவியல்", emoji: "📊" },
      { value: "humanities", en: "Arts / Humanities", ta: "கலைப் பிரிவு", emoji: "📚" },
    ],
  },
  degree: {
    key: "degree", en: "Which degree are you doing?", ta: "எந்தப் பட்டம் படிக்கிறீர்கள்?",
    options: [
      { value: "ug_science", en: "B.Sc.", ta: "B.Sc.", emoji: "🔬" },
      { value: "ug_commerce", en: "B.Com.", ta: "B.Com.", emoji: "📊" },
      { value: "ug_arts", en: "B.A.", ta: "B.A.", emoji: "📚" },
      { value: "btech", en: "B.E. / B.Tech", ta: "B.E. / B.Tech", emoji: "⚙️" },
    ],
  },
  school_type: {
    key: "school_type", en: "What kind of school are you in now?", ta: "இப்போது எந்த வகைப் பள்ளியில் படிக்கிறீர்கள்?",
    options: [
      { value: "govt", en: "Government", ta: "அரசு" },
      { value: "aided", en: "Government-aided", ta: "அரசு உதவி பெறும்" },
      { value: "private", en: "Private", ta: "தனியார்" },
      { value: "central", en: "KV / Navodaya / Sainik", ta: "கேந்திரிய / நவோதயா / சைனிக்" },
    ],
  },
};

export const FIRST_QUESTIONS = ["age", "gender", "level", "school_6_to_12", "tamil_medium", "category", "family_income_inr"];

/** Turn the answers (including "level") into the facts the rules use. */
export function factsFromAnswers(a: Record<string, unknown>): Facts {
  const facts: Facts = { state: "TN" };
  for (const [k, v] of Object.entries(a)) if (k !== "level" && v !== undefined && v !== null) facts[k] = v;
  const level = a.level as string | undefined;
  if (level && /^\d+$/.test(level)) {
    const cls = Number(level);
    Object.assign(facts, { stage: "school", current_class: cls, passed_class: cls - 1 });
    if (facts.school_type === undefined && a.school_6_to_12 !== undefined) facts.school_type = a.school_6_to_12;
  } else if (level === "iti" || level === "diploma") {
    Object.assign(facts, { stage: level, passed_class: 10, studying_full_time: true });
  } else if (level === "ug") {
    Object.assign(facts, { stage: "ug", passed_class: 12, studying_full_time: true });
  } else if (level === "out") {
    Object.assign(facts, { stage: "none", studying_full_time: false });
  }
  if (facts.stage !== "school") delete facts.current_class;
  return facts;
}

/** Education level for career matching: what the student will have finished by the end of this year. */
export function educationFromLevel(level: string | undefined): string {
  if (!level) return "class10";
  if (level === "8" || level === "9") return "class8";
  if (level === "10" || level === "11") return "class10";
  if (level === "12" || level === "ug") return "class12";
  if (level === "iti") return "iti";
  if (level === "diploma") return "diploma";
  return "class10";
}
