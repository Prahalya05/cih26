// @disha/engine: career matching and scheme eligibility that run on the phone, offline.
// Keep in step with apps/api/app/services/*.py. test/parity.test.ts checks both give identical results.

export * from "./types.ts";
export * from "./graph.ts";
export * from "./events.ts";
export * from "./irt.ts";
export * from "./tracing.ts";
export * from "./fitreach.ts";
export * from "./safety.ts";
export * from "./rpl.ts";
// Aim High (higher-study routes, readiness, study plans). Phone-only for now: no Python twin.
export * from "./pathways.ts";
export { buildKb, EDUCATION_ORDER, SECTORS } from "./kb.ts";
export { apply as applyRule, Evaluation, UNKNOWN } from "./jsonlogic.ts";
export { check, evaluateAll, joined, NEXT_STAGES } from "./eligibility.ts";
export type { SchemeResult, Status } from "./eligibility.ts";
export { feasibility, mmrRerank, recommend, scoreAll, skillOverlap, whatIf, WEIGHTS } from "./matcher.ts";
export type { ScoredCareer, WhatIf } from "./matcher.ts";
// Explainability (decision X-ray), onboarding mode, interests from words, opportunities and the per-student graph.
export { explainScheme } from "./eligibility.ts";
export { describeLeaf, type Leaf } from "./jsonlogic.ts";
export * from "./trace.ts";
export * from "./registry.ts";
export * from "./uimode.ts";
export * from "./interests.ts";
export * from "./readiness.ts";
export * from "./persongraph.ts";
export * from "./aichecks.ts";
