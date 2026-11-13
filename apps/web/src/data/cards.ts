// Picture cards for the interest check (RIASEC). 3 per letter, shown in mixed order.
// Each "like" adds to that letter. Treat the result as a conversation starter, not a validated test.

export type Riasec = "R" | "I" | "A" | "S" | "E" | "C";

export interface Card {
  id: string;
  letter: Riasec;
  emoji: string;
  en: string;
  ta: string;
}

export const CARDS: Card[] = [
  { id: "r_bike", letter: "R", emoji: "🔧", en: "Fixing a bike or motor", ta: "பைக் அல்லது மோட்டார் சரிசெய்தல்" },
  { id: "i_experiment", letter: "I", emoji: "🔬", en: "Doing science experiments", ta: "அறிவியல் சோதனைகள் செய்தல்" },
  { id: "a_drawing", letter: "A", emoji: "🎨", en: "Drawing and painting", ta: "ஓவியம் வரைதல்" },
  { id: "s_teaching", letter: "S", emoji: "🧑‍🏫", en: "Teaching younger children", ta: "சிறு குழந்தைகளுக்குக் கற்றுக்கொடுத்தல்" },
  { id: "e_shop", letter: "E", emoji: "🛒", en: "Running a small shop", ta: "சிறிய கடை நடத்துதல்" },
  { id: "c_accounts", letter: "C", emoji: "📒", en: "Keeping accounts in a notebook", ta: "நோட்டில் கணக்கு எழுதுதல்" },
  { id: "r_field", letter: "R", emoji: "🌾", en: "Working in the field", ta: "வயலில் வேலை செய்தல்" },
  { id: "i_puzzle", letter: "I", emoji: "🧩", en: "Solving puzzles", ta: "புதிர்களைத் தீர்த்தல்" },
  { id: "a_clothes", letter: "A", emoji: "👗", en: "Designing clothes", ta: "ஆடை வடிவமைத்தல்" },
  { id: "s_care", letter: "S", emoji: "🩹", en: "Caring for sick people", ta: "நோயுற்றவர்களைக் கவனித்தல்" },
  { id: "e_lead", letter: "E", emoji: "📣", en: "Leading a team", ta: "குழுவை வழிநடத்துதல்" },
  { id: "c_arrange", letter: "C", emoji: "🗂️", en: "Arranging things neatly", ta: "பொருட்களை ஒழுங்காக அடுக்குதல்" },
  { id: "r_tools", letter: "R", emoji: "🪚", en: "Making things with tools", ta: "கருவிகளால் பொருட்கள் செய்தல்" },
  { id: "i_plants", letter: "I", emoji: "🌱", en: "Finding out how plants grow", ta: "செடிகள் எப்படி வளர்கின்றன என்று ஆராய்தல்" },
  { id: "a_music", letter: "A", emoji: "🎵", en: "Singing, dance or drama", ta: "பாட்டு, நடனம், நாடகம்" },
  { id: "s_help", letter: "S", emoji: "🤝", en: "Helping neighbours", ta: "அக்கம்பக்கத்தினருக்கு உதவுதல்" },
  { id: "e_sell", letter: "E", emoji: "💰", en: "Selling things you made", ta: "நீங்கள் செய்ததை விற்றல்" },
  { id: "c_computer", letter: "C", emoji: "💻", en: "Typing on a computer", ta: "கணினியில் தட்டச்சு செய்தல்" },
];

/** Share of liked cards per letter, 0..1. */
export function riasecFromCards(likes: Record<string, boolean>): Record<Riasec, number> {
  const out = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 } as Record<Riasec, number>;
  const total = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 } as Record<Riasec, number>;
  for (const c of CARDS) {
    total[c.letter] += 1;
    if (likes[c.id]) out[c.letter] += 1;
  }
  for (const k of Object.keys(out) as Riasec[]) out[k] = Math.round((out[k] / total[k]) * 100) / 100;
  return out;
}
