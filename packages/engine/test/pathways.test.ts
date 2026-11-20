import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  abilities, buildPathways, doors, dueCards, monthsToExam, readiness, review, shortestRoute, startOf,
  streamOptions, studyPlan, type SubjectItem,
} from "../src/index.ts";
import { KB_DIR } from "./loadKb.ts";

const read = (f: string) => JSON.parse(readFileSync(join(KB_DIR, "pathways", f), "utf-8"));
const graph = read("graph.json");
const pw = buildPathways({ nodes: graph.nodes, edges: graph.edges, exams: read("exams.json"), tracks: read("tracks.json"), subjects: read("subjects.json") });
const items: Record<string, SubjectItem> = Object.fromEntries((read("items.json") as SubjectItem[]).map((i) => [i.id, i]));
const track = (id: string) => pw.tracks.find((t) => t.id === id)!;
const door = (ds: ReturnType<typeof doors>, id: string) => ds.find((d) => d.track.id === id)!;

test("every track is reachable from Class 10", () => {
  const ds = doors(pw, startOf("10"), 15);
  for (const d of ds) assert.equal(d.status, "open", d.track.id);
});

test("Class 10 to doctor goes through a biology group and takes 1 + 2 + 5.5 years", () => {
  const r = shortestRoute(pw, startOf("10"), ["mbbs"])!;
  assert.equal(r.years, 8.5);
  assert.ok(["c12_pcb", "c12_pcmb"].includes(r.steps[0].to));
  assert.deepEqual(door(doors(pw, startOf("10")), "trk_doctor").via.sort(), ["c12_pcb", "c12_pcmb"]);
});

test("choosing a group closes doors: no Maths means no engineering, no Biology means no MBBS", () => {
  const pcb = doors(pw, startOf("11", "pcb"));
  assert.equal(door(pcb, "trk_engineer").status, "closed");
  assert.equal(door(pcb, "trk_doctor").status, "open");
  const commerce = doors(pw, startOf("12", "commerce"));
  assert.equal(door(commerce, "trk_doctor").status, "closed");
  assert.equal(door(commerce, "trk_ca").status, "open");
  assert.equal(door(commerce, "trk_data").status, "open"); // IIT Madras BS takes any group
});

test("a diploma student reaches engineering by lateral entry", () => {
  const r = shortestRoute(pw, startOf("diploma", undefined, 2), ["btech"])!;
  assert.deepEqual(r.steps.map((e) => e.to), ["btech"]);
  assert.equal(r.years, 5); // 2 diploma years left + 3
});

test("the NDA age limit is checked while searching", () => {
  assert.equal(door(doors(pw, startOf("12", "pcm"), 17), "trk_defence").status, "open");
  assert.equal(door(doors(pw, startOf("12", "pcm"), 19), "trk_defence").status, "age");
});

test("a commerce graduate skips CA Foundation", () => {
  const r = shortestRoute(pw, startOf("ug", "ug_commerce", 3), ["ca"])!;
  assert.deepEqual(r.steps.map((e) => e.to), ["ca"]);
});

test("unknown group in Class 11 asks for it", () => {
  assert.deepEqual(startOf("11"), { node: "c10", years: 0, needs: "stream" });
  assert.equal(startOf("ug").needs, "degree");
});

test("the Biology + Maths group keeps the most doors open", () => {
  const opts = streamOptions(pw);
  assert.equal(opts[0].node, "c12_pcmb");
  assert.equal(opts[0].open.length, pw.tracks.length);
  const commerce = opts.find((o) => o.node === "c12_commerce")!;
  assert.ok(!commerce.open.includes("trk_doctor"));
});

test("abilities use only the latest answer to each question", () => {
  const once = abilities([{ item: "aim_mat_02", correct: true, at: 1 }], items);
  const again = abilities([{ item: "aim_mat_02", correct: false, at: 0 }, { item: "aim_mat_02", correct: true, at: 1 }], items);
  assert.deepEqual(once, again);
  assert.equal(once.maths.n, 1);
  assert.ok(once.maths.theta > 0);
});

test("readiness grows with time to study and points at the weakest heavy subject", () => {
  const ab = { biology: { theta: 1.5, se: 0.4, n: 6 }, chemistry: { theta: 1.2, se: 0.4, n: 6 }, physics: { theta: -0.8, se: 0.4, n: 6 } };
  const doc = track("trk_doctor");
  const soon = readiness(doc, ab, 0);
  const later = readiness(doc, ab, 24);
  assert.ok(later.p > soon.p);
  assert.equal(soon.focus, "physics");
  assert.equal(soon.measured, 3);
  assert.equal(soon.needed, 4);
});

test("months to exam stop at the first step that has an entrance", () => {
  const start = startOf("10");
  assert.equal(monthsToExam(start, shortestRoute(pw, start, ["mbbs"])), 36); // finish Class 10, then 11–12
});

test("the study plan respects prerequisites and fits the weeks", () => {
  const plan = studyPlan(pw, track("trk_engineer"), {}, { weeks: 40, hoursPerWeek: 10 });
  const seq = plan.weeks.flatMap((w) => w.topics.map((t) => t.topic));
  const first = (id: string) => seq.indexOf(id);
  assert.ok(first("m_algebra") > first("m_arith"));
  assert.ok(first("m_calc") > first("m_trig") && first("m_calc") > first("m_quad"));
  assert.ok(first("p_energy") > first("p_force"));
  for (const w of plan.weeks) assert.ok(w.topics.reduce((s, t) => s + t.hours, 0) <= 8 + 1e-9, `week ${w.week}`);
  assert.equal(plan.weeks.length, 40);
});

test("mastered topics are skipped and a short plan says what did not fit", () => {
  const strong = studyPlan(pw, track("trk_engineer"), { maths: { theta: 3, se: 0.3, n: 7 } }, { weeks: 2, hoursPerWeek: 5 });
  assert.ok(strong.skipped.some((t) => t.topic === "m_arith"));
  assert.ok(strong.unplaced.length > 0);
});

test("Leitner: right moves up a box, wrong goes back to box 1", () => {
  let c = review(undefined, false, 100);
  assert.deepEqual(c, { box: 1, due: 101 });
  c = review(c, true, 101);
  assert.deepEqual(c, { box: 2, due: 103 });
  c = review(review(review(review(c, true, 103), true, 107), true, 115), true, 131);
  assert.equal(c.box, 5);
  assert.deepEqual(review(c, false, 140), { box: 1, due: 141 });
  assert.deepEqual(dueCards({ a: { box: 2, due: 5 }, b: { box: 1, due: 5 }, c: { box: 1, due: 9 } }, 6), ["b", "a"]);
});
