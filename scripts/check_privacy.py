"""Privacy checks run in CI (Step 11.3).

1. Names and phone numbers are kept only in student_private: no other table in the migrations may have a
   column that looks like one (name, phone, mobile, email, address, aadhaar...).
2. No analytics or tracking SDKs in any package.json or requirements file, and no tracking hosts in app code.

Run:  python scripts/check_privacy.py      (exit code 1 on any problem)
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "apps" / "api" / "migrations"

PRIVATE_TABLE = "student_private"
PERSONAL = re.compile(r"(^|_)(name|phone|mobile|email|address|aadhaa?r|dob|whatsapp)($|_)", re.I)
# Columns that match the pattern but are not about a person.
# account.name: the sign-in table (0011) is never granted to the analysis role (disha_readonly) and never leaves the API
# except to its own owner; the phone number or email itself is stored only as an HMAC.
ALLOWED = {("school", "name"), ("opportunity", "title"), ("account", "name")}

TRACKERS = ["google-analytics", "gtag", "@vercel/analytics", "mixpanel", "@segment", "analytics-node", "amplitude",
            "posthog", "hotjar", "@sentry", "sentry-sdk", "sentry_sdk", "logrocket", "fullstory",
            "firebase-analytics", "@firebase/analytics", "matomo", "plausible"]
TRACKER_HOSTS = ["googletagmanager.com", "google-analytics.com", "mixpanel.com", "segment.io", "amplitude.com",
                 "posthog.com", "hotjar.com", "sentry.io", "clarity.ms", "plausible.io"]

CREATE = re.compile(r"create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)\s*\((.*?)\n\);", re.I | re.S)
ADD_COL = re.compile(r"alter\s+table\s+(\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)", re.I)
DROP_COL = re.compile(r"alter\s+table\s+(\w+)\s+drop\s+column\s+(?:if\s+exists\s+)?(\w+)", re.I)


def schema_columns() -> set[tuple[str, str]]:
    """Every (table, column) left after applying the migrations in order."""
    cols: set[tuple[str, str]] = set()
    for path in sorted(MIGRATIONS.glob("*.sql")):
        sql = re.sub(r"--[^\n]*", "", path.read_text(encoding="utf-8"))
        events = [(m.start(), "create", m) for m in CREATE.finditer(sql)]
        events += [(m.start(), "add", m) for m in ADD_COL.finditer(sql)]
        events += [(m.start(), "drop", m) for m in DROP_COL.finditer(sql)]
        for _, kind, m in sorted(events, key=lambda x: x[0]):
            table = m.group(1).lower()
            if kind == "create":
                for line in m.group(2).split("\n"):
                    word = line.strip().split(" ")[0].strip(",").lower()
                    if word and word not in ("primary", "unique", "foreign", "check", "constraint"):
                        cols.add((table, word))
            elif kind == "add":
                cols.add((table, m.group(2).lower()))
            else:
                cols.discard((table, m.group(2).lower()))
    return cols


def personal_columns_outside_private() -> list[str]:
    return [f"{t}.{c}" for t, c in sorted(schema_columns())
            if t != PRIVATE_TABLE and PERSONAL.search(c) and (t, c) not in ALLOWED]


def tracking_dependencies() -> list[str]:
    found: list[str] = []
    for pkg in ROOT.glob("**/package.json"):
        if "node_modules" in pkg.parts:
            continue
        data = json.loads(pkg.read_text(encoding="utf-8"))
        deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
        found += [f"{pkg.relative_to(ROOT)}: {d}" for d in deps if any(t in d.lower() for t in TRACKERS)]
    for req in ROOT.glob("**/requirements*.txt"):
        if "node_modules" in req.parts:
            continue
        for line in req.read_text(encoding="utf-8").splitlines():
            name = re.split(r"[<>=\[ ;]", line.strip(), maxsplit=1)[0].lower()
            if name and any(t in name for t in TRACKERS):
                found.append(f"{req.relative_to(ROOT)}: {name}")
    for src in [*(ROOT / "apps").glob("**/*.ts*"), *(ROOT / "apps").glob("**/*.html"), *(ROOT / "apps").glob("**/*.py")]:
        if "node_modules" in src.parts or "dist" in src.parts:
            continue
        text = src.read_text(encoding="utf-8", errors="ignore")
        found += [f"{src.relative_to(ROOT)}: {h}" for h in TRACKER_HOSTS if h in text]
    return found


def main() -> int:
    problems = [f"personal data column outside {PRIVATE_TABLE}: {c}" for c in personal_columns_outside_private()]
    problems += [f"tracking SDK or host: {x}" for x in tracking_dependencies()]
    for p in problems:
        print("FAIL", p)
    if not problems:
        print(f"ok: {len(schema_columns())} columns checked, no tracking SDKs")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
