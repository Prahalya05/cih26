// The phone and the server must agree. golden.json is made by scripts/gen_golden.py from the Python code.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { evaluateAll, recommend } from "../src/index.ts";
import { loadKb } from "./loadKb.ts";

const kb = loadKb();
const golden = JSON.parse(readFileSync(join(import.meta.dirname, "golden.json"), "utf-8"));

test("career matching gives the same result as Python", () => {
  for (const { persona, result } of golden.recommend) {
    assert.deepEqual(recommend(kb, persona), result, JSON.stringify(persona));
  }
});

test("career matching with embeddings gives the same result as Python", () => {
  for (const { persona, embed_sims, result } of golden.recommend_embed) {
    assert.deepEqual(recommend(kb, persona, 8, embed_sims), result, JSON.stringify(persona));
  }
});

test("eligibility gives the same result as Python", () => {
  for (const { facts, result } of golden.eligibility) {
    assert.deepEqual(evaluateAll(kb, facts), result, JSON.stringify(facts));
  }
});
