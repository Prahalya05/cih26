"""Unit tests for PII_KEY separation and startup validation (no DB required)."""
import pytest

from app import settings


def test_pii_key_defaults_to_dev_key_in_demo_mode(monkeypatch):
    monkeypatch.setattr(settings, "OTP_DEMO", True)
    monkeypatch.setattr(settings, "DEMO_MODE", True)
    monkeypatch.setattr(settings, "PII_KEY", "")
    assert settings.validate_pii_key() == settings.DEV_PII_KEY
    assert settings.DEV_PII_KEY != settings.AUTH_SECRET


def test_pii_key_missing_fails_outside_demo_mode(monkeypatch):
    monkeypatch.setattr(settings, "OTP_DEMO", False)
    monkeypatch.setattr(settings, "DEMO_MODE", False)
    monkeypatch.setattr(settings, "PII_KEY", "")
    with pytest.raises(RuntimeError, match="PII_KEY"):
        settings.validate_pii_key()


def test_pii_key_dev_default_rejected_outside_demo_mode(monkeypatch):
    monkeypatch.setattr(settings, "OTP_DEMO", False)
    monkeypatch.setattr(settings, "DEMO_MODE", False)
    monkeypatch.setattr(settings, "PII_KEY", settings.DEV_PII_KEY)
    with pytest.raises(RuntimeError, match="PII_KEY"):
        settings.validate_pii_key()


def test_pii_key_custom_accepted_outside_demo_mode(monkeypatch):
    monkeypatch.setattr(settings, "OTP_DEMO", False)
    monkeypatch.setattr(settings, "DEMO_MODE", False)
    monkeypatch.setattr(settings, "PII_KEY", "prod-secret-pii-key-123")
    assert settings.validate_pii_key() == "prod-secret-pii-key-123"
