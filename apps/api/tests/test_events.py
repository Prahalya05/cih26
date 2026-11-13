"""Event validation must agree with the TypeScript engine; both read the same fixture file."""
import json
from pathlib import Path

from app.schemas import validate_event

FX = json.loads((Path(__file__).resolve().parents[3] / "packages/engine/test/event_fixtures.json").read_text(encoding="utf-8"))


def test_event_validation_matches_shared_fixtures():
    for c in FX["cases"]:
        errs = validate_event(c["e"], FX["now"])
        assert (not errs) == c["ok"], (c["e"]["id"], errs)
