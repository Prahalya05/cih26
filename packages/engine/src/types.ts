// Shapes of the knowledge base files in packages/kb.

export type Lang = { en: string; ta?: string; [lang: string]: string | undefined };

export interface Skill {
  id: string;
  cluster: string;
  name: Lang;
  aliases?: string[];
}

export interface Occupation {
  id: string;
  sector: string;
  riasec: string;
  min_education: string;
  name: Lang;
  description_en?: string;
  skills: { id: string; w: number }[];
  pathway?: string[];
  exams?: string[];
  local_demand_tn?: "high" | "medium" | "low";
  source_url?: string;
  needs_verification?: boolean;
}

export interface Scheme {
  id: string;
  type: string;
  provider?: string;
  name: Lang;
  benefit_en: string;
  required_documents: string[];
  apply_url: string;
  source_url: string;
  needs_verification?: boolean;
  verified_on?: string | null;
  verified_by?: string | null;
}

export interface Rule {
  id: string;
  rule: unknown;
  updated?: string;
  notes?: string;
  fixtures?: { facts: Facts; expected: "eligible" | "not_eligible" | "need_info" }[];
}

/** The whole knowledge base, keyed by id. Key order matters: it matches file order. */
export interface KB {
  skills: Record<string, Skill>;
  occupations: Record<string, Occupation>;
  schemes: Record<string, Scheme>;
  rules: Record<string, Rule>;
}

export interface Persona {
  education?: string;
  riasec?: Partial<Record<"R" | "I" | "A" | "S" | "E" | "C", number>>;
  skills?: { id: string; confidence?: number }[];
  [key: string]: unknown;
}

export type Facts = Record<string, unknown>;
