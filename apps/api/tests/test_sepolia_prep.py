"""Unit tests for Sepolia deployment preparation (VK parity, chain.deployment, verify_deployment)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))

import check_zk_vk  # noqa: E402
import verify_deployment  # noqa: E402
from app import chain  # noqa: E402
from app.zk import eddsa  # noqa: E402


def test_groth16_verifier_matches_verification_key(tmp_path):
    assert check_zk_vk.check_vk_match() == []
    bad_vk = tmp_path / "vk.json"
    vk = json.loads(check_zk_vk.VK_PATH.read_text(encoding="utf-8"))
    vk["vk_alpha_1"][0] = "12345"
    bad_vk.write_text(json.dumps(vk), encoding="utf-8")
    assert any("alphax mismatch" in p for p in check_zk_vk.check_vk_match(vk_path=bad_vk))


def test_chain_deployment_selects_by_chain_id_or_path(tmp_path, monkeypatch):
    deps = tmp_path / "contracts" / "deployments"
    deps.mkdir(parents=True)
    (deps / "31337.json").write_text(json.dumps({"chain_id": 31337, "proofpays": "0x111"}), encoding="utf-8")
    (deps / "11155111.json").write_text(json.dumps({"chain_id": 11155111, "proofpays": "0x222"}), encoding="utf-8")
    monkeypatch.setattr(chain, "ROOT", tmp_path)

    # Ambiguous without CHAIN_ID or CHAIN_DEPLOYMENT when >1 file exists
    monkeypatch.delenv("CHAIN_ID", raising=False)
    monkeypatch.delenv("CHAIN_DEPLOYMENT", raising=False)
    chain.deployment.cache_clear()
    assert chain.deployment() == {}

    # CHAIN_ID selects 11155111.json
    monkeypatch.setenv("CHAIN_ID", "11155111")
    chain.deployment.cache_clear()
    assert chain.deployment()["proofpays"] == "0x222"

    # CHAIN_DEPLOYMENT overrides CHAIN_ID
    monkeypatch.setenv("CHAIN_DEPLOYMENT", str(deps / "31337.json"))
    chain.deployment.cache_clear()
    assert chain.deployment()["proofpays"] == "0x111"
    chain.deployment.cache_clear()


def test_verify_deployment_checks_all_fields(monkeypatch):
    issuer_hex = "11" * 32
    monkeypatch.setenv("ZK_ISSUER_KEY", issuer_hex)
    monkeypatch.setenv("RELAYER_PRIVATE_KEY", "0x" + "22" * 32)
    ax, ay = eddsa.public_key(eddsa.secret_scalar(issuer_hex))
    dep = {
        "chain_id": 11155111,
        "rpc_url": "https://sepolia.example",
        "verifier": "0x0000000000000000000000000000000000000001",
        "token": "0x0000000000000000000000000000000000000002",
        "proofpays": "0x0000000000000000000000000000000000000003",
    }

    def fake_rpc(method, params):
        if method == "eth_chainId":
            return hex(11155111)
        if method == "eth_getCode":
            return "0x60806040"
        if method == "eth_getBalance":
            return hex(10**16)
        raise AssertionError(method)

    def fake_call(to, sig, types, args, out):
        if sig == "milestoneCount()":
            return (3,)
        if sig == "issuerAx()":
            return (ax,)
        if sig == "issuerAy()":
            return (ay,)
        raise AssertionError(sig)

    monkeypatch.setattr(chain, "rpc", fake_rpc)
    monkeypatch.setattr(chain, "call", fake_call)
    assert verify_deployment.verify(dep) == []

    # Mismatched issuer key should fail
    monkeypatch.setenv("ZK_ISSUER_KEY", "33" * 32)
    failures = verify_deployment.verify(dep)
    assert any("issuer key mismatch" in f for f in failures)
