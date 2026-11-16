"""Sets up a school's join codes, and switches off lost phones (see apps/api/app/auth.py).

  python scripts/add_join_code.py school sch_psg "PSG Higher Secondary School" Coimbatore
  python scripts/add_join_code.py class sch_psg PSG01      class code students type; prints a secret teacher code
  python scripts/add_join_code.py revoke-code PSG01        no new phones can register with it
  python scripts/add_join_code.py revoke-device <device_id>

Uses DATABASE_URL from the environment or .env. A class code works like a password for joining the school as a
student phone, so do not use guessable codes for real schools. The teacher code must stay with the teacher.
"""
from __future__ import annotations

import argparse
import secrets
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

TEACHER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L: read aloud and typed on phones


def add_school(con, school_id: str, name: str, district: str) -> None:
    con.execute("insert into school(id, name, district) values (%s, %s, %s) "
                "on conflict (id) do update set name = excluded.name, district = excluded.district",
                (school_id, name, district))


def add_class(con, school_id: str, class_code: str, teacher_code: str | None = None) -> str:
    """Adds the class code (role student) and a teacher code for it. Returns the teacher code."""
    class_code = class_code.strip().upper()
    teacher_code = (teacher_code or f"{class_code}-T-" + "".join(secrets.choice(TEACHER_CODE_ALPHABET)
                                                                 for _ in range(8))).strip().upper()
    for code, role in ((class_code, "student"), (teacher_code, "teacher")):
        con.execute("insert into join_code(code, school_id, role, class_code) values (%s, %s, %s, %s)",
                    (code, school_id, role, class_code))
    return teacher_code


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", help="database URL (default: DATABASE_URL)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("school")
    s.add_argument("school_id"), s.add_argument("name"), s.add_argument("district")
    c = sub.add_parser("class")
    c.add_argument("school_id"), c.add_argument("class_code")
    c.add_argument("--teacher-code", help="choose the teacher code instead of a random one (demo only)")
    sub.add_parser("revoke-code").add_argument("code")
    sub.add_parser("revoke-device").add_argument("device_id")
    args = ap.parse_args()

    from app import settings
    with psycopg.connect(args.db or settings.DATABASE_URL) as con:
        if args.cmd == "school":
            add_school(con, args.school_id, args.name, args.district)
            print(f"School {args.school_id} saved")
        elif args.cmd == "class":
            teacher = add_class(con, args.school_id, args.class_code, args.teacher_code)
            print(f"Class code (students): {args.class_code.upper()}\nTeacher code (keep secret): {teacher}")
        elif args.cmd == "revoke-code":
            n = con.execute("update join_code set revoked_at = now() where code = %s and revoked_at is null",
                            (args.code.strip().upper(),)).rowcount
            print("Revoked" if n else "No such active code")
        else:
            n = con.execute("update device set revoked_at = now() where id = %s and revoked_at is null",
                            (args.device_id,)).rowcount
            print("Phone switched off" if n else "No such active phone")


if __name__ == "__main__":
    main()
