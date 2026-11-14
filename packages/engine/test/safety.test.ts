import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { isMinor, safeRubric, type Rubric } from "../src/index.ts";
import { KB_DIR, loadKb } from "./loadKb.ts";

const g = loadKb().graph!;
const rubrics: Rubric[] = readdirSync(join(KB_DIR, "rubrics")).filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(KB_DIR, "rubrics", f), "utf-8")));
const hazardous = Object.values(g.subskills).filter((s) => s.hazardous_under_18).map((s) => s.id);

test("unknown or borderline birth year counts as under 18", () => {
  const now = new Date("2026-11-14");
  assert.equal(isMinor(undefined, now), true);
  assert.equal(isMinor(2010, now), true);
  assert.equal(isMinor(2008, now), true); // may still be 17
  assert.equal(isMinor(2007, now), false);
});

test("an under-18 is never given a work sample on a hazardous sub-skill", () => {
  assert.ok(hazardous.length > 0);
  for (const r of rubrics) {
    const safe = safeRubric(g, r, true);
    for (const c of safe?.criteria ?? []) assert.ok(!hazardous.includes(c.subskill ?? ""), `${r.id}/${c.id}`);
  }
});

test("adults get the whole checklist; safe items stay for under-18s", () => {
  const elec = rubrics.find((r) => r.id === "rb_electrical")!;
  assert.equal(safeRubric(g, elec, false), elec);
  const safe = safeRubric(g, elec, true)!;
  assert.ok(safe.criteria.length > 0 && safe.criteria.length < elec.criteria.length);
  const stitch = rubrics.find((r) => r.id === "rb_stitching")!;
  assert.deepEqual(safeRubric(g, stitch, true), stitch);
  const allHazard = { ...elec, criteria: elec.criteria.filter((c) => hazardous.includes(c.subskill ?? "")) };
  assert.equal(safeRubric(g, allHazard, true), null);
});
