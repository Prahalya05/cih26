"""Online classrooms: the second way into a class, next to a school's code.

A teacher who signed up without a school code makes classrooms and says who each is for (age range, state,
district, language, seats). A student who signed up without a class code searches the open classrooms that fit
her and asks to join. The teacher sees only what the student chose to send (name, age, place, a note) and approves
or declines. Only on approval is the student put in the class: her account and phones get the classroom's school,
so syncing and row-level security work exactly as for a school's class code.

Rules (the server decides, the screen only shows):
  - a request must fit the classroom: age in range, same state and district when the classroom names them,
    a seat left, the classroom open
  - a student is in one class at a time: she can ask several, the first approval wins and her other requests close
  - she can leave an online classroom whenever she wants; her record then leaves the teacher's view
  - only the teacher who made a classroom sees its requests and decides them
  - students see an online teacher's classrooms only after a Disha reviewer has checked her teaching proof
    (a teacher who joined with a school's teacher code is vouched for by that school)
"""
from __future__ import annotations

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field

from .. import auth, db
from ..auth import Device
from ..ratelimit import limit
from ..schemas import new_ulid
from .accounts import _account, _public
from .v1 import _admin

router = APIRouter(prefix="/v2/classrooms", tags=["online classrooms"])
review = APIRouter(prefix="/v2/review", tags=["online classrooms"])

DOC_KINDS = ("school_id", "tet", "bed", "appointment", "other")
PHOTO_TYPES = ("image/jpeg", "image/png", "image/webp")
MAX_PHOTO = 4 * 1024 * 1024

# A classroom is shown to students when its teacher is vouched for: by a physical school (teacher code) or by a reviewer.
VOUCHED = ("(s.kind = 'school' "
           "or exists (select 1 from account ta join school ts on ts.id = ta.school_id "
           "where ta.id = c.teacher_account and ts.kind = 'school') "
           "or exists (select 1 from teacher_verification v "
           "where v.account_id = c.teacher_account and v.status = 'approved'))")

CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _norm(x: str | None) -> str | None:
    x = (x or "").strip()
    return x or None


def _same(a: str | None, b: str | None) -> bool:
    return (a or "").strip().lower() == (b or "").strip().lower()


def fits(room: dict, age: int, state: str | None, district: str | None) -> str | None:
    """None when the student fits the classroom; otherwise why not, in plain words."""
    if room["min_age"] is not None and age < room["min_age"]:
        return f"This class is for ages {room['min_age']} and above"
    if room["max_age"] is not None and age > room["max_age"]:
        return f"This class is for ages up to {room['max_age']}"
    if room["state"] and not _same(room["state"], state):
        return f"This class is only for students in {room['state']}"
    if room["district"] and not _same(room["district"], district):
        return f"This class is only for students in {room['district']} district"
    return None


def _members(con, room: dict) -> int:
    return con.execute("select count(*) as n from account where school_id = %s and class_code = %s and role = 'student' "
                       "and disabled_at is null", (room["school_id"], room["code"])).fetchone()["n"]


def _room_out(con, room: dict, teacher_name: str | None = None) -> dict:
    members = _members(con, room)
    return {"code": room["code"], "name": room["name"], "about": room["about"], "language": room["language"],
            "state": room["state"], "district": room["district"], "min_age": room["min_age"], "max_age": room["max_age"],
            "seats": room["seats"], "seats_left": max(0, room["seats"] - members), "members": members, "open": room["open"],
            "teacher": teacher_name, "school": room.get("school_name"), "online": room.get("school_kind") == "online"}


def _set_school(con, account_id: str, school_id: str | None, class_code: str | None) -> None:
    """Puts an account (and every phone signed in to it) in a school, or takes it out."""
    con.execute("update account set school_id = %s, class_code = %s where id = %s", (school_id, class_code, account_id))
    con.execute("update device set school_id = %s where account_id = %s", (school_id, account_id))


# ---------- teachers ----------

class RoomIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    about: str | None = Field(None, max_length=400)
    language: str | None = Field(None, max_length=8)
    state: str | None = Field(None, max_length=40)
    district: str | None = Field(None, max_length=40)
    min_age: int | None = Field(None, ge=5, le=99)
    max_age: int | None = Field(None, ge=5, le=99)
    seats: int = Field(40, ge=1, le=500)
    open: bool = True


def _teacher(dev: Device) -> dict:
    acc = _account(dev)
    if acc["role"] != "teacher":
        raise HTTPException(403, "Only teachers make classrooms")
    return acc


def _new_code(con) -> str:
    for _ in range(20):
        code = "ONL-" + "".join(secrets.choice(CODE_LETTERS) for _ in range(6))
        taken = con.execute("select 1 from classroom where code = %s union all select 1 from join_code where code = %s",
                            (code, code)).fetchone()
        if not taken:
            return code
    raise HTTPException(503, "Could not make a classroom code; try again")


@router.post("", summary="Teacher: make an online classroom and say who it is for",
             dependencies=[Depends(limit("classroom_make", per_minute=10))])
def make_classroom(body: RoomIn, dev: Device = Depends(auth.device)):
    if body.min_age is not None and body.max_age is not None and body.min_age > body.max_age:
        raise HTTPException(400, "The youngest age must not be above the oldest")
    acc = _teacher(dev)
    with db.connect() as con:
        # Online classrooms always live in an 'online' school so online students stay isolated from a teacher's physical school.
        online_row = con.execute(
            "select c.school_id from classroom c join school s on s.id = c.school_id "
            "where c.teacher_account = %s and s.kind = 'online' limit 1", (acc["id"],)).fetchone()
        acc_school = con.execute("select id, kind from school where id = %s", (acc["school_id"],)).fetchone() if acc["school_id"] else None
        if online_row:
            school_id = online_row["school_id"]
        elif acc_school and acc_school["kind"] == "online":
            school_id = acc_school["id"]
        else:
            school_id = f"onl_{new_ulid()}"
            con.execute("insert into school(id, name, district, kind) values (%s, %s, %s, 'online')",
                        (school_id, f"{acc['name']} (online)", _norm(body.district) or "Online"))
        code = _new_code(con)
        con.execute("insert into classroom(code, school_id, teacher_account, name, about, language, state, district, "
                    "min_age, max_age, seats, open) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (code, school_id, acc["id"], body.name.strip(), _norm(body.about), _norm(body.language), _norm(body.state),
                     _norm(body.district), body.min_age, body.max_age, body.seats, body.open))
        if not acc["school_id"]:
            _set_school(con, acc["id"], school_id, acc["class_code"] or code)
        room = con.execute("select c.*, s.name as school_name, s.kind as school_kind from classroom c "
                           "join school s on s.id = c.school_id where c.code = %s", (code,)).fetchone()
        fresh = con.execute("select * from account where id = %s", (acc["id"],)).fetchone()
        return {"classroom": _room_out(con, room, acc["name"]), "account": _public(fresh, con)}


@router.get("/mine", summary="Teacher: my classrooms, with how many requests are waiting")
def my_classrooms(dev: Device = Depends(auth.device)):
    acc = _teacher(dev)
    with db.connect() as con:
        rooms = con.execute("select c.*, s.name as school_name, s.kind as school_kind from classroom c "
                            "join school s on s.id = c.school_id where c.teacher_account = %s order by c.created_at",
                            (acc["id"],)).fetchall()
        out = []
        for r in rooms:
            row = _room_out(con, r, acc["name"])
            row["waiting"] = con.execute("select count(*) as n from join_request where classroom_code = %s and status = 'pending'",
                                         (r["code"],)).fetchone()["n"]
            out.append(row)
        check = _check_state(con, acc)
    return {"classrooms": out, "verification": check}


def _own_room(con, acc: dict, code: str) -> dict:
    room = con.execute("select * from classroom where code = %s", (code.upper(),)).fetchone()
    if not room or room["teacher_account"] != acc["id"]:
        raise HTTPException(404, "No such classroom of yours")
    return room


@router.patch("/{code}", summary="Teacher: change a classroom, or open and close it to new requests")
def edit_classroom(code: str, body: RoomIn, dev: Device = Depends(auth.device)):
    if body.min_age is not None and body.max_age is not None and body.min_age > body.max_age:
        raise HTTPException(400, "The youngest age must not be above the oldest")
    acc = _teacher(dev)
    with db.connect() as con:
        room = _own_room(con, acc, code)
        con.execute("update classroom set name = %s, about = %s, language = %s, state = %s, district = %s, min_age = %s, "
                    "max_age = %s, seats = %s, open = %s where code = %s",
                    (body.name.strip(), _norm(body.about), _norm(body.language), _norm(body.state), _norm(body.district),
                     body.min_age, body.max_age, body.seats, body.open, room["code"]))
        updated = con.execute("select c.*, s.name as school_name, s.kind as school_kind from classroom c "
                              "join school s on s.id = c.school_id where c.code = %s", (room["code"],)).fetchone()
        return {"classroom": _room_out(con, updated, acc["name"])}


@router.get("/{code}/requests", summary="Teacher: who asked to join this classroom")
def room_requests(code: str, dev: Device = Depends(auth.device)):
    acc = _teacher(dev)
    with db.connect() as con:
        room = _own_room(con, acc, code)
        rows = con.execute("select r.id, a.name, r.age, r.state, r.district, r.note, r.status, r.created_at from join_request r "
                           "join account a on a.id = r.student_account "
                           "where r.classroom_code = %s and r.status in ('pending', 'approved') order by r.created_at desc limit 200",
                           (room["code"],)).fetchall()
    return {"requests": rows}


class DecideIn(BaseModel):
    approve: bool


@router.post("/requests/{request_id}/decide", summary="Teacher: approve or decline a request to join")
def decide(request_id: str, body: DecideIn, dev: Device = Depends(auth.device)):
    acc = _teacher(dev)
    with db.connect() as con:
        req = con.execute("select * from join_request where id = %s for update", (request_id,)).fetchone()
        if not req:
            raise HTTPException(404, "No such request")
        room = _own_room(con, acc, req["classroom_code"])
        if req["status"] != "pending":
            raise HTTPException(409, "This request was already decided or taken back")
        if not body.approve:
            con.execute("update join_request set status = 'declined', decided_at = now() where id = %s", (request_id,))
            return {"status": "declined"}
        student = con.execute("select * from account where id = %s for update", (req["student_account"],)).fetchone()
        if not student or student["disabled_at"] is not None:
            raise HTTPException(409, "This student's account is closed")
        if student["school_id"]:
            con.execute("update join_request set status = 'cancelled', decided_at = now() where id = %s", (request_id,))
            return {"status": "cancelled", "reason": "The student has already joined another class"}
        if _members(con, room) >= room["seats"]:
            raise HTTPException(409, "The classroom is full; add seats first")
        _set_school(con, student["id"], room["school_id"], room["code"])
        con.execute("update join_request set status = 'approved', decided_at = now() where id = %s", (request_id,))
        # One class at a time: her other open requests close.
        con.execute("update join_request set status = 'cancelled', decided_at = now() "
                    "where student_account = %s and status = 'pending'", (student["id"],))
    return {"status": "approved"}


# ---------- students ----------

@router.get("", summary="Open online classrooms that fit a student (age, place, language)")
def search(age: int | None = Query(None, ge=5, le=99), state: str | None = None, district: str | None = None,
           language: str | None = None, q: str | None = None, dev: Device = Depends(auth.device)):
    with db.connect() as con:
        rows = con.execute(
            "select c.*, a.name as teacher_name, s.name as school_name, s.kind as school_kind from classroom c "
            "join account a on a.id = c.teacher_account join school s on s.id = c.school_id "
            f"where c.open and a.disabled_at is null and {VOUCHED} order by c.created_at desc limit 300").fetchall()
        out = []
        for r in rows:
            if age is not None and ((r["min_age"] is not None and age < r["min_age"]) or (r["max_age"] is not None and age > r["max_age"])):
                continue
            # Place is matched only when she gave one; asking to join checks it strictly.
            if state and r["state"] and not _same(r["state"], state):
                continue
            if district and r["district"] and not _same(r["district"], district):
                continue
            if language and r["language"] and r["language"] != language:
                continue
            if q and q.strip().lower() not in f"{r['name']} {r['about'] or ''} {r['teacher_name']}".lower():
                continue
            room = _room_out(con, r, r["teacher_name"])
            if room["seats_left"] > 0:
                # Closest first: her district, then her state, then anywhere.
                room["near"] = 2 if district and _same(r["district"], district) else 1 if state and _same(r["state"], state) else 0
                out.append(room)
    out.sort(key=lambda x: (-x["near"], -x["seats_left"]))
    return {"classrooms": out[:50]}


class AskIn(BaseModel):
    age: int = Field(ge=5, le=99)
    state: str | None = Field(None, max_length=40)
    district: str | None = Field(None, max_length=40)
    note: str | None = Field(None, max_length=300)


def _student(dev: Device) -> dict:
    acc = _account(dev)
    if acc["role"] != "student":
        raise HTTPException(403, "Only students ask to join a classroom")
    return acc


@router.post("/{code}/join", summary="Student: ask to join a classroom (the teacher approves)",
             dependencies=[Depends(limit("classroom_join", per_minute=10))])
def ask_to_join(code: str, body: AskIn, dev: Device = Depends(auth.device)):
    acc = _student(dev)
    if acc["school_id"]:
        raise HTTPException(409, "You are already in a class. Leave it first to join another")
    with db.connect() as con:
        room = con.execute(f"select c.* from classroom c join school s on s.id = c.school_id where c.code = %s and {VOUCHED}",
                           (code.upper(),)).fetchone()
        if not room or not room["open"]:
            raise HTTPException(404, "This classroom is not taking requests")
        why = fits(room, body.age, body.state, body.district)
        if why:
            raise HTTPException(400, why)
        if _members(con, room) >= room["seats"]:
            raise HTTPException(409, "This classroom is full")
        if con.execute("select 1 from join_request where classroom_code = %s and student_account = %s and status = 'pending'",
                       (room["code"], acc["id"])).fetchone():
            raise HTTPException(409, "You have already asked; wait for the teacher")
        rid = f"jr_{new_ulid()}"
        con.execute("insert into join_request(id, classroom_code, student_account, age, state, district, note) "
                    "values (%s, %s, %s, %s, %s, %s, %s)",
                    (rid, room["code"], acc["id"], body.age, _norm(body.state), _norm(body.district), _norm(body.note)))
    return {"id": rid, "status": "pending"}


@router.get("/requests/mine", summary="Student: my requests and whether they were approved")
def my_requests(dev: Device = Depends(auth.device)):
    acc = _student(dev)
    with db.connect() as con:
        rows = con.execute(
            "select r.id, r.status, r.created_at, r.decided_at, c.code, c.name, a.name as teacher from join_request r "
            "join classroom c on c.code = r.classroom_code join account a on a.id = c.teacher_account "
            "where r.student_account = %s order by r.created_at desc limit 50", (acc["id"],)).fetchall()
        return {"requests": rows, "account": _public(acc, con)}


@router.delete("/requests/{request_id}", summary="Student: take back a request that is still waiting")
def cancel(request_id: str, dev: Device = Depends(auth.device)):
    acc = _student(dev)
    with db.connect() as con:
        n = con.execute("update join_request set status = 'cancelled', decided_at = now() "
                        "where id = %s and student_account = %s and status = 'pending'", (request_id, acc["id"])).rowcount
    if n != 1:
        raise HTTPException(404, "No waiting request to take back")
    return {"status": "cancelled"}


@router.post("/leave", summary="Student: leave my online classroom; my record leaves the teacher's view")
def leave(dev: Device = Depends(auth.device)):
    acc = _student(dev)
    with db.connect() as con:
        room = con.execute("select c.* from classroom c join school s on s.id = c.school_id "
                           "where c.code = %s and c.school_id = %s and s.kind = 'online'",
                           (acc["class_code"], acc["school_id"])).fetchone() if acc["school_id"] else None
        if not room:
            raise HTTPException(409, "You are not in an online classroom (a school class is left through the school)")
        _set_school(con, acc["id"], None, None)
        con.execute("update join_request set status = 'left', decided_at = now() "
                    "where student_account = %s and classroom_code = %s and status = 'approved'", (acc["id"], room["code"]))
        if acc["student_id"]:
            # Unclaimed again: the next class she joins takes the record over on her next sync,
            # and her old online teacher's cohort no longer lists her.
            con.execute("update student set school_id = null, facilitator_code = null where id = %s and school_id = %s",
                        (acc["student_id"], room["school_id"]))
            con.execute("delete from legacy_student_doc where id = %s and school_id = %s",
                        (acc["student_id"], room["school_id"]))
        fresh = con.execute("select * from account where id = %s", (acc["id"],)).fetchone()
        return {"account": _public(fresh, con)}


# ---------- teacher verification (a person checks a teaching proof) ----------

def _check_state(con, acc: dict) -> dict:
    """Is this teacher vouched for? {status: by_school | approved | pending | rejected | none, reason}"""
    if acc["school_id"]:
        kind = con.execute("select kind from school where id = %s", (acc["school_id"],)).fetchone()
        if kind and kind["kind"] == "school":
            return {"status": "by_school", "reason": None, "doc_kind": None}
    v = con.execute("select status, reason, doc_kind from teacher_verification where account_id = %s", (acc["id"],)).fetchone()
    return {"status": v["status"], "reason": v["reason"], "doc_kind": v["doc_kind"]} if v else {"status": "none", "reason": None, "doc_kind": None}


@router.get("/verification", summary="Teacher: is my teaching proof checked yet?")
def verification(dev: Device = Depends(auth.device)):
    acc = _teacher(dev)
    with db.connect() as con:
        return _check_state(con, acc)


@router.post("/verification", summary="Teacher: send one teaching proof for a reviewer to check",
             dependencies=[Depends(limit("teacher_proof", per_minute=5))])
async def send_proof(kind: str = Form(...), note: str | None = Form(None), photo: UploadFile = File(...),
                     dev: Device = Depends(auth.device)):
    acc = _teacher(dev)
    if kind not in DOC_KINDS:
        raise HTTPException(400, "Choose what kind of proof this is")
    if photo.content_type not in PHOTO_TYPES:
        raise HTTPException(400, "Send a photo (JPEG, PNG or WebP)")
    data = await photo.read(MAX_PHOTO + 1)
    if len(data) > MAX_PHOTO:
        raise HTTPException(413, "The photo is too big (4 MB at most)")
    if len(data) < 1000:
        raise HTTPException(400, "The photo looks empty; take it again")
    with db.connect() as con:
        state = _check_state(con, acc)
        if state["status"] in ("by_school", "approved"):
            raise HTTPException(409, "You are already checked")
        con.execute("insert into teacher_verification(account_id, doc_kind, photo, photo_type, note, status) "
                    "values (%s, %s, %s, %s, %s, 'pending') on conflict (account_id) do update set doc_kind = excluded.doc_kind, "
                    "photo = excluded.photo, photo_type = excluded.photo_type, note = excluded.note, status = 'pending', "
                    "reason = null, submitted_at = now(), decided_at = null",
                    (acc["id"], kind, data, photo.content_type, _norm((note or "")[:300])))
        return _check_state(con, acc)


@review.get("/teachers", summary="Reviewer: teaching proofs waiting to be checked")
def pending_teachers(_: str = Depends(_admin)):
    with db.connect() as con:
        rows = con.execute(
            "select v.account_id, a.name, a.login_masked as login, v.doc_kind, v.note, v.submitted_at, "
            "(select count(*) from classroom c where c.teacher_account = v.account_id) as classrooms "
            "from teacher_verification v join account a on a.id = v.account_id "
            "where v.status = 'pending' order by v.submitted_at limit 100").fetchall()
    return {"teachers": rows}


@review.get("/teachers/{account_id}/photo", summary="Reviewer: the proof photo (deleted once decided)")
def teacher_photo(account_id: str, _: str = Depends(_admin)):
    with db.connect() as con:
        v = con.execute("select photo, photo_type from teacher_verification where account_id = %s and status = 'pending'",
                        (account_id,)).fetchone()
    if not v or not v["photo"]:
        raise HTTPException(404, "No photo waiting")
    return Response(content=bytes(v["photo"]), media_type=v["photo_type"], headers={"Cache-Control": "no-store"})


class ReviewIn(BaseModel):
    approve: bool
    reason: str | None = Field(None, max_length=300)


@review.post("/teachers/{account_id}", summary="Reviewer: approve or reject; the photo is deleted either way")
def review_teacher(account_id: str, body: ReviewIn, _: str = Depends(_admin)):
    if not body.approve and not _norm(body.reason):
        raise HTTPException(400, "Say why, so the teacher can fix it")
    with db.connect() as con:
        n = con.execute("update teacher_verification set status = %s, reason = %s, photo = null, photo_type = null, "
                        "decided_at = now() where account_id = %s and status = 'pending'",
                        ("approved" if body.approve else "rejected", None if body.approve else _norm(body.reason), account_id)).rowcount
    if n != 1:
        raise HTTPException(404, "Nothing waiting for this teacher")
    return {"status": "approved" if body.approve else "rejected"}
