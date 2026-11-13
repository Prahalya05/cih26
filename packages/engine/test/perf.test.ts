import assert from "node:assert/strict";
import { test } from "node:test";
import { foldEvents, ulid, type EvidenceEvent } from "../src/index.ts";
import { loadKb } from "./loadKb.ts";

test("rebuilding levels from 2,000 events is fast enough for a phone", () => {
  const kb = loadKb();
  const subs = Object.keys(kb.graph!.subskills);
  const t0 = 1_762_000_000_000;
  const events: EvidenceEvent[] = [];
  for (let i = 0; i < 2000; i++) {
    const sub = subs[i % subs.length];
    const at = t0 + i * 3_600_000;
    events.push(i % 5 === 0
      ? { id: ulid(at), student_id: "s", device_id: "d", kind: "task", subskill_id: sub, payload: { score: (i % 10) / 10 }, created_at: at }
      : { id: ulid(at), student_id: "s", device_id: "d", kind: "item_response", subskill_id: sub, item_id: "q" + (i % 15),
          payload: { correct: i % 3 !== 0, ms: 5000, b: ((i % 15) - 7) / 4 }, created_at: at });
  }
  foldEvents(events, kb.graph!, { now: t0 + 2000 * 3_600_000 }); // warm up
  const start = performance.now();
  foldEvents(events, kb.graph!, { now: t0 + 2000 * 3_600_000 });
  const ms = performance.now() - start;
  console.log(`fold 2000 events: ${ms.toFixed(1)} ms on this machine`);
  assert.ok(ms < 200, `${ms} ms`); // a laptop; phones are 3-5x slower, target there is under a second
});
