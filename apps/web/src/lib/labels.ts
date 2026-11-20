// Display helpers shared by the results and teacher screens.

export const SECTOR: Record<string, { emoji: string; en: string; ta: string }> = {
  stem: { emoji: "🔬", en: "Science & tech", ta: "அறிவியல் & தொழில்நுட்பம்" },
  vocational: { emoji: "🛠️", en: "Skilled trade", ta: "தொழில் திறன்" },
  agri: { emoji: "🌾", en: "Farming", ta: "விவசாயம்" },
  creative: { emoji: "🎨", en: "Creative", ta: "படைப்பு" },
  services: { emoji: "🤝", en: "Services", ta: "சேவை" },
  govt: { emoji: "🏛️", en: "Government", ta: "அரசு" },
  health: { emoji: "🩺", en: "Health", ta: "சுகாதாரம்" },
  entrepreneurship: { emoji: "🏪", en: "Own business", ta: "சொந்தத் தொழில்" },
};

export const SCHEME_TYPE: Record<string, string> = {
  scholarship: "🎓",
  scheme: "🏛️",
  apprenticeship: "🛠️",
  internship: "💼",
};

export function formatDate(iso: string | null | undefined, lang: string) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(lang === "ta" ? "ta-IN" : lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric" });
}
