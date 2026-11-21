import assert from "node:assert/strict";
import { test } from "node:test";
import { nextToTest, recommendV2, scoreAllV2, skillInterestFit, type PersonaV2 } from "../src/index.ts";
import { loadKb } from "./loadKb.ts";

const kb = loadKb();

test("shown skills raise Fit; untested sub-skills count half", () => {
  const none: PersonaV2 = { levels: {}, education: "class10" };
  const tailor: PersonaV2 = { levels: { ss_stitch_machine: [0, 0, 0.9, 0.1], ss_stitch_measure: [0, 0.1, 0.8, 0.1], ss_stitch_cutting: [0, 0.2, 0.7, 0.1] }, education: "class10" };
  const fit = (p: PersonaV2) => scoreAllV2(kb, p).find((c) => c.occupation_id === "occ_sewing_machine_operator")!.parts.fit;
  assert.ok(fit(tailor) > 0.8, String(fit(tailor)));
  assert.ok(fit(none) < 0.4, String(fit(none)));
});

test("strong mechanical aptitude marks mechanic as could-learn without any skill", () => {
  const p: PersonaV2 = { levels: {}, aptitude: { apt_mechanical: { theta: 1.8 }, apt_spatial: { theta: 1.5 } }, education: "class10" };
  const mech = scoreAllV2(kb, p).find((c) => c.occupation_id === "occ_two_wheeler_mechanic")!;
  assert.equal(mech.could_learn, true);
  const none = scoreAllV2(kb, { levels: {}, education: "class10" }).find((c) => c.occupation_id === "occ_two_wheeler_mechanic")!;
  assert.ok(mech.score > none.score);
});

test("next test: a sub-skill no career needs is never chosen first", () => {
  const p: PersonaV2 = { levels: { ss_stitch_machine: [0.2, 0.4, 0.3, 0.1] }, education: "class10" };
  const unused = Object.keys(kb.graph!.subskills).filter((id) => !Object.values(kb.graph!.needs).some((ns) => ns.some((x) => x.id === id)));
  const picks = nextToTest(kb, p, ["ss_stitch_machine", "ss_stitch_fitting", ...unused]);
  assert.ok(!unused.includes(picks[0].id), JSON.stringify(picks));
  assert.ok(recommendV2(kb, p).careers.length === 8);
});

test("skills follow her interests: people-minded puts teaching above wiring, hands-on the other way", () => {
  const social = skillInterestFit(kb, { S: 1, A: 0.6 })!;
  const handsOn = skillInterestFit(kb, { R: 1, I: 0.5 })!;
  assert.ok(social.sk_teaching_explaining > social.sk_electrical_basic);
  assert.ok(handsOn.sk_electrical_basic > handsOn.sk_teaching_explaining);
  assert.equal(skillInterestFit(kb, undefined), undefined); // no interests: no guessing
});
