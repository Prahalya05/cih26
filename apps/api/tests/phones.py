"""A test client that acts as registered phones (see app/auth.py).

Each request carries the token of the phone named in its JSON "device_id" (or `default` when there is none).
Phones are registered on first use, straight in the database: `teachers` get teacher phones, the rest student
phones, all in `school` unless listed in `schools`.
"""
from __future__ import annotations

import psycopg
from fastapi.testclient import TestClient

from app import auth

SCHOOL = "sch_test"


def register(url: str, device_id: str, role: str = "student", school: str = SCHOOL) -> str:
    token = auth.new_token()
    with psycopg.connect(url, autocommit=True) as con:
        con.execute("insert into school(id, name, district) values (%s, %s, 'Test') on conflict (id) do nothing",
                    (school, school))
        con.execute("insert into device(id, school_id, role, token_hash) values (%s, %s, %s, %s) on conflict (id) "
                    "do update set school_id = excluded.school_id, role = excluded.role, token_hash = excluded.token_hash",
                    (device_id, school, role, auth.hash_token(token)))
    return token


class PhoneClient(TestClient):
    def __init__(self, app, url: str, teachers=("phoneT",), default: str = "phoneA", schools: dict | None = None):
        super().__init__(app)
        self.url, self.teachers, self.default, self.schools = url, set(teachers), default, schools or {}
        self.tokens: dict[str, str] = {}

    def token(self, device_id: str) -> str:
        if device_id not in self.tokens:
            role = "teacher" if device_id in self.teachers else "student"
            self.tokens[device_id] = register(self.url, device_id, role, self.schools.get(device_id, SCHOOL))
        return self.tokens[device_id]

    def as_phone(self, device_id: str) -> dict:
        return {"Authorization": f"Bearer {self.token(device_id)}"}

    def request(self, method, url, *args, **kwargs):
        headers = dict(kwargs.pop("headers", None) or {})
        if not any(k.lower() == "authorization" for k in headers):
            body = kwargs.get("json")
            device = body.get("device_id") if isinstance(body, dict) and body.get("device_id") else self.default
            headers.update(self.as_phone(device))
        return super().request(method, url, *args, headers=headers, **kwargs)
