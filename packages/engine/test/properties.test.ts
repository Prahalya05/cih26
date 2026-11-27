import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMAND,
  FRW_WEIGHTS,
  PRIOR,
  REACH_PARTS,
  UNKNOWN_LEVELS,
  WEIGHTS,
  WORTH_PARTS,
  eap,
  explainCareer,
  foldEvents,
  prior,
  scoreAllV2,
  update,
  type EvidenceEvent,
  type ItemParams,
  type PersonaV2,
} from "../src/index.ts";
import { loadKb } from "./loadKb.ts";

const kb = loadKb();
const NOW = 1_770_000_000_000;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

test("property: weights and priors sum to 1.0", () => {
  assert.ok(Math.abs(sum(PRIOR) - 1) < 1e-9);
  assert.ok(Math.abs(sum(UNKNOWN_LEVELS) - 1) < 1e-9);
  assert.ok(Math.abs(FRW_WEIGHTS.fit + FRW_WEIGHTS.reach + FRW_WEIGHTS.worth - 1) < 1e-9);
  assert.ok(Math.abs(REACH_PARTS.aptitude + REACH_PARTS.closeness + REACH_PARTS.education - 1) < 1e-9);
  assert.ok(Math.abs(WORTH_PARTS.interest + WORTH_PARTS.demand - 1) < 1e-9);
  assert.ok(Math.abs(WEIGHTS.embed + WEIGHTS.skill + WEIGHTS.riasec + WEIGHTS.feas - 1) < 1e-9);
  for (const d of Object.values(DEMAND)) {
    assert.ok(d >= 0 && d <= 1);
  }
});

test("property: IRT posteriors and tracing probabilities sum to 1 and are never NaN", () => {
  let post = prior();
  assert.ok(Math.abs(sum(post) - 1) < 1e-9);
  assert.ok(post.every((x) => Number.isFinite(x) && x >= 0));

  const items: ItemParams[] = [
    { id: "i1", a: 1.5, b: -2.0 },
    { id: "i2", a: 2.0, b: 0.0 },
    { id: "i3", a: 2.5, b: 2.0 },
  ];
  for (const correct of [true, false, true, true, false]) {
    for (const it of items) {
      post = update(post, it, correct);
      assert.ok(post.every((x) => Number.isFinite(x) && x >= 0));
      assert.ok(Math.abs(sum(post) - 1) < 1e-9);
    }
  }

  const events: EvidenceEvent[] = [
    { id: "e1", student_id: "s1", device_id: "d1", kind: "self_report", skill_id: "sk_stitch", payload: { source: "tap" }, created_at: NOW - 30 * 86_400_000 },
    { id: "e2", student_id: "s1", device_id: "d1", kind: "task", subskill_id: "ss_stitch_machine", payload: { score: 0.9 }, created_at: NOW - 20 * 86_400_000 },
    { id: "e3", student_id: "s1", device_id: "d1", kind: "work_sample", skill_id: "sk_stitch", payload: { scorer: "ai", rubric_id: "rub_stitch", scores: { c1: 2, c2: 1 } }, created_at: NOW - 10 * 86_400_000 },
    { id: "e4", student_id: "s1", device_id: "d1", kind: "order", skill_id: "sk_stitch", subskill_id: "ss_stitch_machine", payload: { amount_inr: 300 }, created_at: NOW - 5 * 86_400_000 },
    { id: "e5", student_id: "s1", device_id: "d1", kind: "rating", skill_id: "sk_stitch", refers_to: "e4", rater_id: "b1", payload: { quality: true, rehire: true }, created_at: NOW - 2 * 86_400_000 },
  ];
  const prof = foldEvents(events, kb.graph!, { now: NOW });
  for (const u of Object.values(prof.units)) {
    assert.equal(u.p.length, 4);
    assert.ok(u.p.every((x) => Number.isFinite(x) && x >= 0 && x <= 1));
    assert.ok(Math.abs(sum(u.p) - 1) < 1e-9);
    assert.ok(Number.isFinite(u.confidence) && u.confidence >= 0.5 && u.confidence <= 1);
  }
});

test("property: more correct answers never lower IRT theta or traced level", () => {
  const item: ItemParams = { id: "q1", a: 1.4, b: 0.2 };
  const p0 = prior();
  const pRight = update(p0, item, true);
  const pWrong = update(p0, item, false);
  assert.ok(eap(pRight) >= eap(p0));
  assert.ok(eap(pRight) >= eap(pWrong));

  const mkAnswers = (nCorrect: number, total: number): EvidenceEvent[] =>
    Array.from({ length: total }, (_, idx) => ({
      id: `q_${idx}`,
      student_id: "s1",
      device_id: "d1",
      kind: "item_response",
      subskill_id: "ss_stitch_machine",
      item_id: `it_${idx}`,
      payload: { correct: idx < nCorrect, a: 1.2, b: -0.5 + idx * 0.4 },
      created_at: NOW + idx * 1000,
    }));

  let prevLevel = 1;
  for (let c = 0; c <= 6; c++) {
    const prof = foldEvents(mkAnswers(c, 6), kb.graph!, { now: NOW + 10_000 });
    const lvl = prof.units.ss_stitch_machine.level;
    assert.ok(lvl >= prevLevel, `expected level(${c})=${lvl} >= level(${c - 1})=${prevLevel}`);
    prevLevel = lvl;
  }
});

test("property: a good confirmed order never lowers a level", () => {
  const baseScenarios: EvidenceEvent[][] = [
    [],
    [{ id: "b1", student_id: "s1", device_id: "d1", kind: "self_report", subskill_id: "ss_stitch_machine", payload: { source: "tap" }, created_at: NOW - 10_000 }],
    [{ id: "b2", student_id: "s1", device_id: "d1", kind: "task", subskill_id: "ss_stitch_machine", payload: { score: 0.9 }, created_at: NOW - 10_000 }],
    [{ id: "b3", student_id: "s1", device_id: "d1", kind: "rating", subskill_id: "ss_stitch_machine", rater_id: "t1", payload: { level: 3 }, created_at: NOW - 10_000 }],
  ];
  for (const base of baseScenarios) {
    const before = foldEvents(base, kb.graph!, { now: NOW }).units.ss_stitch_machine?.level ?? 1;
    const withOrder: EvidenceEvent[] = [
      ...base,
      { id: "o1", student_id: "s1", device_id: "d1", kind: "order", skill_id: "sk_stitch", subskill_id: "ss_stitch_machine", payload: { amount_inr: 250 }, created_at: NOW - 2000 },
      { id: "r1", student_id: "s1", device_id: "d1", kind: "rating", skill_id: "sk_stitch", refers_to: "o1", rater_id: "buyer1", payload: { quality: true, rehire: true }, created_at: NOW - 1000 },
    ];
    const after = foldEvents(withOrder, kb.graph!, { now: NOW }).units.ss_stitch_machine.level;
    assert.ok(after >= before, `after=${after} < before=${before}`);
  }
});

test("property: fitreach parts stay in [0, 1]", () => {
  const personas: PersonaV2[] = [
    { levels: {} },
    { education: "class8", riasec: {}, levels: { ss_stitch_machine: [1, 0, 0, 0] }, aptitude: { apt_spatial: { theta: -4 } } },
    { education: "ug", riasec: { R: 1, I: 1, A: 1, S: 1, E: 1, C: 1 }, levels: { ss_stitch_machine: [0, 0, 0, 1] }, aptitude: { apt_spatial: { theta: 4 } } },
  ];
  for (const p of personas) {
    const scored = scoreAllV2(kb, p);
    for (const c of scored) {
      assert.ok(c.score >= 0 && c.score <= 1 && Number.isFinite(c.score));
      assert.ok(c.parts.fit >= 0 && c.parts.fit <= 1);
      assert.ok(c.parts.reach >= 0 && c.parts.reach <= 1);
      assert.ok(c.parts.worth >= 0 && c.parts.worth <= 1);
      assert.ok(c.parts.aptitude >= 0 && c.parts.aptitude <= 1);
      const d = explainCareer(kb, p, c.occupation_id)!;
      assert.ok(d.reach.education >= 0 && d.reach.education <= 1);
      assert.ok(d.reach.closeness >= 0 && d.reach.closeness <= 1);
      assert.ok(d.worth.interest >= 0 && d.worth.interest <= 1);
      assert.ok(d.worth.demand >= 0 && d.worth.demand <= 1);
    }
  }
});

test("property: level-4 cap for unpaid evidence holds", () => {
  const unpaid: EvidenceEvent[] = [];
  for (let i = 0; i < 15; i++) {
    unpaid.push({
      id: `t_${i}`,
      student_id: "s1",
      device_id: "d1",
      kind: "task",
      subskill_id: "ss_stitch_machine",
      payload: { score: 1.0 },
      created_at: NOW - (20 - i) * 1000,
    });
    unpaid.push({
      id: `r_${i}`,
      student_id: "s1",
      device_id: "d1",
      kind: "rating",
      subskill_id: "ss_stitch_machine",
      rater_id: `t_${i}`,
      payload: { level: 4 },
      created_at: NOW - (20 - i) * 1000 + 100,
    });
  }
  const prof = foldEvents(unpaid, kb.graph!, { now: NOW });
  const u = prof.units.ss_stitch_machine;
  assert.equal(u.paid, false);
  assert.ok(u.p[3] <= 0.4 + 1e-9, `expected p[3] <= 0.4, got ${u.p[3]}`);
  assert.ok(u.level <= 3, `expected unpaid level <= 3, got ${u.level}`);
});

test("property: rater leniency is off by default and shifts inflated ratings when enabled", () => {
  const ev: EvidenceEvent[] = [
    { id: "r1", student_id: "s1", device_id: "d1", kind: "rating", subskill_id: "ss_stitch_machine", rater_id: "t_len", payload: { level: 3 }, created_at: NOW - 1000 },
  ];
  const offDefault = foldEvents(ev, kb.graph!, { now: NOW, raterLeniency: { t_len: 1.2 } });
  const offExplicit = foldEvents(ev, kb.graph!, { now: NOW, raterLeniency: { t_len: 1.2 }, applyLeniency: false });
  assert.deepEqual(offDefault.units.ss_stitch_machine.p, offExplicit.units.ss_stitch_machine.p);

  const on = foldEvents(ev, kb.graph!, { now: NOW, raterLeniency: { t_len: 1.2 }, applyLeniency: true });
  assert.ok(on.units.ss_stitch_machine.p[2] < offDefault.units.ss_stitch_machine.p[2]);
  assert.ok(on.units.ss_stitch_machine.level <= offDefault.units.ss_stitch_machine.level);
});

test("property: unverified self-confirm order stays capped below level 4; teacher-verified order unlocks level 4", () => {
  const orderEv: EvidenceEvent = {
    id: "o_self", student_id: "s1", device_id: "d1", kind: "order",
    skill_id: "sk_stitch", subskill_id: "ss_stitch_machine", payload: { amount_inr: 300 }, created_at: NOW - 5000,
  };
  const selfRated = foldEvents([
    orderEv,
    { id: "r_self", student_id: "s1", device_id: "buyer_link", kind: "rating", skill_id: "sk_stitch",
      refers_to: "o_self", rater_id: "buyer_1", payload: { on_time: true, quality: true, rehire: true, unverified: true, self_confirm: true }, created_at: NOW - 1000 },
  ], kb.graph!, { now: NOW });
  assert.equal(selfRated.units.ss_stitch_machine.paid, false);
  assert.ok(selfRated.units.ss_stitch_machine.p[3] <= 0.4 + 1e-9);

  const teacherVerified = foldEvents([
    orderEv,
    { id: "r_teach", student_id: "s1", device_id: "d_t", kind: "rating", skill_id: "sk_stitch",
      refers_to: "o_self", rater_id: "t1", payload: { on_time: true, quality: true, rehire: true, verified_by: "teacher", method: "phoned buyer", reason: "Called buyer" }, created_at: NOW - 1000 },
  ], kb.graph!, { now: NOW });
  assert.equal(teacherVerified.units.ss_stitch_machine.paid, true);
  assert.ok(teacherVerified.units.ss_stitch_machine.p[3] > selfRated.units.ss_stitch_machine.p[3]);
});
