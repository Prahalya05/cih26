// Interests from the student's own words (when she skips the picture cards).
//
// The AI reads free speech or text and proposes RIASEC letters with quotes. Before anything is used, checkInterests
// (a fixed rule) keeps only letters in R I A S E C that come with a quote actually found in what she said.
// With no internet, interestsFromKeywords finds the same letters from a word list (Tamil, English, Hindi).

export type RiasecLetter = "R" | "I" | "A" | "S" | "E" | "C";
export const RIASEC_LETTERS: RiasecLetter[] = ["R", "I", "A", "S", "E", "C"];

export interface InterestClaim {
  letter: RiasecLetter;
  tag: string;
  evidence: string;
  strength: number;
}

const WORDS: Record<RiasecLetter, string[]> = {
  R: ["repair", "fix", "machine", "motor", "bike", "farm", "field", "tractor", "tools", "build", "wiring", "electric", "drive", "sport", "mechanic", "plumb", "weld",
    "சரிசெய்", "இயந்திர", "வயல்", "விவசாய", "மோட்டார்", "கருவி", "வண்டி", "மின்",
    "मरम्मत", "ठीक कर", "मोबाइल", "मशीन", "खेत", "खेती", "औज़ार", "औजार", "बाइक", "गाड़ी", "बिजली"],
  I: ["science", "experiment", "puzzle", "math", "maths", "research", "computer", "coding", "doctor", "how things work", "study", "nature", "plants",
    "அறிவியல்", "கணக்கு", "கணிதம்", "ஆராய", "புதிர்", "கணினி",
    "विज्ञान", "गणित", "प्रयोग", "पहेली", "कंप्यूटर", "शोध"],
  A: ["draw", "paint", "music", "sing", "dance", "design", "drama", "art", "photo", "video", "write stories", "craft", "mehendi", "rangoli", "fashion",
    "ஓவிய", "வரை", "பாட்டு", "பாடு", "நடன", "வடிவமை", "கோலம்", "புகைப்பட",
    "चित्र", "ड्रॉ", "गाना", "संगीत", "नाच", "नृत्य", "डिज़ाइन", "कला", "रंगोली"],
  S: ["teach", "help", "care", "nurse", "children", "people", "serve", "community", "listen", "health", "elders",
    "கற்பி", "உதவ", "கவனி", "குழந்தை", "மக்கள்", "சேவை", "செவிலி",
    "पढ़ा", "मदद", "सेवा", "बच्चों", "लोगों", "देखभाल", "नर्स"],
  E: ["sell", "shop", "business", "lead", "leader", "money", "market", "manage", "boss", "own", "customer", "politics",
    "விற்", "கடை", "வியாபார", "தொழில்", "தலைமை", "பணம்",
    "बेच", "दुकान", "व्यापार", "धंधा", "नेता", "पैसा", "बिज़नेस"],
  C: ["accounts", "arrange", "organise", "organize", "typing", "office", "records", "file", "count", "bank", "data entry", "neat",
    "கணக்கு எழுது", "ஒழுங்கு", "அடுக்கு", "தட்டச்சு", "அலுவலக", "வங்கி",
    "हिसाब", "दफ्तर", "दफ़्तर", "टाइपिंग", "बैंक", "व्यवस्थित"],
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Offline: letters whose words appear in the text, each with the sentence that mentions it. */
export function interestsFromKeywords(text: string): InterestClaim[] {
  const t = norm(text);
  if (!t) return [];
  const sentences = text.split(/[.!?।\n]+/).map((s) => s.trim()).filter(Boolean);
  const out: InterestClaim[] = [];
  for (const letter of RIASEC_LETTERS) {
    const hit = WORDS[letter].find((w) => t.includes(norm(w)));
    if (!hit) continue;
    const evidence = sentences.find((s) => norm(s).includes(norm(hit))) ?? text.trim();
    out.push({ letter, tag: hit, evidence: evidence.slice(0, 200), strength: 0.6 });
  }
  return out;
}

/**
 * The rule check on the AI's answer: a letter must be one of R I A S E C and its quote must really be in what she said.
 * Returns what to keep and what was dropped (with the reason), so the X-ray can show both.
 */
export function checkInterests(raw: unknown, said: string): { kept: InterestClaim[]; dropped: { value: string; reason: string }[] } {
  const kept: InterestClaim[] = [];
  const dropped: { value: string; reason: string }[] = [];
  const text = norm(said);
  for (const x of Array.isArray(raw) ? raw : []) {
    const letter = String((x as Record<string, unknown>)?.letter ?? "").toUpperCase();
    const evidence = String((x as Record<string, unknown>)?.evidence ?? "").trim();
    const label = `${letter || "?"} "${evidence.slice(0, 40)}"`;
    if (!RIASEC_LETTERS.includes(letter as RiasecLetter)) { dropped.push({ value: label, reason: "not a RIASEC letter" }); continue; }
    if (!evidence || (text && !text.includes(norm(evidence)))) { dropped.push({ value: label, reason: "quote not found in what she said" }); continue; }
    if (kept.some((k) => k.letter === letter)) continue;
    const s = Number((x as Record<string, unknown>)?.strength ?? 0.6);
    kept.push({ letter: letter as RiasecLetter, tag: String((x as Record<string, unknown>)?.tag ?? "").slice(0, 40),
      evidence: evidence.slice(0, 200), strength: Math.min(1, Math.max(0, Number.isFinite(s) ? s : 0.6)) });
  }
  return { kept, dropped };
}

/** RIASEC scores (0..1) from claims; letters not mentioned stay 0. Empty claims -> undefined (neutral interest). */
export function riasecFromClaims(claims: InterestClaim[]): Record<RiasecLetter, number> | undefined {
  if (!claims.length) return undefined;
  const out = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 } as Record<RiasecLetter, number>;
  for (const c of claims) out[c.letter] = Math.max(out[c.letter], Math.round(c.strength * 100) / 100);
  return out;
}
