"""Teacher profiles and teacher-run courses: free, pay per module, or subscription.

Who decides what (rule.course_access, same as packages/engine/src/courses.ts):
  - free course → every module open
  - the first module of any course is a free preview
  - per_module → a module opens after a paid purchase of that module
  - subscription → every module opens while a paid subscription is valid (period_days from payment)
  - the teacher who made the course always sees all of it
Locked modules are sent as titles only: no lesson text, video or quiz. Quiz answers never leave the server; the
server marks the quiz, and a pass becomes skill evidence on the student's phone (a "task" event).
Payments: Razorpay test mode with a server-side signature check, or a labelled demo payment (adapters/razorpay.py).
Disha keeps 10% of paid fees; the teacher earns 90%.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from .. import auth, db, kb
from ..adapters import razorpay
from ..auth import Device
from ..ratelimit import limit
from ..schemas import new_ulid

router = APIRouter(prefix="/v2", tags=["teachers and courses"])

PLATFORM_FEE = 0.10
QUIZ_PASS = 0.7
PLANS = ("free", "per_module", "subscription")


def _acc(dev: Device) -> str:
    if not dev.account_id:
        raise HTTPException(401, "Sign in first")
    return dev.account_id


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


# ---------- the access rule ----------

def module_open(course: dict, position: int, module_id: str, purchases: list[dict], viewer: str | None, now: datetime) -> tuple[bool, str]:
    if viewer and viewer == course["teacher_id"]:
        return True, "your own course"
    if course["plan"] == "free":
        return True, "free course"
    if position == 0:
        return True, "first lesson is a free preview"
    paid = [p for p in purchases if p["status"] == "paid" and p["course_id"] == course["id"]]
    if course["plan"] == "per_module":
        ok = any(p["kind"] == "module" and p["module_id"] == module_id for p in paid)
        return ok, "you bought this lesson" if ok else f"₹{course['price_inr']} to open this lesson"
    ok = any(p["kind"] == "subscription" and p["valid_until"] and p["valid_until"] > now for p in paid)
    return ok, "your subscription is active" if ok else f"subscribe: ₹{course['price_inr']} for {course['period_days']} days"


# ---------- teacher profiles ----------

class TeacherProfileIn(BaseModel):
    bio: str | None = Field(None, max_length=600)
    subjects: list[str] = Field(default_factory=list, max_length=12)
    languages: list[str] = Field(default_factory=list, max_length=6)
    years: int | None = Field(None, ge=0, le=60)
    qualification: str | None = Field(None, max_length=160)
    district: str | None = Field(None, max_length=60)
    district_code: str | None = Field(None, max_length=40)
    pincode: str | None = Field(None, pattern=r"^\d{6}$")
    listed: bool = False
    avatar: str | None = Field(None, max_length=8)


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _resolve_district(key: str | None) -> dict | None:
    if not key:
        return None
    dists = kb.districts()
    if key in dists:
        return dists[key]
    low = key.strip().lower()
    for d in dists.values():
        if d["name"]["en"].lower() == low or d["code"].lower() == low:
            return d
    return None


def _teacher_out(con, account_id: str, viewer: str | None) -> dict:
    acc = con.execute("select id, name, school_id from account where id = %s and role = 'teacher' and disabled_at is null",
                      (account_id,)).fetchone()
    if not acc:
        raise HTTPException(404, "No such teacher")
    p = con.execute("select * from teacher_profile where account_id = %s", (account_id,)).fetchone() or {}
    school = con.execute("select name from school where id = %s", (acc["school_id"],)).fetchone() if acc["school_id"] else None
    courses = con.execute("select id, title, plan, price_inr, skill_id, language, published, "
                          "(select count(*) from course_module m where m.course_id = c.id) as modules "
                          "from course c where teacher_id = %s order by created_at desc", (account_id,)).fetchall()
    learners = con.execute("select count(distinct p.account_id) from purchase p join course c on c.id = p.course_id "
                           "where c.teacher_id = %s and p.status = 'paid'", (account_id,)).fetchone()["count"]
    out = {"id": acc["id"], "name": acc["name"], "school": school["name"] if school else None,
           "bio": p.get("bio"), "subjects": p.get("subjects") or [], "languages": p.get("languages") or [],
           "years": p.get("years"), "qualification": p.get("qualification"),
           "district": p.get("district"), "district_code": p.get("district_code"),
           "listed": bool(p.get("listed", False)),
           "avatar": p.get("avatar") or "🧑‍🏫", "learners": learners,
           "courses": [dict(c) for c in courses if c["published"] or viewer == account_id]}
    if viewer == account_id:
        out["pincode"] = p.get("pincode")
    return out


@router.get("/teachers/me/profile", summary="My teacher profile")
def my_teacher_profile(dev: Device = Depends(auth.role_in("teacher"))):
    with db.connect() as con:
        return _teacher_out(con, _acc(dev), dev.account_id)


@router.put("/teachers/me/profile", summary="Save my teacher profile")
def save_teacher_profile(body: TeacherProfileIn, dev: Device = Depends(auth.role_in("teacher"))):
    d = _resolve_district(body.district_code or body.district)
    dcode = d["code"] if d else body.district_code
    dname = body.district or (d["name"]["en"] if d else None)
    with db.connect() as con:
        con.execute("insert into teacher_profile(account_id, bio, subjects, languages, years, qualification, district, district_code, pincode, listed, avatar) "
                    "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) on conflict (account_id) do update set bio = excluded.bio, "
                    "subjects = excluded.subjects, languages = excluded.languages, years = excluded.years, "
                    "qualification = excluded.qualification, district = excluded.district, district_code = excluded.district_code, "
                    "pincode = excluded.pincode, listed = excluded.listed, avatar = excluded.avatar, updated_at = now()",
                    (_acc(dev), body.bio, body.subjects, body.languages, body.years, body.qualification,
                     dname, dcode, body.pincode, body.listed, body.avatar))
        return _teacher_out(con, _acc(dev), dev.account_id)


@router.get("/teachers/search", summary="Search opted-in teachers across all schools by coarse district (no GPS)",
            dependencies=[Depends(limit("teacher_search", per_minute=30))])
def search_teachers(
    request: Request,
    district: str | None = None,
    subject: str | None = None,
    language: str | None = None,
    q: str | None = None,
    limit_n: int = Query(20, alias="limit", ge=1, le=50),
    offset: int = Query(0, ge=0),
    dev: Device = Depends(auth.device),
):
    if any(k in request.query_params for k in ("lat", "lng", "lon", "latitude", "longitude", "gps")):
        raise HTTPException(400, "Exact coordinates are never accepted; send a district code instead")
    target = _resolve_district(district)
    with db.connect() as con:
        rows = con.execute(
            "select a.id, a.name, p.bio, p.subjects, p.languages, p.years, p.qualification, "
            "p.district, p.district_code, p.avatar, "
            "(select count(*) from course c where c.teacher_id = a.id and c.published) as courses "
            "from account a join teacher_profile p on p.account_id = a.id "
            "where a.role = 'teacher' and a.disabled_at is null and p.listed is true"
        ).fetchall()

    subj_q = subject.strip().lower() if subject else ""
    lang_q = language.strip().lower() if language else ""
    text_q = q.strip().lower() if q else ""

    matched = []
    for r in rows:
        subjects = r["subjects"] or []
        languages = r["languages"] or []
        if subj_q and not any(subj_q in s.lower() for s in subjects):
            continue
        if lang_q and not any(lang_q == l.lower() or lang_q in l.lower() for l in languages):
            continue
        if text_q:
            hay = " ".join([
                r["name"] or "", r["bio"] or "", r["qualification"] or "",
                r["district"] or "", *subjects,
            ]).lower()
            if text_q not in hay:
                continue
        td = _resolve_district(r["district_code"] or r["district"])
        dist_km = round(_haversine_km(target["lat"], target["lng"], td["lat"], td["lng"]), 1) if (target and td) else None
        matched.append({
            "id": r["id"],
            "name": r["name"],
            "avatar": r["avatar"] or "🧑‍🏫",
            "subjects": subjects,
            "languages": languages,
            "district": r["district"] or (td["name"]["en"] if td else None),
            "district_code": r["district_code"] or (td["code"] if td else None),
            "qualification": r["qualification"],
            "years": r["years"],
            "bio": r["bio"],
            "courses": r["courses"],
            "distance_km": dist_km,
        })

    if target:
        matched.sort(key=lambda x: (x["distance_km"] is None, x["distance_km"] or 0.0, -x["courses"], x["name"]))
    else:
        matched.sort(key=lambda x: (-x["courses"], x["name"]))

    return {"total": len(matched), "teachers": matched[offset:offset + limit_n]}


@router.get("/teachers/{account_id}", summary="A teacher's public profile and published courses")
def teacher_profile(account_id: str, dev: Device = Depends(auth.device)):
    with db.connect() as con:
        return _teacher_out(con, account_id, dev.account_id)


@router.get("/teachers", summary="Teachers of my school")
def list_teachers(dev: Device = Depends(auth.device)):
    with db.connect() as con:
        rows = con.execute("select a.id, a.name, p.subjects, p.avatar, "
                           "(select count(*) from course c where c.teacher_id = a.id and c.published) as courses "
                           "from account a left join teacher_profile p on p.account_id = a.id "
                           "where a.role = 'teacher' and a.disabled_at is null and a.school_id is not distinct from %s "
                           "order by a.name", (dev.school_id,)).fetchall()
    return {"teachers": [{**r, "subjects": r["subjects"] or [], "avatar": r["avatar"] or "🧑‍🏫"} for r in rows]}


# ---------- courses: teacher side ----------

class CourseIn(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    description: str | None = Field(None, max_length=1500)
    language: str = Field("ta", pattern="^(ta|hi|en)$")
    skill_id: str
    plan: str
    price_inr: int = Field(0, ge=0, le=100000)
    period_days: int = Field(30, ge=7, le=365)
    open_to_all: bool = False


class QuizQ(BaseModel):
    q: str = Field(min_length=3, max_length=300)
    options: list[str] = Field(min_length=2, max_length=5)
    answer: int = Field(ge=0, le=4)


class ModuleIn(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    body: str | None = Field(None, max_length=8000)
    video_url: str | None = Field(None, max_length=400, pattern=r"^https://")
    subskill_id: str | None = None
    quiz: list[QuizQ] = Field(default_factory=list, max_length=10)


def _check_course(body: CourseIn):
    if body.plan not in PLANS:
        raise HTTPException(400, "plan must be free, per_module or subscription")
    if body.plan != "free" and body.price_inr < 1:
        raise HTTPException(400, "Set a price for a paid plan")
    if not _trainable(body.skill_id):
        raise HTTPException(400, "Choose a sub-skill (or a skill that has no sub-skills)")


def _trainable(unit: str) -> bool:
    """A unit a quiz can give evidence for: a sub-skill, or a skill that has no sub-skills."""
    g = kb.graph()
    return unit in g.get("subskills", {}) or (unit in kb.skills() and not g.get("bySkill", {}).get(unit))


def _own_course(con, course_id: str, acc: str) -> dict:
    c = con.execute("select * from course where id = %s", (course_id,)).fetchone()
    if not c or c["teacher_id"] != acc:
        raise HTTPException(404, "Not your course")
    return c


@router.post("/courses", summary="Create a course (teacher)")
def create_course(body: CourseIn, dev: Device = Depends(auth.role_in("teacher"))):
    _check_course(body)
    cid = f"crs_{new_ulid().lower()}"
    with db.connect() as con:
        con.execute("insert into course(id, teacher_id, school_id, title, description, language, skill_id, plan, price_inr, period_days) "
                    "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (cid, _acc(dev), None if body.open_to_all else dev.school_id, body.title, body.description, body.language,
                     body.skill_id, body.plan, 0 if body.plan == "free" else body.price_inr, body.period_days))
    return {"id": cid}


@router.put("/courses/{course_id}", summary="Edit a course (teacher)")
def edit_course(course_id: str, body: CourseIn, dev: Device = Depends(auth.role_in("teacher"))):
    _check_course(body)
    with db.connect() as con:
        _own_course(con, course_id, _acc(dev))
        con.execute("update course set title=%s, description=%s, language=%s, skill_id=%s, plan=%s, price_inr=%s, period_days=%s, "
                    "school_id=%s where id=%s", (body.title, body.description, body.language, body.skill_id, body.plan,
                                                0 if body.plan == "free" else body.price_inr, body.period_days,
                                                None if body.open_to_all else dev.school_id, course_id))
    return {"ok": True}


@router.post("/courses/{course_id}/modules", summary="Add a lesson to a course (teacher)")
def add_module(course_id: str, body: ModuleIn, dev: Device = Depends(auth.role_in("teacher"))):
    if body.subskill_id and not _trainable(body.subskill_id):
        raise HTTPException(400, "Unknown sub-skill")
    with db.connect() as con:
        _own_course(con, course_id, _acc(dev))
        pos = con.execute("select coalesce(max(position) + 1, 0) as p from course_module where course_id = %s", (course_id,)).fetchone()["p"]
        mid = f"mod_{new_ulid().lower()}"
        from psycopg.types.json import Jsonb
        con.execute("insert into course_module(id, course_id, position, title, body, video_url, subskill_id, quiz) "
                    "values (%s, %s, %s, %s, %s, %s, %s, %s)",
                    (mid, course_id, pos, body.title, body.body, body.video_url, body.subskill_id,
                     Jsonb([q.model_dump() for q in body.quiz])))
    return {"id": mid, "position": pos}


@router.delete("/modules/{module_id}", summary="Remove a lesson (teacher)")
def delete_module(module_id: str, dev: Device = Depends(auth.role_in("teacher"))):
    with db.connect() as con:
        m = con.execute("select course_id from course_module where id = %s", (module_id,)).fetchone()
        if not m:
            raise HTTPException(404, "No such lesson")
        _own_course(con, m["course_id"], _acc(dev))
        con.execute("delete from course_module where id = %s", (module_id,))
    return {"ok": True}


@router.post("/courses/{course_id}/publish", summary="Publish or hide a course (teacher)")
def publish(course_id: str, published: bool = True, dev: Device = Depends(auth.role_in("teacher"))):
    with db.connect() as con:
        _own_course(con, course_id, _acc(dev))
        if published and not con.execute("select 1 from course_module where course_id = %s", (course_id,)).fetchone():
            raise HTTPException(400, "Add at least one lesson first")
        con.execute("update course set published = %s where id = %s", (published, course_id))
    return {"published": published}


@router.get("/courses/mine", summary="My courses with learners and earnings (teacher)")
def my_courses(dev: Device = Depends(auth.role_in("teacher"))):
    with db.connect() as con:
        rows = con.execute(
            "select c.*, (select count(*) from course_module m where m.course_id = c.id) as modules, "
            "(select count(distinct p.account_id) from purchase p where p.course_id = c.id and p.status = 'paid') as learners, "
            "(select coalesce(sum(p.amount_inr), 0) from purchase p where p.course_id = c.id and p.status = 'paid') as gross, "
            "(select count(*) from purchase p where p.course_id = c.id and p.status = 'paid' and p.provider = 'demo') as demo_paid "
            "from course c where c.teacher_id = %s order by c.created_at desc", (_acc(dev),)).fetchall()
    out = [{**{k: v for k, v in r.items() if k not in ("created_at",)}, "earned_inr": round(r["gross"] * (1 - PLATFORM_FEE)),
            "fee_inr": round(r["gross"] * PLATFORM_FEE)} for r in rows]
    return {"courses": out, "fee": PLATFORM_FEE,
            "total": {"gross": sum(r["gross"] for r in rows), "earned_inr": sum(o["earned_inr"] for o in out)}}


# ---------- courses: student side ----------

def _visible(con, course_id: str, dev: Device) -> dict:
    c = con.execute("select c.*, a.name as teacher_name from course c join account a on a.id = c.teacher_id where c.id = %s",
                    (course_id,)).fetchone()
    if not c or not (c["teacher_id"] == dev.account_id or (c["published"] and (c["school_id"] is None or c["school_id"] == dev.school_id))):
        raise HTTPException(404, "No such course")
    return c


def _purchases(con, acc: str | None) -> list[dict]:
    if not acc:
        return []
    return con.execute("select * from purchase where account_id = %s", (acc,)).fetchall()


@router.get("/courses", summary="Courses I can take (my school's and open ones)")
def list_courses(dev: Device = Depends(auth.device)):
    with db.connect() as con:
        rows = con.execute(
            "select c.id, c.title, c.description, c.language, c.skill_id, c.plan, c.price_inr, c.period_days, c.teacher_id, "
            "a.name as teacher_name, (select count(*) from course_module m where m.course_id = c.id) as modules "
            "from course c join account a on a.id = c.teacher_id "
            "where c.published and (c.school_id is null or c.school_id = %s) order by c.created_at desc limit 200",
            (dev.school_id,)).fetchall()
        mine = _purchases(con, dev.account_id)
        done = {r["module_id"] for r in con.execute("select module_id from module_progress where account_id = %s and passed",
                                                    (dev.account_id,))} if dev.account_id else set()
        mods = con.execute("select id, course_id from course_module").fetchall()
    now = _now()
    out = []
    for c in rows:
        paid = [p for p in mine if p["course_id"] == c["id"] and p["status"] == "paid"]
        sub = any(p["kind"] == "subscription" and p["valid_until"] and p["valid_until"] > now for p in paid)
        passed = sum(1 for m in mods if m["course_id"] == c["id"] and m["id"] in done)
        out.append({**c, "subscribed": sub, "lessons_bought": sum(1 for p in paid if p["kind"] == "module"), "passed": passed})
    return {"courses": out, "payments": "razorpay" if razorpay.enabled() else ("demo" if razorpay.demo_allowed() else "off")}


@router.get("/courses/{course_id}", summary="A course with its lessons; locked lessons show only their title")
def course_detail(course_id: str, dev: Device = Depends(auth.device)):
    with db.connect() as con:
        c = _visible(con, course_id, dev)
        mods = con.execute("select * from course_module where course_id = %s order by position", (course_id,)).fetchall()
        mine = _purchases(con, dev.account_id)
        prog = {r["module_id"]: r for r in con.execute("select * from module_progress where account_id = %s", (dev.account_id,))} if dev.account_id else {}
    now = _now()
    lessons = []
    for m in mods:
        ok, why = module_open(c, m["position"], m["id"], mine, dev.account_id, now)
        item = {"id": m["id"], "position": m["position"], "title": m["title"], "open": ok, "why": why,
                "subskill_id": m["subskill_id"], "quiz_count": len(m["quiz"] or []),
                "passed": bool(prog.get(m["id"], {}).get("passed")), "score": prog.get(m["id"], {}).get("score")}
        if ok:
            item.update({"body": m["body"], "video_url": m["video_url"],
                         "quiz": [{"q": q["q"], "options": q["options"]} for q in (m["quiz"] or [])]})  # never the answers
            if dev.account_id == c["teacher_id"]:
                item["answers"] = [q["answer"] for q in (m["quiz"] or [])]
        lessons.append(item)
    sub = next((p for p in mine if p["course_id"] == course_id and p["kind"] == "subscription" and p["status"] == "paid"
                and p["valid_until"] and p["valid_until"] > now), None)
    return {"course": {k: v for k, v in c.items() if k != "created_at"}, "lessons": lessons,
            "subscription_until": sub["valid_until"].isoformat() if sub else None,
            "payments": "razorpay" if razorpay.enabled() else ("demo" if razorpay.demo_allowed() else "off"),
            "razorpay_key": razorpay.key_id() if razorpay.enabled() else None}


class CheckoutIn(BaseModel):
    module_id: str | None = None


@router.post("/courses/{course_id}/checkout", summary="Start paying for a lesson or a subscription (price set by the server)")
def checkout(course_id: str, body: CheckoutIn, dev: Device = Depends(auth.role_in("student"))):
    acc = _acc(dev)
    with db.connect() as con:
        c = _visible(con, course_id, dev)
        if c["plan"] == "free":
            raise HTTPException(400, "This course is free")
        if c["plan"] == "per_module":
            m = con.execute("select id, position from course_module where id = %s and course_id = %s", (body.module_id, course_id)).fetchone()
            if not m:
                raise HTTPException(400, "Choose a lesson")
            ok, _ = module_open(c, m["position"], m["id"], _purchases(con, acc), acc, _now())
            if ok:
                raise HTTPException(409, "This lesson is already open")
            kind, module_id = "module", m["id"]
        else:
            kind, module_id = "subscription", None
        pid = f"pay_{new_ulid().lower()}"
        amount = c["price_inr"]
        if razorpay.enabled():
            try:
                order = razorpay.create_order(amount, pid, {"course": course_id, "kind": kind})
            except razorpay.PaymentError as e:
                raise HTTPException(502, str(e)) from None
            provider, order_id = "razorpay", order["id"]
        elif razorpay.demo_allowed():
            provider, order_id = "demo", None
        else:
            raise HTTPException(503, "Payments are not set up")
        con.execute("insert into purchase(id, account_id, course_id, module_id, kind, amount_inr, provider, order_id) "
                    "values (%s, %s, %s, %s, %s, %s, %s, %s)", (pid, acc, course_id, module_id, kind, amount, provider, order_id))
    return {"purchase_id": pid, "provider": provider, "amount_inr": amount, "order_id": order_id,
            "key_id": razorpay.key_id() if provider == "razorpay" else None, "course_title": c["title"]}


def _mark_paid(con, p: dict, payment_id: str | None) -> dict:
    now = _now()
    c = con.execute("select period_days from course where id = %s", (p["course_id"],)).fetchone()
    until = None
    if p["kind"] == "subscription":
        # extend from the end of any current subscription
        cur = con.execute("select max(valid_until) as u from purchase where account_id = %s and course_id = %s and status = 'paid' "
                          "and kind = 'subscription'", (p["account_id"], p["course_id"])).fetchone()["u"]
        until = max(now, cur or now) + timedelta(days=c["period_days"])
    con.execute("update purchase set status = 'paid', payment_id = %s, paid_at = %s, valid_until = %s where id = %s",
                (payment_id, now, until, p["id"]))
    return {"status": "paid", "valid_until": until.isoformat() if until else None}


class VerifyIn(BaseModel):
    purchase_id: str
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


@router.post("/payments/verify", summary="Razorpay: check the payment signature on the server, then unlock")
def verify_payment(body: VerifyIn, dev: Device = Depends(auth.role_in("student"))):
    with db.connect() as con:
        p = con.execute("select * from purchase where id = %s and account_id = %s", (body.purchase_id, _acc(dev))).fetchone()
        if not p or p["provider"] != "razorpay" or p["order_id"] != body.razorpay_order_id:
            raise HTTPException(404, "No such payment")
        if p["status"] == "paid":
            return {"status": "paid"}
        if not razorpay.signature_ok(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature):
            con.execute("update purchase set status = 'failed' where id = %s", (p["id"],))
            raise HTTPException(400, "Payment signature did not match; nothing was unlocked")
        return _mark_paid(con, p, body.razorpay_payment_id)


@router.post("/payments/{purchase_id}/demo-pay", summary="Demo payment (no Razorpay keys set): no money moves")
def demo_pay(purchase_id: str, dev: Device = Depends(auth.role_in("student"))):
    with db.connect() as con:
        p = con.execute("select * from purchase where id = %s and account_id = %s", (purchase_id, _acc(dev))).fetchone()
        if not p or p["provider"] != "demo":
            raise HTTPException(404, "No such payment")
        if not razorpay.demo_allowed():
            raise HTTPException(403, "Demo payments are off")
        if p["status"] == "paid":
            return {"status": "paid"}
        return _mark_paid(con, p, f"demo_{purchase_id}")


class QuizIn(BaseModel):
    answers: list[int] = Field(max_length=10)


@router.post("/modules/{module_id}/quiz", summary="Mark a lesson's quiz on the server; a pass is skill evidence")
def submit_quiz(module_id: str, body: QuizIn, dev: Device = Depends(auth.device)):
    acc = _acc(dev)
    with db.connect() as con:
        m = con.execute("select * from course_module where id = %s", (module_id,)).fetchone()
        if not m:
            raise HTTPException(404, "No such lesson")
        c = _visible(con, m["course_id"], dev)
        ok, why = module_open(c, m["position"], m["id"], _purchases(con, acc), acc, _now())
        if not ok:
            raise HTTPException(403, why)
        quiz = m["quiz"] or []
        if not quiz:
            raise HTTPException(400, "This lesson has no quiz")
        right = sum(1 for q, a in zip(quiz, body.answers) if q["answer"] == a)
        score = right / len(quiz)
        passed = score >= QUIZ_PASS
        con.execute("insert into module_progress(account_id, module_id, score, passed) values (%s, %s, %s, %s) "
                    "on conflict (account_id, module_id) do update set score = greatest(module_progress.score, excluded.score), "
                    "passed = module_progress.passed or excluded.passed, at = now()", (acc, module_id, score, passed))
    unit = m["subskill_id"] or c["skill_id"]
    return {"score": round(score, 3), "right": right, "total": len(quiz), "passed": passed, "pass_mark": QUIZ_PASS,
            "evidence": {"subskill_id": unit, "score": round(score, 3)} if passed else None,
            "correct": [q["answer"] for q in quiz]}
