// IRT, the question picker and skill tracing must match the Python server (golden.json from gen_golden.py).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  eap, foldEvents, recommendV2, levelLikelihood, levelProbs, nextItem, prior, se, seededRandom, shouldStop, update,
  type EvidenceEvent, type ItemParams,
} from "../src/index.ts";
import { loadKb } from "./loadKb.ts";

const kb = loadKb();
const golden = JSON.parse(readFileSync(join(import.meta.dirname, "golden.json"), "utf-8"));
const TOL = 1e-9;

/** Deep equality, with numbers allowed to differ by TOL (Math.exp/pow may differ from C in the last bit). */
function close(actual: unknown, expected: unknown, path = "$"): void {
  if (typeof expected === "number") {
    assert.equal(typeof actual, "number", path);
    assert.ok(Math.abs((actual as number) - expected) <= TOL * Math.max(1, Math.abs(expected)), `${path}: ${actual} vs ${expected}`);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), path);
    assert.equal((actual as unknown[]).length, expected.length, `${path} length`);
    expected.forEach((x, i) => close((actual as unknown[])[i], x, `${path}[${i}]`));
  } else if (expected && typeof expected === "object") {
    assert.deepEqual(Object.keys(actual as object).sort(), Object.keys(expected).sort(), `${path} keys`);
    for (const k of Object.keys(expected)) close((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], `${path}.${k}`);
  } else {
    assert.equal(actual, expected, path);
  }
}

test("seeded random numbers match Python bit for bit", () => {
  const r = seededRandom(7);
  assert.deepEqual(golden.irt.random, Array.from({ length: 5 }, () => r()));
});

test("prior, ability updates and question picks match Python", () => {
  const g = golden.irt;
  close(prior(), g.prior);
  const bank: ItemParams[] = g.bank;
  const rand = seededRandom(g.session.seed);
  let post = prior();
  const seen = new Set<string>();
  const formats: string[] = [];
  for (const pick of g.session.picks) {
    assert.equal(shouldStop(post, seen.size, bank.length - seen.size), false);
    const item = nextItem(post, bank, seen, rand, formats)!;
    assert.equal(item.id, pick.id);
    post = update(post, item, pick.correct);
    seen.add(item.id);
    formats.push(item.format!);
    close(eap(post), pick.eap);
    close(se(post), pick.se);
  }
  assert.equal(shouldStop(post, seen.size, bank.length - seen.size), true);
  close(post, g.session.post);
  close(levelProbs(post, g.cuts), g.level_probs);
  close(levelLikelihood([{ item: bank[3], correct: true }, { item: bank[8], correct: true }, { item: bank[12], correct: false }], g.cuts),
    g.level_likelihood);
});

test("skill levels rebuilt from events match Python", () => {
  for (const c of golden.fold) {
    const result = foldEvents(c.events as EvidenceEvent[], kb.graph!, c.opts);
    close(result, c.result, c.name);
  }
});

test("worked example: Meena's machine stitching rises as stronger evidence arrives", () => {
  const at = (name: string) => golden.fold.find((c: { name: string }) => c.name === name).result.units;
  const said = at("meena_said").ss_stitch_machine;
  const photo = at("meena_photo").ss_stitch_machine;
  const teacher = at("meena_teacher").ss_stitch_machine;
  const orders = at("meena_orders").ss_stitch_machine;
  assert.equal(said.level, 2);
  assert.equal(said.strong, false);
  assert.equal(photo.level, 3);
  assert.ok(photo.confidence > 0.6 && photo.confidence < 0.8, `photo ${photo.confidence}`);
  assert.equal(photo.strong, false);
  assert.equal(teacher.strong, true);
  assert.ok(teacher.confidence >= 0.8);
  assert.equal(orders.level, 4); // paid work is what shows level 4
  // A test alone never makes a skill Strong.
  const test = at("meena_test").ss_stitch_fitting;
  assert.equal(test.strong, false);
  assert.equal(test.performance, false);
});

test("a tap taken back cancels the self-report; a lenient rater counts less", () => {
  const r = golden.fold.find((c: { name: string }) => c.name === "retraction").result.units;
  for (const id of ["ss_cook_hygiene", "ss_cook_quantity", "ss_cook_costing"]) {
    assert.equal(r[id].n, 0, id); // the cooking tap was taken back: no direct evidence left
  }
  assert.equal(r.ss_draw_colour.n, 2); // tap on drawing + family report on colour
  assert.equal(r.ss_teach_explain.level, 3); // a level-4 rating is capped below 4 without paid work
  assert.ok(r.ss_teach_explain.strong);
  assert.equal(r.sk_driving.level, 2); // endorsement from a low-weight rater: not Strong, still level 2
  assert.equal(r.sk_driving.strong, false);
});

test("Fit/Reach/Worth matching matches Python", () => {
  for (const { persona, result } of golden.recommend_v2) {
    close(recommendV2(kb, persona), result, JSON.stringify(persona).slice(0, 80));
  }
});
