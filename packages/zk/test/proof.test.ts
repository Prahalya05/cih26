// End-to-end: a credential signed by the Python issuer, proved with the real circuit, checked with the
// verification key. Also writes contracts/test/fixtures/proof.json for the Solidity tests.
// Needs the built circuit (npm run build:circuit -w packages/zk); skipped if it is missing.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as snarkjs from "snarkjs";
import { proveMilestone, readPublic, solidityArgs, type Credential, type Milestone, type SnarkJs } from "../src/index.ts";

const zkDir = new URL("../../../apps/web/public/zk/", import.meta.url);
const wasm = new URL("skill_proof.wasm", zkDir);
const zkey = new URL("skill_proof.zkey", zkDir);
const built = existsSync(wasm) && existsSync(zkey);
const fx = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"));
const cred = fx.credential as Credential;
const secret = BigInt(fx.holder_secret);
const order = cred.subskill_order;
const milestone: Milestone = { id: 1, subskill_index: order.indexOf("ss_stitch_machine"), min_level: 3, min_orders: 5, max_income_band: 1, required_gender: 1 };
const payout = 0x70997970c51812dc3a010c7d01b50e0d17dc79c8n; // an Anvil test account
const TODAY = 20_450;
const sj = snarkjs as unknown as SnarkJs;
const local = (u: URL) => decodeURIComponent(u.pathname).replace(/^\/([A-Za-z]:)/, "$1");
// snarkjs keeps worker threads for the curve; stop them so the test process can exit.
after(async () => { await (globalThis as { curve_bn128?: { terminate(): Promise<void> } }).curve_bn128?.terminate(); });

test("proves a milestone, the proof verifies, and the public signals say only what was asked", { skip: !built }, async () => {
  const vkey = JSON.parse(readFileSync(new URL("verification_key.json", zkDir), "utf8"));
  const out = await proveMilestone(sj, local(wasm), local(zkey),
    cred, secret, milestone, payout, TODAY);
  assert.ok(await sj.groth16.verify(vkey, out.publicSignals, out.proof));
  const pub = readPublic(out.publicSignals);
  assert.equal(pub.payout, payout.toString());
  assert.equal(pub.minOrders, "5");
  assert.ok(!out.publicSignals.includes(cred.fields.earned_inr), "earnings stay private");
  // a changed public signal (say, another payout address) must fail
  const moved = [...out.publicSignals];
  moved[10] = "1";
  assert.equal(await sj.groth16.verify(vkey, moved, out.proof), false);
  console.log(`# proving time on this machine: ${out.ms} ms`);

  const dir = new URL("../../../contracts/test/fixtures/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  const args = solidityArgs(out.proof);
  writeFileSync(new URL("proof.json", dir), JSON.stringify({
    a: args.a.map(String), b: args.b.map((r) => r.map(String)), c: args.c.map(String),
    publicSignals: out.publicSignals, milestone, payout: "0x" + payout.toString(16), today: TODAY,
  }, null, 1) + "\n");
});

test("cannot prove a milestone the credential does not meet", { skip: !built }, async () => {
  const p = (m: Milestone) => proveMilestone(sj, local(wasm), local(zkey), cred, secret, m, payout, TODAY);
  await assert.rejects(p({ ...milestone, min_orders: 6 }), "not enough orders");
  await assert.rejects(p({ ...milestone, min_level: 4, subskill_index: order.indexOf("ss_money_counting") }), "level too low");
  await assert.rejects(p({ ...milestone, required_gender: 2 }), "wrong group");
  await assert.rejects(proveMilestone(sj, local(wasm), local(zkey),
    { ...cred, fields: { ...cred.fields, orders: "9" } }, secret, milestone, payout, TODAY), "forged credential");
  await assert.rejects(proveMilestone(sj, local(wasm), local(zkey),
    cred, 999n, milestone, payout, TODAY), "someone else's secret");
});
