// Every rule file carries example students ("fixtures"). Check each rule gives the expected answer.

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyRule, check, evaluateAll, mmrRerank, scoreAll, SECTORS, UNKNOWN } from "../src/index.ts";
import { pyRound, pySum } from "../src/pymath.ts";
import { loadKb } from "./loadKb.ts";

const kb = loadKb();

test("rule fixtures", () => {
  for (const rule of Object.values(kb.rules)) {
    assert.ok((rule.fixtures ?? []).length >= 2, `${rule.id}: needs at least 2 fixtures`);
    for (const { facts, expected } of rule.fixtures ?? []) {
      assert.equal(check(kb, rule.id, facts).status, expected, `${rule.id} ${JSON.stringify(facts)}`);
    }
  }
});

test("every rule has an updated date and notes", () => {
  for (const rule of Object.values(kb.rules)) {
    assert.match(rule.updated ?? "", /^\d{4}-\d{2}-\d{2}$/, rule.id);
    assert.ok(rule.notes, rule.id);
  }
});

test("unknown facts only matter when they could change the answer", () => {
  // A college student is clearly not in Class 8, so NMMS is a plain no, not "need more info".
  assert.equal(check(kb, "sch_nmms", { stage: "ug", current_class: null, school_type: "govt", family_income_inr: 900000 }).status, "not_eligible");
  assert.equal(applyRule({ and: [{ var: "x" }, false] }, {}), false);
  assert.equal(applyRule({ or: [{ var: "x" }, true] }, {}), true);
  assert.equal(applyRule({ and: [{ var: "x" }, true] }, {}), UNKNOWN);
});

test("Meena (Class 10, SC, govt school girl) sees schemes now and after a diploma", () => {
  const meena = { age: 16, gender: "female", state: "TN", category: "sc", current_class: 10, passed_class: 9,
    stage: "school", school_type: "govt", school_6_to_12: "govt", tamil_medium: true, family_income_inr: 90000 };
  const res = Object.fromEntries(evaluateAll(kb, meena).map((r) => [r.scheme_id, r]));
  assert.equal(res.sch_pre_matric_sc.status, "eligible");
  assert.equal(res.opp_naps_apprenticeship.status, "eligible");
  assert.deepEqual(res.sch_pudhumai_penn.eligible_if, { stage: "iti", course_type: "technical" });
  assert.deepEqual(res.sch_pragati.eligible_if, { stage: "diploma", course_type: "technical" });
  assert.ok(res.sch_post_matric_sc.eligible_if);
});

test("every scheme has a rule and every rule has a scheme", () => {
  assert.deepEqual(Object.keys(kb.schemes).sort(), Object.keys(kb.rules).sort());
});

test("missing facts give need_info, not a silent no", () => {
  const res = check(kb, "sch_pudhumai_penn", { gender: "female", state: "TN" });
  assert.equal(res.status, "need_info");
  assert.deepEqual(res.missing_facts, ["school_6_to_12", "stage"]);
});

test("knowledge base references are valid", () => {
  for (const occ of Object.values(kb.occupations)) {
    assert.ok(SECTORS.includes(occ.sector), `${occ.id}: unknown sector ${occ.sector}`);
    assert.match(occ.riasec, /^[RIASEC]{1,3}$/, occ.id);
    for (const s of occ.skills) assert.ok(kb.skills[s.id], `${occ.id}: unknown skill ${s.id}`);
  }
});

test("top 8 careers cover at least 4 sectors", () => {
  const top = mmrRerank(kb, scoreAll(kb, { skills: [{ id: "sk_stitching", confidence: 1 }] }));
  assert.equal(top.length, 8);
  assert.ok(new Set(top.map((c) => c.sector)).size >= 4);
});

test("python number helpers", () => {
  assert.equal(pyRound(0.03125, 4), 0.0312); // exact tie -> even
  assert.equal(pyRound(0.03135, 4), 0.0314); // not an exact tie in binary
  assert.equal(pyRound(2.675, 2), 2.67); // 2.675 is stored as 2.67499...
  assert.equal(pySum([0.1, 0.2, 0.3]), 0.6); // plain JS gives 0.6000000000000001
});
