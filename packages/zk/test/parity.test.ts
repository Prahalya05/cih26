// Three implementations must agree: circomlibjs (what the circuit matches), packages/zk (phone) and
// apps/api/app/zk (server, via fixtures.json from scripts/gen_zk_fixtures.py).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { buildEddsa, buildPoseidon } from "circomlibjs";
import {
  credentialHash, holderOf, meetsMilestone, nullifierOf, packLevels, poseidon, unpackLevels, verifyCredential,
  verifySignature, type Credential,
} from "../src/index.ts";

const fx = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"));

test("Poseidon matches circomlibjs and Python for 1, 2, 5 and 11 inputs", async () => {
  const ref = await buildPoseidon();
  for (const [n, inputs] of Object.entries(fx.inputs as Record<string, number[]>)) {
    const mine = poseidon(inputs);
    assert.equal(mine, ref.F.toObject(ref(inputs)), `circomlibjs, ${n} inputs`);
    assert.equal(mine.toString(), fx.hashes[n], `python, ${n} inputs`);
  }
});

test("a credential signed by the Python issuer verifies in TypeScript and in circomlibjs", async () => {
  const cred = fx.credential as Credential;
  assert.ok(verifyCredential(cred));
  const eddsa = await buildEddsa();
  const F = eddsa.babyJub.F;
  const ok = eddsa.verifyPoseidon(
    F.e(credentialHash(cred)),
    { R8: [F.e(BigInt(cred.signature.R8[0])), F.e(BigInt(cred.signature.R8[1]))], S: BigInt(cred.signature.S) },
    [F.e(BigInt(cred.issuer[0])), F.e(BigInt(cred.issuer[1]))],
  );
  assert.ok(ok, "circomlibjs accepts the Python signature");
});

test("changing any field or trusting another issuer breaks verification", () => {
  const cred = fx.credential as Credential;
  const tampered: Credential = { ...cred, fields: { ...cred.fields, orders: "50" } };
  assert.equal(verifyCredential(tampered), false);
  assert.equal(verifyCredential(cred, [1n, 2n]), false);
});

test("TypeScript checks a circomlibjs signature too", async () => {
  const eddsa = await buildEddsa();
  const prv = Buffer.from("01".repeat(32), "hex");
  const pub = eddsa.prv2pub(prv);
  const F = eddsa.babyJub.F;
  const msg = 123456789n;
  const sig = eddsa.signPoseidon(prv, F.e(msg));
  assert.ok(verifySignature(msg, { R8: [F.toObject(sig.R8[0]), F.toObject(sig.R8[1])], S: sig.S },
    [F.toObject(pub[0]), F.toObject(pub[1])]));
});

test("levels pack two bits per sub-skill and milestones read them back", () => {
  const order = fx.credential.subskill_order as string[];
  const packed = packLevels({ ss_stitch_machine: 4, ss_money_counting: 3 }, order);
  assert.equal(packed.toString(), fx.credential.fields.levels);
  const levels = unpackLevels(packed, order);
  assert.equal(levels.ss_stitch_machine, 4);
  assert.equal(levels.ss_money_counting, 3);
  assert.equal(levels[order.find((s) => s !== "ss_stitch_machine" && s !== "ss_money_counting")!], 1);
  const cred = fx.credential as Credential;
  const m = { id: 1, subskill_index: order.indexOf("ss_stitch_machine"), min_level: 3, min_orders: 5, max_income_band: 1, required_gender: 1 };
  assert.deepEqual(meetsMilestone(cred, m, 20_450), { ok: true, reasons: [] });
  assert.equal(meetsMilestone(cred, { ...m, min_orders: 6 }, 20_450).ok, false);
  assert.equal(meetsMilestone(cred, m, 20_581).ok, false, "expired");
});

test("holder and nullifier are Poseidon of the secret", () => {
  assert.equal(holderOf(123456789n).toString(), fx.credential.fields.holder);
  assert.notEqual(nullifierOf(5n, 1), nullifierOf(5n, 2));
  assert.equal(nullifierOf(5n, 1), poseidon([5n, 1n]));
});
