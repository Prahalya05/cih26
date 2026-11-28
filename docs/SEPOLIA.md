# Deploying Proof Pays to Sepolia

These steps deploy `Groth16Verifier`, `DemoRupee`, and `ProofPays` to Ethereum Sepolia (`chain_id = 11155111`) without modifying the circuit or contracts.

> **Testnet only:** `DemoRupee` is play money for demos and pilots; use a dedicated Sepolia wallet funded only with faucet ETH.

## 1. Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`)
- Python virtual environment with API dependencies (`eth-abi`, `eth-account`, `httpx`)
- A Sepolia RPC URL (e.g. Alchemy, Infura, or public Sepolia RPC)
- Two Sepolia accounts funded with a small amount of Sepolia ETH:
  - **Deployer key** (`DEPLOYER_KEY`) — used once to deploy and fund the demo milestones.
  - **Relayer key** (`RELAYER_PRIVATE_KEY`) — used by the API to relay student `claim(...)` transactions.
- A 32-byte hex `ZK_ISSUER_KEY` (the EdDSA-Poseidon key the API uses to sign credentials). Generate one with:
  ```bash
  python -c "import secrets; print(secrets.token_hex(32))"
  ```

## 2. Verify the ZK build and compile contracts

Confirm `Groth16Verifier.sol` and `apps/web/public/zk/verification_key.json` match, then compile:

```bash
python scripts/check_zk_vk.py
cd contracts && forge build && cd ..
```

## 3. Deploy to Sepolia

Set `ZK_ISSUER_KEY` (in your shell or `.env`) and run `scripts/deploy_contracts.py`:

```bash
export ZK_ISSUER_KEY="<64-hex-chars>"
export SEPOLIA_RPC_URL="https://eth-sepolia.g.alchemy.com/v2/<your-key>"
export DEPLOYER_KEY="0x<deployer-private-key>"

python scripts/deploy_contracts.py \
  --rpc "$SEPOLIA_RPC_URL" \
  --key "$DEPLOYER_KEY" \
  --explorer "https://sepolia.etherscan.io"
```

This writes `contracts/deployments/11155111.json` (public contract addresses, chain ID, explorer URL, and public `issuer` coordinates — no private keys).

## 4. Verify the live deployment

Set `RELAYER_PRIVATE_KEY` and run `scripts/verify_deployment.py`:

```bash
export RELAYER_PRIVATE_KEY="0x<relayer-private-key>"
python scripts/verify_deployment.py --chain 11155111
```

It checks:
- `Groth16Verifier.sol` matches `apps/web/public/zk/verification_key.json`
- `eth_chainId` matches `11155111`
- Contract bytecode exists at `verifier`, `token`, and `proofpays`
- `milestoneCount()` responds on `ProofPays`
- `RELAYER_PRIVATE_KEY` has non-zero Sepolia ETH balance
- `ZK_ISSUER_KEY` public key matches the contract's `issuerAx()` and `issuerAy()`

Commit `contracts/deployments/11155111.json` to the repo so Render can read it.

## 5. Render environment variables

Set these in the Render service for `apps/api`:

| Variable | Value |
|---|---|
| `CHAIN_ID` | `11155111` (selects `contracts/deployments/11155111.json`; or set `CHAIN_DEPLOYMENT=contracts/deployments/11155111.json`) |
| `CHAIN_RPC_URL` | Your Sepolia RPC URL |
| `RELAYER_PRIVATE_KEY` | Dedicated Sepolia relayer private key (`0x...`) |
| `ZK_ISSUER_KEY` | Same 64-hex-char key used during deployment |
| `DATABASE_URL` | Postgres connection string (with `pgvector` and `pgcrypto`) |
| `AUTH_SECRET` | Long random secret for HMACs |
| `PII_KEY` | Dedicated long random secret for `student_private` encryption (required when `OTP_DEMO=0`) |
| `OTP_DEMO` | `0` for real email/SMS OTP (`1` only for demos) |
