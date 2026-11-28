import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCheck, applyOverrides, autoConfirm, drawFromId, identityCheck, payCheck, trustScore, TRUST_RULE, type EvidenceEvent, type Profile } from "../src/index.ts";

const unit = (level: number, strong = false) => ({ id: "ss_x", p: [0.1, 0.2, 0.3, 0.4], level, confidence: 0.7, strong, performance: true, paid: false, n: 3, last_at: 0, history: [] });
const ov = (level: number, at: number, id = `01KA0000000000000000000${at}`): EvidenceEvent => ({
  id, student_id: "s", device_id: "t", kind: "rating", subskill_id: "ss_x", rater_id: "r_t", created_at: at,
  payload: { level, override: true, reason: "watched her do it in class" },
});

test("override: latest wins, raising is marked up and never makes strong", () => {
  const p: Profile = { units: { ss_x: unit(2) }, aptitude: {} };
  const out = applyOverrides(p, [ov(1, 1), ov(4, 2)]);
  assert.equal(out.units.ss_x.level, 4);
  assert.equal(out.units.ss_x.override?.up, true);
  assert.equal(out.units.ss_x.override?.from, 2);
  assert.equal(out.units.ss_x.strong, false);
  const down = applyOverrides({ units: { ss_x: unit(3, true) }, aptitude: {} }, [ov(2, 1)]);
  assert.equal(down.units.ss_x.level, 2);
  assert.equal(down.units.ss_x.override?.up, false);
});

test("identity: needs liveness and enough matching frames", () => {
  const ok = identityCheck({ enrolled: true, distances: [0.3, 0.4, 0.45, 0.6], sampled: 5, liveness: { asked: 3, seen: 3 } });
  assert.equal(ok.status, "verified");
  assert.equal(identityCheck({ enrolled: true, distances: [0.7, 0.8], sampled: 5, liveness: { asked: 3, seen: 3 } }).status, "mismatch");
  assert.equal(identityCheck({ enrolled: true, distances: [0.3, 0.3, 0.3], sampled: 3, liveness: { asked: 2, seen: 4 } }).status, "mismatch");
  assert.equal(identityCheck({ enrolled: false, distances: [], sampled: 3, liveness: null }).status, "unknown");
});

test("auto-confirm: every check, then spot checks", () => {
  const base = { identity: "verified" as const, integrity_flags: [], safety_flags: 0, cannot_see: 0, criteria: 5, ai_kappa: 0.72, audit_draw: 0.5 };
  assert.equal(autoConfirm(base).decision, "auto_confirm");
  assert.equal(autoConfirm({ ...base, audit_draw: 0.05 }).decision, "teacher");
  assert.equal(autoConfirm({ ...base, identity: "unknown" }).decision, "teacher");
  assert.equal(autoConfirm({ ...base, ai_kappa: null }).decision, "teacher");
  assert.equal(autoConfirm({ ...base, cannot_see: 2 }).decision, "teacher");
  const d = drawFromId("01KA00000000000000000000AB");
  assert.ok(d >= 0 && d < 1 && d === drawFromId("01KA00000000000000000000AB"));
});

test("pay check: an override up is not proof; need must be verified", () => {
  const base = { skill: { unit: "ss_x", level: 3, needLevel: 3, performance: true, overriddenUp: false }, income_inr: 90000,
    verified_docs: ["income_certificate"], consent_share: true, identity: "verified" as const, already_paid: false };
  assert.equal(payCheck(base).ok, true);
  assert.equal(payCheck({ ...base, skill: { ...base.skill, overriddenUp: true } }).ok, false);
  assert.equal(payCheck({ ...base, verified_docs: [] }).checks.find((c) => c.name === "need")?.ok, null);
  assert.equal(payCheck({ ...base, income_inr: 900000 }).checks.find((c) => c.name === "need")?.ok, false);
  assert.equal(payCheck({ ...base, already_paid: true }).ok, false);
});

test("apply check: docs verified and not Later", () => {
  assert.equal(applyCheck("internship", "ready", { resume: "verified", id_proof: "verified" }).ok, true);
  assert.equal(applyCheck("internship", "ready", { resume: "verified", id_proof: "uploaded" }).ok, false);
  assert.equal(applyCheck("internship", "later", { resume: "verified", id_proof: "verified" }).ok, false);
});

test("course suggestion: skill below what a top career needs, or an Almost gap", async () => {
  const { recommendCourses } = await import("../src/index.ts");
  const g = { subskills: { ss_x: { id: "ss_x", skill: "sk_x" } }, aptitudes: {}, bySkill: { sk_x: ["ss_x"] },
    needs: { occ_a: [{ id: "ss_x", level: 3, weight: 1 }] }, aptitudeNeeds: {}, related: {} } as never;
  const c = { id: "c1", title: "X", skill_id: "ss_x", plan: "free" as const, price_inr: 0 };
  assert.equal(recommendCourses(g, [c], { ss_x: unit(2) }, [{ id: "occ_a", name: "A" }], []).length, 1);
  assert.equal(recommendCourses(g, [c], { ss_x: unit(3) }, [{ id: "occ_a", name: "A" }], []).length, 0);
  assert.equal(recommendCourses(g, [c], {}, [], [{ opp: "Intern", gaps: ["ss_x"] }])[0].reason, "opportunity");
});

test("trust score: points off per warning, each kind capped, never below 0", () => {
  assert.deepEqual(trustScore({}), { score: 100, band: "high", minus: {}, why: ["start at 100", "= 100 (high)"] });
  assert.equal(trustScore({ screen: 1 }).score, 75);
  assert.equal(trustScore({ screen: 5 }).score, 50); // screens take off at most 50
  assert.equal(trustScore({ no_hands: 2, dark: 1 }).score, 85);
  assert.equal(trustScore({ no_hands: 2, dark: 1 }).band, "high");
  assert.equal(trustScore({ uploaded: 1 }).band, "medium"); // a gallery video is never "high" on its own
  const worst = trustScore(Object.fromEntries(Object.keys(TRUST_RULE.penalty).map((k) => [k, 99])));
  assert.equal(worst.score, 0);
  assert.equal(worst.band, "low");
});

test("trust score: in a long video, small warnings count per 10 minutes; serious ones do not", () => {
  assert.equal(trustScore({ no_hands: 6 }, 3600).score, 95); // 6 in an hour = 1 per 10 min
  assert.equal(trustScore({ no_hands: 6 }).score, 80); // the same 6 in a short video
  assert.equal(trustScore({ screen: 2 }, 3600).score, 50); // a screen counts every time, however long
  assert.equal(trustScore({ no_hands: 4 }, 600).score, 80); // 10 minutes or less: counted as they are
});

test("trust score: bad counts are ignored, not trusted", () => {
  assert.equal(trustScore({ screen: -2, dark: Number.NaN, multi_face: "3", unknown: 9 }).score, 100);
  assert.equal(trustScore({ no_hands: 2.9 }).minus.no_hands, 10); // whole times only
});

test("auto-confirm: a low trust score sends the video to the teacher", () => {
  const base = { identity: "verified" as const, integrity_flags: [], safety_flags: 0, cannot_see: 0, criteria: 5, ai_kappa: 0.72, audit_draw: 0.5 };
  assert.equal(autoConfirm({ ...base, trust_score: 90 }).decision, "auto_confirm");
  assert.equal(autoConfirm({ ...base, trust_score: 75 }).decision, "teacher");
  assert.equal(autoConfirm({ ...base, trust_score: null }).decision, "auto_confirm"); // photos have no trust score
});
