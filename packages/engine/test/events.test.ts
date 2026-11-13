import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ULID_RE, ulid, validateEvent, type EvidenceEvent } from "../src/index.ts";

const fx = JSON.parse(readFileSync(join(import.meta.dirname, "event_fixtures.json"), "utf-8"));

test("event validation matches the shared fixtures (Python checks the same file)", () => {
  for (const c of fx.cases) {
    const errs = validateEvent(c.e as EvidenceEvent, fx.now);
    assert.equal(errs.length === 0, c.ok, c.e.id + ": " + errs.join("; "));
  }
});

test("ULIDs are valid and sort by time", () => {
  const a = ulid(1_700_000_000_000);
  const b = ulid(1_700_000_000_001);
  assert.match(a, ULID_RE);
  assert.ok(a < b);
  assert.equal(ulid(0, () => 0), "0".repeat(26));
});
