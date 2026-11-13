// Guided questions. Open questions alone don't work with teenagers ("I don't know"), so every question
// shows examples as tap chips. The student can also speak or type in their own words.

export interface Chip {
  skill: string;
  emoji: string;
  en: string;
  ta: string;
}

export interface Question {
  id: string;
  en: string;
  ta: string;
  chips: Chip[];
}

export const QUESTIONS: Question[] = [
  {
    id: "home",
    en: "What do you help with at home?",
    ta: "வீட்டில் நீங்கள் எதில் உதவுகிறீர்கள்?",
    chips: [
      { skill: "sk_cooking", emoji: "🍳", en: "Cooking", ta: "சமையல்" },
      { skill: "sk_stitching", emoji: "🧵", en: "Stitching clothes", ta: "துணி தைத்தல்" },
      { skill: "sk_crop_farming", emoji: "🌾", en: "Farming", ta: "விவசாயம்" },
      { skill: "sk_animal_care", emoji: "🐄", en: "Looking after animals", ta: "கால்நடை பராமரிப்பு" },
      { skill: "sk_machine_repair", emoji: "🔧", en: "Repairs", ta: "பழுது பார்த்தல்" },
      { skill: "sk_money_handling", emoji: "💰", en: "Shop or accounts", ta: "கடை அல்லது கணக்கு" },
      { skill: "sk_caring_people", emoji: "👵", en: "Caring for elders", ta: "முதியோரைக் கவனித்தல்" },
    ],
  },
  {
    id: "free_time",
    en: "What do you like doing in your free time?",
    ta: "ஓய்வு நேரத்தில் என்ன செய்யப் பிடிக்கும்?",
    chips: [
      { skill: "sk_drawing", emoji: "🎨", en: "Drawing or kolam", ta: "ஓவியம் அல்லது கோலம்" },
      { skill: "sk_photography", emoji: "📷", en: "Photos and videos", ta: "புகைப்படம், காணொளி" },
      { skill: "sk_physical_fitness", emoji: "🏏", en: "Sports", ta: "விளையாட்டு" },
      { skill: "sk_computer_basic", emoji: "📱", en: "Phone apps", ta: "கைபேசி செயலிகள்" },
      { skill: "sk_colour_design", emoji: "🌸", en: "Decorating, mehendi", ta: "அலங்காரம், மருதாணி" },
      { skill: "sk_reading_writing", emoji: "📖", en: "Reading stories", ta: "கதை படித்தல்" },
    ],
  },
  {
    id: "asked_for_help",
    en: "What do people ask you to help with?",
    ta: "மற்றவர்கள் உங்களிடம் எதற்கு உதவி கேட்கிறார்கள்?",
    chips: [
      { skill: "sk_teaching_explaining", emoji: "🧑‍🏫", en: "Explaining lessons", ta: "பாடம் சொல்லிக்கொடுத்தல்" },
      { skill: "sk_electrical_basic", emoji: "💡", en: "Fixing a fan or switch", ta: "மின்விசிறி, சுவிட்ச் சரிசெய்தல்" },
      { skill: "sk_tools_handling", emoji: "🔨", en: "Using tools", ta: "கருவிகள் பயன்படுத்துதல்" },
      { skill: "sk_selling", emoji: "🗣️", en: "Talking to customers", ta: "வாடிக்கையாளரிடம் பேசுதல்" },
      { skill: "sk_organising", emoji: "📋", en: "Organising events", ta: "நிகழ்ச்சி ஏற்பாடு" },
    ],
  },
  {
    id: "subjects",
    en: "Which subjects do you enjoy?",
    ta: "எந்தப் பாடங்கள் உங்களுக்குப் பிடிக்கும்?",
    chips: [
      { skill: "sk_basic_math", emoji: "➗", en: "Maths", ta: "கணிதம்" },
      { skill: "sk_science", emoji: "🔬", en: "Science", ta: "அறிவியல்" },
      { skill: "sk_english_basic", emoji: "🔤", en: "English", ta: "ஆங்கிலம்" },
      { skill: "sk_coding", emoji: "💻", en: "Computer class", ta: "கணினி வகுப்பு" },
      { skill: "sk_reading_writing", emoji: "✍️", en: "Tamil", ta: "தமிழ்" },
    ],
  },
  {
    id: "lead",
    en: "Have you ever led a group or spoken in front of people?",
    ta: "நீங்கள் எப்போதாவது ஒரு குழுவை வழிநடத்தியிருக்கிறீர்களா அல்லது மேடையில் பேசியிருக்கிறீர்களா?",
    chips: [
      { skill: "sk_leadership", emoji: "🎖️", en: "Class leader", ta: "வகுப்புத் தலைவர்" },
      { skill: "sk_communication", emoji: "🎤", en: "Speech or anchoring", ta: "பேச்சு, தொகுப்பு" },
      { skill: "sk_driving", emoji: "🚜", en: "Drove a bike or tractor", ta: "பைக், டிராக்டர் ஓட்டியது" },
    ],
  },
];
