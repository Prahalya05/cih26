import assert from "node:assert/strict";
import { test } from "node:test";
import { checkFollowup, checkPersonalised, isVague } from "../src/aichecks.ts";

const SHORT = ["occ_electrician", "occ_fashion_designer", "occ_nurse_anm"];
const QUOTES = ["I help my father fix motor pumps", "I love drawing kolams"];

test("AI order stays inside the shortlist and reasons must quote her", () => {
  const r = checkPersonalised({
    order: ["occ_nurse_anm", "occ_made_up", "occ_nurse_anm", "occ_electrician"],
    items: [{ id: "occ_electrician", why: "You fix pumps.", quote: "fix motor pumps" },
      { id: "occ_fashion_designer", why: "You draw.", quote: "I design dresses for film stars" }],
  }, SHORT, QUOTES);
  assert.deepEqual(r.order, ["occ_nurse_anm", "occ_electrician", "occ_fashion_designer"]);
  assert.deepEqual(Object.keys(r.why), ["occ_electrician"]);
  assert.ok(r.dropped.some((d) => d.reason === "not in the formula's shortlist"));
  assert.ok(r.dropped.some((d) => d.reason === "quote not found in what she said"));
});

test("server's checked map is accepted too", () => {
  const r = checkPersonalised({ order: SHORT, why: { occ_nurse_anm: { why: "x", quote: "" } } }, SHORT, QUOTES);
  assert.equal(r.why.occ_nurse_anm.why, "x");
});

test("follow-up rule", () => {
  assert.equal(checkFollowup("What do you do on Sundays").question, "What do you do on Sundays?");
  assert.equal(checkFollowup("What is your caste?").question, null);
  assert.equal(isVague("I don't know", 0, 0), true);
  assert.equal(isVague("I love fixing motors and drawing kolams with my sister", 2, 0), false);
  assert.equal(isVague("no", 0, 2), false);
});
