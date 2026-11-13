import assert from "node:assert/strict";
import { test } from "node:test";
import { aptitudeNeedsOf, needsOf, relatedOf, skillOf, subskillsOf } from "../src/index.ts";
import { loadKb } from "./loadKb.ts";

const kb = loadKb();
const g = kb.graph!;

test("graph loads every sub-skill and aptitude", () => {
  assert.equal(Object.keys(g.subskills).length, 32);
  assert.deepEqual(Object.keys(g.aptitudes), ["apt_spatial", "apt_numeric", "apt_mechanical"]);
  assert.deepEqual(subskillsOf(g, "sk_stitching"), ["ss_stitch_measure", "ss_stitch_cutting", "ss_stitch_machine", "ss_stitch_fitting"]);
});

test("every career has needs and aptitudes", () => {
  for (const occ of Object.keys(kb.occupations)) {
    assert.ok(needsOf(g, occ).length >= 3, occ);
    assert.ok(aptitudeNeedsOf(g, occ).length >= 1, occ);
  }
  const elec = needsOf(g, "occ_electrician").find((n) => n.id === "ss_elec_safety");
  assert.deepEqual(elec, { id: "ss_elec_safety", level: 3, weight: 1 });
});

test("related links go both ways", () => {
  for (const [id, list] of Object.entries(g.related)) {
    assert.ok(list.length >= 1, id);
    for (const r of list) assert.ok(relatedOf(g, r.id).some((x) => x.id === id && x.weight === r.weight));
  }
});

test("needs point at real skills or sub-skills", () => {
  for (const list of Object.values(g.needs)) {
    for (const n of list) assert.ok(n.id in g.subskills || n.id in kb.skills, n.id);
  }
  assert.equal(skillOf(g, "ss_cook_costing"), "sk_cooking");
  assert.equal(skillOf(g, "sk_driving"), "sk_driving");
});
