// Explainability, onboarding mode, interests, opportunity readiness and the per-student graph.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadKb } from "./loadKb.ts";
import { check, explainScheme, evaluateAll } from "../src/eligibility.ts";
import { describeLeaf } from "../src/jsonlogic.ts";
import { explainCareer, scoreAllV2 } from "../src/fitreach.ts";
import { careerDecision, schemeDecision } from "../src/trace.ts";
import { uiModeOf, ageFromBirthYear } from "../src/uimode.ts";
import { checkInterests, interestsFromKeywords, riasecFromClaims } from "../src/interests.ts";
import { opportunityReadiness, rankOpportunities, type Opportunity } from "../src/readiness.ts";
import { personGraph } from "../src/persongraph.ts";
import { registryOf } from "../src/registry.ts";

const kb = loadKb();
const MEENA = { age: 16, gender: "female", state: "TN", category: "sc", current_class: 10, passed_class: 9, stage: "school",
  school_type: "govt", school_6_to_12: "govt", tamil_medium: true, family_income_inr: 90000 };

test("explainScheme gives the same status as check, plus the conditions", () => {
  for (const sid of Object.keys(kb.rules)) {
    for (const facts of [MEENA, {}, { age: 20, passed_class: 12, stage: "ug" }]) {
      const x = explainScheme(kb, sid, facts);
      assert.equal(x.status, check(kb, sid, facts).status, sid);
    }
  }
  const x = explainScheme(kb, "sch_pre_matric_sc", MEENA);
  assert.ok(x.leaves.length > 0);
  assert.ok(x.leaves.map(describeLeaf).some((s) => s.includes("category") && s.endsWith("✓")));
  const d = schemeDecision(x, "Pre-Matric");
  assert.equal(d.source, "RULE");
  assert.equal(d.ref, "rule.sch_pre_matric_sc");
});

test("recording leaves does not change eligibility results", () => {
  assert.deepEqual(evaluateAll(kb, MEENA).map((r) => r.status), evaluateAll(kb, MEENA).map((r) => r.status));
});

test("explainCareer totals match scoreAllV2", () => {
  const persona = { education: "class10", riasec: { A: 0.9, R: 0.3 }, levels: { ss_stitch_machine: [0.05, 0.15, 0.5, 0.3] } };
  for (const c of scoreAllV2(kb, persona)) {
    const b = explainCareer(kb, persona, c.occupation_id)!;
    assert.equal(b.total, c.score, c.occupation_id);
    const d = careerDecision(b, c.occupation_id);
    assert.ok(d.why[1].endsWith(b.total.toFixed(2)));
  }
});

test("uiMode rule", () => {
  assert.equal(uiModeOf({ age: 12, literacy: "easy" }).mode, "picture");
  assert.equal(uiModeOf({ age: 20, literacy: "helped" }).mode, "picture");
  assert.equal(uiModeOf({ age: 15, literacy: "easy" }).mode, "mixed");
  assert.equal(uiModeOf({ age: 19, literacy: "little" }).mode, "mixed");
  assert.equal(uiModeOf({ age: 19, literacy: "easy" }).mode, "voice_text");
  assert.equal(uiModeOf({}).mode, "mixed");
  assert.equal(ageFromBirthYear(2010, new Date("2026-06-01")), 16);
});

test("interest check keeps only real letters with real quotes", () => {
  const said = "I love fixing my father's motor and I like drawing kolams";
  const { kept, dropped } = checkInterests([
    { letter: "R", tag: "repair", evidence: "fixing my father's motor", strength: 0.8 },
    { letter: "A", tag: "art", evidence: "drawing kolams" },
    { letter: "S", tag: "help", evidence: "teaching children" }, // never said
    { letter: "X", tag: "bad", evidence: "motor" },
  ], said);
  assert.deepEqual(kept.map((k) => k.letter), ["R", "A"]);
  assert.equal(dropped.length, 2);
  assert.deepEqual(riasecFromClaims(kept), { R: 0.8, I: 0, A: 0.6, S: 0, E: 0, C: 0 });
  assert.equal(riasecFromClaims([]), undefined);
});

test("interest keywords work in Tamil, Hindi and English", () => {
  assert.ok(interestsFromKeywords("I want to run a shop").some((c) => c.letter === "E"));
  assert.ok(interestsFromKeywords("எனக்கு ஓவியம் பிடிக்கும்").some((c) => c.letter === "A"));
  assert.ok(interestsFromKeywords("मुझे बच्चों को पढ़ाना पसंद है").some((c) => c.letter === "S"));
  assert.deepEqual(interestsFromKeywords(""), []);
});

const OPP: Opportunity = {
  id: "opp_test", kind: "internship", title: { en: "Test" }, org: "X", org_type: "company",
  needs: [{ id: "ss_digital_apps", level: 2 }, { id: "ss_money_counting", level: 2 }], min_age: 18, apply: { mode: "in_app" },
};
const strong = [0, 0.1, 0.5, 0.4];

test("readiness: hard checks and skill share", () => {
  const both = { ss_digital_apps: strong, ss_money_counting: strong };
  assert.equal(opportunityReadiness(kb, OPP, { levels: both, facts: {}, age: 19 }).status, "ready");
  assert.equal(opportunityReadiness(kb, OPP, { levels: both, facts: {}, age: 16 }).status, "later"); // too young
  assert.equal(opportunityReadiness(kb, OPP, { levels: { ss_digital_apps: strong }, facts: {}, age: 19 }).status, "almost");
  assert.equal(opportunityReadiness(kb, OPP, { levels: {}, facts: {}, age: 19 }).status, "later");
  const r = opportunityReadiness(kb, OPP, { levels: { ss_digital_apps: strong }, facts: {}, age: 19 });
  assert.deepEqual(r.gaps, ["ss_money_counting"]);
  const ranked = rankOpportunities(kb, [{ ...OPP, id: "b", min_age: 30 }, OPP], { levels: both, facts: {}, age: 19 });
  assert.equal(ranked[0].opp.id, "opp_test");
});

test("person graph links skills, careers and opportunities", () => {
  const profile = { units: { ss_stitch_machine: { id: "ss_stitch_machine", p: strong, level: 3, confidence: 0.9, strong: true, performance: true, paid: false, n: 3, last_at: 0, history: [] } }, aptitude: {} };
  const careers = scoreAllV2(kb, { education: "class10", riasec: { A: 1 }, levels: { ss_stitch_machine: strong } });
  const g = personGraph({ kb, name: "Meena", profile, careers, riasec: { A: 1, R: 0.2 }, opportunities: [] });
  const ids = new Set(g.nodes.map((n) => n.id));
  assert.ok(ids.has("me") && ids.has("ss_stitch_machine") && ids.has("int:A"));
  assert.ok(!ids.has("int:R")); // under half her top interest
  assert.ok(g.edges.every((e) => ids.has(e.from) && ids.has(e.to)));
  assert.equal(g.nodes.filter((n) => n.kind === "career").length, 5);
});

test("registry covers every rule file with a unique id", () => {
  const reg = registryOf(kb);
  assert.equal(new Set(reg.map((r) => r.id)).size, reg.length);
  for (const rid of Object.keys(kb.rules)) assert.ok(reg.some((r) => r.id === `rule.${rid}`));
  for (const r of reg.filter((x) => x.kind === "ai")) assert.ok(r.checked_by, `${r.id} must name its check`);
});
