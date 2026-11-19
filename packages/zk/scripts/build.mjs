// Builds the skill-proof circuit end to end:
//   circom -> R1CS + WASM witness generator
//   Groth16 setup on the public PSE Perpetual Powers of Tau file (2^14) + one local contribution
//   -> proving key, verification key, Solidity verifier
// and copies what the phone and the contract need into place:
//   apps/web/public/zk/   skill_proof.wasm, skill_proof.zkey, verification_key.json, snarkjs.min.js
//   contracts/src/Groth16Verifier.sol
//
// Needs circom 2.2 on PATH. Run: npm run build:circuit -w packages/zk
// The local contribution makes this a demo setup: for real money, run a multi-party ceremony.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const root = resolve(pkg, "../..");
const build = join(pkg, "build");
const web = join(root, "apps/web/public/zk");
const contracts = join(root, "contracts/src");
const snarkjs = join(root, "node_modules/snarkjs/build/cli.cjs");
const PTAU = join(build, "pot14.ptau");
const PTAU_URL = "https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_14.ptau"; // PSE Perpetual Powers of Tau, 2^14

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", cwd: pkg, shell: process.platform === "win32" && cmd !== process.execPath });
const snark = (...args) => run(process.execPath, [snarkjs, ...args]);

mkdirSync(build, { recursive: true });
mkdirSync(web, { recursive: true });
mkdirSync(contracts, { recursive: true });

run("circom", ["circuits/skill_proof.circom", "--r1cs", "--wasm", "-l", join(root, "node_modules"), "-o", "build"]);

if (!existsSync(PTAU)) {
  console.log(`Downloading ${PTAU_URL}`);
  const res = await fetch(PTAU_URL);
  if (!res.ok) throw new Error(`ptau download failed: ${res.status}`);
  writeFileSync(PTAU, Buffer.from(await res.arrayBuffer()));
}

const r1cs = join(build, "skill_proof.r1cs");
const zkey0 = join(build, "skill_proof_0.zkey");
const zkey = join(build, "skill_proof.zkey");
const vkey = join(build, "verification_key.json");
snark("groth16", "setup", r1cs, PTAU, zkey0);
snark("zkey", "contribute", zkey0, zkey, "--name=Disha demo", `-e=${randomBytes(32).toString("hex")}`);
snark("zkey", "export", "verificationkey", zkey, vkey);
const sol = join(contracts, "Groth16Verifier.sol");
snark("zkey", "export", "solidityverifier", zkey, sol);
// snarkjs names the pragma loosely; pin it so Foundry and the explorer agree.
writeFileSync(sol, readFileSync(sol, "utf8").replace(/pragma solidity [^;]+;/, "pragma solidity 0.8.28;"));

copyFileSync(join(build, "skill_proof_js/skill_proof.wasm"), join(web, "skill_proof.wasm"));
copyFileSync(zkey, join(web, "skill_proof.zkey"));
copyFileSync(vkey, join(web, "verification_key.json"));
copyFileSync(join(root, "node_modules/snarkjs/build/snarkjs.min.js"), join(web, "snarkjs.min.js"));
console.log("Circuit built and copied to apps/web/public/zk and contracts/src.");
