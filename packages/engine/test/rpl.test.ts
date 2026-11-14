import assert from "node:assert/strict";
import { test } from "node:test";
import { rplOpportunities } from "../src/index.ts";
import { loadKb } from "./loadKb.ts";

const kb = loadKb();

test("only a level-4 sub-skill that a qualification assesses opens RPL", () => {
  assert.deepEqual(rplOpportunities(kb, { ss_stitch_machine: { level: 3 } }, false), []);
  // Selling at level 4 is not tailoring: no Self Employed Tailor certification.
  assert.deepEqual(rplOpportunities(kb, { ss_sell_customer: { level: 4 } }, false), []);
  const out = rplOpportunities(kb, { ss_stitch_machine: { level: 4 } }, false);
  assert.deepEqual(out.map((x) => [x.occupation, x.rpl.qp_code, x.status]).sort(),
    [["occ_boutique_owner", "AMH/Q1947", "eligible"], ["occ_sewing_machine_operator", "AMH/Q0301", "eligible"]]);
});

test("under 18 must wait until 18", () => {
  const out = rplOpportunities(kb, { sk_machine_repair: { level: 4 } }, true);
  assert.deepEqual(out.map((x) => [x.rpl.qp_code, x.status]), [["ASC/Q1411", "at18"]]);
});
