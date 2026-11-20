"""Razorpay (test mode) for teacher courses. No card or UPI data ever touches Disha's servers.

Flow: the server creates an order (amount fixed by the server, never by the phone) → the phone opens Razorpay
Checkout → Razorpay returns order_id, payment_id and a signature → the server checks
    HMAC-SHA256(key_secret, order_id + "|" + payment_id) == signature
before it unlocks anything. Without RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET the app uses a clearly labelled demo
payment instead (PAYMENTS_DEMO=1), where no money moves.
"""
from __future__ import annotations

import hashlib
import hmac
import os

import httpx

API = "https://api.razorpay.com/v1"


def key_id() -> str:
    return os.getenv("RAZORPAY_KEY_ID", "").strip()


def _secret() -> str:
    return os.getenv("RAZORPAY_KEY_SECRET", "").strip()


def enabled() -> bool:
    return bool(key_id() and _secret())


def demo_allowed() -> bool:
    return not enabled() and os.getenv("PAYMENTS_DEMO", "1") == "1"


class PaymentError(Exception):
    pass


def create_order(amount_inr: int, receipt: str, notes: dict) -> dict:
    try:
        r = httpx.post(f"{API}/orders", auth=(key_id(), _secret()), timeout=15,
                       json={"amount": amount_inr * 100, "currency": "INR", "receipt": receipt[:40], "notes": notes})
        r.raise_for_status()
        return r.json()
    except httpx.HTTPError as e:
        raise PaymentError(f"Razorpay order failed: {type(e).__name__}") from e


def signature_ok(order_id: str, payment_id: str, signature: str) -> bool:
    if not _secret():
        return False
    expected = hmac.new(_secret().encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")
