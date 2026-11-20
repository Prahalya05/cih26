// Which kind of screens a student gets: a fixed rule from age and reading comfort (never the AI).
//
//   picture     age under 14, or "someone helps me read"  -> big picture cards, everything read aloud, little text
//   mixed       age 14-16, or "I read a little"            -> picture cards plus a mic and a typing box
//   voice_text  age 17+ and reads easily                   -> "tell us about yourself" by voice or typing first
//
// The student can always switch: the rule picks the starting point, not a limit.

export type Literacy = "easy" | "little" | "helped";
export type Scenario = "school" | "college" | "stopped" | "seeking" | "working";
export type UiMode = "picture" | "mixed" | "voice_text";

export const UIMODE_RULE = { pictureBelowAge: 14, voiceTextFromAge: 17 } as const;

/** Age this year from the birth year (the only date we ask for). */
export function ageFromBirthYear(birthYear: number | undefined, now: Date = new Date()): number | undefined {
  return birthYear ? now.getFullYear() - birthYear : undefined;
}

export function uiModeOf(input: { age?: number; literacy?: Literacy }): { mode: UiMode; why: string[] } {
  const { age, literacy } = input;
  const a = age === undefined ? "age not given" : `age ${age}`;
  if (literacy === "helped") return { mode: "picture", why: [`reads: someone helps → picture mode`] };
  if (age !== undefined && age < UIMODE_RULE.pictureBelowAge) return { mode: "picture", why: [`${a} < ${UIMODE_RULE.pictureBelowAge} → picture mode`] };
  if (literacy === "little") return { mode: "mixed", why: [`reads: a little → mixed mode`] };
  if (age === undefined || age < UIMODE_RULE.voiceTextFromAge) {
    return { mode: "mixed", why: [age === undefined ? `${a} → mixed mode (safe middle)` : `${UIMODE_RULE.pictureBelowAge} ≤ ${a} < ${UIMODE_RULE.voiceTextFromAge} → mixed mode`] };
  }
  if (literacy === "easy") return { mode: "voice_text", why: [`${a} ≥ ${UIMODE_RULE.voiceTextFromAge} and reads easily → voice/text mode`] };
  return { mode: "mixed", why: [`${a} but reading not given → mixed mode`] };
}

/** Situations where school-only questions (school type, Class 7 marks) make no sense. */
export const NOT_IN_SCHOOL: Scenario[] = ["stopped", "seeking", "working"];
