"""Sends a sign-in code to an Indian mobile number by SMS, through MSG91's OTP API (v5).

We make the code ourselves (routers/accounts.py) and only ask MSG91 to deliver it, so checking the code, its
10-minute life, the 5 tries and the hash stay exactly as they are for email. MSG91 needs:
  MSG91_AUTH_KEY     the account's auth key
  MSG91_TEMPLATE_ID  a DLT-approved OTP template whose text contains ##OTP## (Indian SMS rules require DLT)
Returns False (never raises) when it is not set up or the send fails; the caller then falls back to demo mode
or refuses, exactly like email.
"""
from __future__ import annotations

import logging

import httpx

from .. import settings

API = "https://control.msg91.com/api/v5/otp"
log = logging.getLogger(__name__)


def configured() -> bool:
    return bool(settings.MSG91_AUTH_KEY and settings.MSG91_TEMPLATE_ID)


def send_code(mobile10: str, code: str, minutes: int) -> bool:
    """mobile10: a normalised 10-digit Indian number (accounts.normalise)."""
    if not configured():
        return False
    try:
        r = httpx.post(API, params={"template_id": settings.MSG91_TEMPLATE_ID, "mobile": f"91{mobile10}",
                                    "otp": code, "otp_expiry": minutes},
                       headers={"authkey": settings.MSG91_AUTH_KEY}, timeout=10)
        r.raise_for_status()
        ok = (r.json() or {}).get("type") == "success"
    except (httpx.HTTPError, ValueError) as e:
        # Never log the number or the code.
        log.warning("SMS sign-in code not sent: %s", type(e).__name__)
        return False
    if not ok:
        log.warning("SMS sign-in code not sent: provider did not report success")
    return ok
