"""Weekly job: recompute every rater's leniency and agreement (Step 9.3).

    python scripts/rater_stats.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "api"))

from app import db  # noqa: E402
from app.services import raters  # noqa: E402

if __name__ == "__main__":
    with db.connect() as con:
        stats = raters.update_all(con)
    for rid, s in sorted(stats.items()):
        print(f"{rid}: {s['n']} ratings, leniency {s['leniency']:+.2f}, agreement {s['agreement']:.2f}")
    print(f"{len(stats)} raters updated")
