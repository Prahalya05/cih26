// The demo stories (apps/web/src/lib/storyData.ts) end where the pitch says they do.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { STORIES, storyEvents } from "../../../apps/web/src/lib/storyData.ts";
import { foldEvents, personaFromProfile, scoreAllV2, type EvidenceEvent, type Rubric } from "../src/index.ts";
import { KB_DIR, loadKb } from "./loadKb.ts";

const kb = loadKb();
const items = Object.fromEntries(readdirSync(join(KB_DIR, "items")).filter((f) => f.endsWith(".json"))
  .flatMap((f) => JSON.parse(readFileSync(join(KB_DIR, "items", f), "utf-8"))).map((it: { id: string }) => [it.id, it]));
const rubrics: Record<string, Rubric> = Object.fromEntries(readdirSync(join(KB_DIR, "rubrics"))
  .map((f) => JSON.parse(readFileSync(join(KB_DIR, "rubrics", f), "utf-8"))).map((r: Rubric) => [r.id, r]));
const NOW = Date.UTC(2026, 10, 14);

/** What she said on day 0 (in the app this comes from her answers), then the story steps. */
function play(i: number, said: string[], upTo?: number) {
  const steps = STORIES[i].slice(0, upTo);
  const start = NOW - 42 * 86_400_000;
  const words: EvidenceEvent[] = said.map((skill, k) => ({ id: `01KA0000000000000000000${k}AA`.slice(0, 26), student_id: "s",
    device_id: "demo_phone", kind: "self_report", skill_id: skill, payload: { source: "voice", qid: "home" }, created_at: start + k }));
  const events = [...words, ...storyEvents("s", steps, NOW).flat()];
  return foldEvents(events, kb.graph!, { now: NOW, items, rubrics });
}

test("Meena: said -> test -> photo -> teacher -> paid orders; machine stitching ends at level 4", () => {
  const levels = [0, 1, 2, 3, 4, 5].map((k) => play(0, ["sk_stitching"], k).units.ss_stitch_machine);
  assert.equal(levels[0].level, 2);
  assert.ok(levels[4].strong, "Strong after the teacher confirms");
  assert.equal(levels[5].level, 4);
  assert.ok(levels[5].paid);
});

test("Karthik: claims nothing, strong machine puzzles open 'could learn' careers", () => {
  const p = play(1, []);
  assert.ok(p.aptitude.apt_mechanical.theta > 1, `theta ${p.aptitude.apt_mechanical.theta}`);
  const careers = scoreAllV2(kb, personaFromProfile(p, { education: "class10" }));
  const could = careers.filter((c) => c.could_learn).map((c) => c.occupation_id);
  assert.ok(could.length > 0);
});

test("Arun: says he prices goods; the test brings pricing down", () => {
  const said = play(3, ["sk_money_handling"], 0).units.ss_money_pricing;
  const tested = play(3, ["sk_money_handling"]).units.ss_money_pricing;
  assert.ok(tested.p[0] + tested.p[1] > said.p[0] + said.p[1], "more likely level 1-2 after the test");
  assert.equal(said.level, 2); // what he claimed
  assert.equal(tested.level, 1); // what the test showed
  assert.ok(!tested.strong);
});
