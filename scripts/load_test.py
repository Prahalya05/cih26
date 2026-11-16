"""Load test for /v2/sync (Step 13.3): many phones syncing at once.

Each simulated phone has one student (with consent) and sends N events in one sync, like a phone coming back
online after a school day. By default all phones start in the same instant (a worst-case burst); --ramp S
spreads their starts evenly over S seconds, like a class coming back online. Reports response-time percentiles.

    python scripts/load_test.py --url http://localhost:8010 --code LOAD01 --phones 200 --events 50
    python scripts/load_test.py --url https://<your-service> --code LOAD01 --cleanup   # deletes the students afterwards

--code is a class code of a school kept for load tests (scripts/add_join_code.py). Each phone registers with it
before the timed part starts, so registration is not measured.

Target (implementation plan): 95th percentile under 1 second.
Results are appended to docs/benchmarks/load_test.md.
"""
from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from scenarios import ulid_at  # noqa: E402

TARGET_P95_S = 1.0


def phone_payload(run: str, k: int, n_events: int, now: int) -> dict:
    sid = f"load_{run}_{k}"
    events = []
    for i in range(n_events):
        t = now - (n_events - i) * 60_000 + k
        if i % 5 == 0:
            e = {"kind": "self_report", "skill_id": "sk_stitching", "payload": {"source": "tap", "qid": "home"}}
        else:
            e = {"kind": "item_response", "subskill_id": "ss_stitch_machine", "item_id": f"it_sth_0{1 + i % 6}",
                 "payload": {"correct": i % 3 != 0, "ms": 8000}}
        events.append({"id": ulid_at(t, k * 1000 + i), "student_id": sid, "device_id": f"loadphone_{run}_{k}",
                       "created_at": t, **e})
    return {"device_id": f"loadphone_{run}_{k}", "cursor": 0, "student_ids": [sid],
            "students": [{"id": sid, "consent": {"id": f"c_{sid}", "scopes": ["assess"], "method": "paper_form",
                                                 "granted_at": now - 86_400_000}}],
            "events": events}


async def register(client: httpx.AsyncClient, url: str, code: str, device_id: str) -> dict:
    r = await client.post(f"{url}/v2/devices", json={"device_id": device_id, "code": code})
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


async def one_phone(client: httpx.AsyncClient, url: str, body: dict, auth: dict, start: asyncio.Event,
                    delay: float = 0.0) -> tuple[float, int, int]:
    await start.wait()
    if delay:
        await asyncio.sleep(delay)
    t0 = time.perf_counter()
    r = await client.post(f"{url}/v2/sync", json=body, headers=auth)
    dt = time.perf_counter() - t0
    ok = len(r.json().get("accepted", [])) if r.status_code == 200 else 0
    return dt, r.status_code, ok


async def run(url: str, code: str, phones: int, n_events: int, ramp: float = 0.0) -> dict:
    run_id = datetime.now(tz=timezone.utc).strftime("%H%M%S")
    now = int(time.time() * 1000)
    bodies = [phone_payload(run_id, k, n_events, now) for k in range(phones)]
    start = asyncio.Event()
    limits = httpx.Limits(max_connections=phones, max_keepalive_connections=phones)
    async with httpx.AsyncClient(timeout=60, limits=limits) as client:
        auths = [await register(client, url, code, b["device_id"]) for b in bodies]
        tasks = [asyncio.create_task(one_phone(client, url, b, a, start, ramp * k / phones))
                 for k, (b, a) in enumerate(zip(bodies, auths))]
        t0 = time.perf_counter()
        start.set()
        results = await asyncio.gather(*tasks)
        wall = time.perf_counter() - t0
    times = sorted(r[0] for r in results)
    q = statistics.quantiles(times, n=100)
    return {"run": run_id, "url": url, "phones": phones, "events_per_phone": n_events,
            "ok_responses": sum(r[1] == 200 for r in results), "events_accepted": sum(r[2] for r in results),
            "p50_s": round(q[49], 3), "p95_s": round(q[94], 3), "max_s": round(times[-1], 3), "wall_s": round(wall, 2),
            "student_ids": [b["students"][0]["id"] for b in bodies], "auth": auths[0]}


async def cleanup(url: str, ids: list[str], auth: dict) -> int:
    async with httpx.AsyncClient(timeout=60) as client:
        sem = asyncio.Semaphore(20)

        async def rm(sid: str) -> bool:
            async with sem:
                r = await client.request("DELETE", f"{url}/v2/student/{sid}", json={"confirmed_by": "guardian"},
                                           headers=auth)
                return r.status_code == 200

        return sum(await asyncio.gather(*(rm(s) for s in ids)))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8010")
    ap.add_argument("--code", required=True, help="class code of the load-test school")
    ap.add_argument("--phones", type=int, default=200)
    ap.add_argument("--events", type=int, default=50)
    ap.add_argument("--ramp", type=float, default=0.0, help="spread phone starts over this many seconds (0 = burst)")
    ap.add_argument("--cleanup", action="store_true", help="delete the load-test students afterwards")
    ap.add_argument("--note", default="", help="where it ran, e.g. 'laptop, local Postgres'")
    args = ap.parse_args()
    out = asyncio.run(run(args.url.rstrip("/"), args.code, args.phones, args.events, args.ramp))
    ok = out["p95_s"] < TARGET_P95_S and out["ok_responses"] == args.phones \
        and out["events_accepted"] == args.phones * args.events
    removed = asyncio.run(cleanup(args.url.rstrip("/"), out["student_ids"], out["auth"])) if args.cleanup else 0
    line = (f"| {datetime.now().strftime('%Y-%m-%d %H:%M')} | {args.note or out['url']} | {out['phones']} × {out['events_per_phone']} | "
            f"{'burst' if not args.ramp else f'over {args.ramp:g} s'} | {out['ok_responses']}/{out['phones']} | {out['events_accepted']} | {out['p50_s']} | {out['p95_s']} | "
            f"{out['max_s']} | {'pass' if ok else 'FAIL'} |")
    path = ROOT / "docs" / "benchmarks" / "load_test.md"
    if not path.exists():
        path.write_text("# Sync load test\n\nTarget: 95th percentile under 1 s (Step 13.3). "
                        "Made by `python scripts/load_test.py`.\n\n"
                        "| When | Where | Phones × events | Start | OK responses | Events accepted | p50 s | p95 s | max s | Result |\n"
                        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n", encoding="utf-8", newline="\n")
    with open(path, "a", encoding="utf-8", newline="\n") as f:
        f.write(line + "\n")
    print(line)
    if args.cleanup:
        print(f"deleted {removed} load-test students")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
