"""SEE: score a short video of a student doing a task (faces already blurred on her phone).

Same rules as photos (POST /v2/work-sample/score): needs the photos consent (it covers photos and videos),
hazardous checklist items are removed for under-18s, the video is scored in memory and never stored, and a
teacher confirms. The answer adds the MM:SS moment for each checklist item and any safety notes.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from .. import auth, db, kb
from ..adapters import gemini_video
from ..adapters.gemini import GeminiUnavailable
from ..auth import Device, device
from ..services import safety, trust

router = APIRouter(prefix="/v2", tags=["see"])

VIDEO_TYPES = {"video/webm", "video/mp4", "video/quicktime", "video/3gpp"}


@router.post("/work-sample/video", summary="Score a short task video step by step with time stamps (AI; a teacher confirms)")
async def score_video(student_id: str = Form(...), rubric_id: str = Form(...), process: str = Form("{}"),
                      identity: str = Form("{}", description="Face-match numbers and liveness from her phone (rule.identity)"),
                      integrity: str = Form("[]", description="Integrity flags seen while filming"),
                      integrity_counts: str = Form("{}", description="How many times each warning happened (trust score)"),
                      moments: str = Form("[]", description="When each warning started, in seconds, so the AI can look there"),
                      sample_id: str = Form("", description="The sample's event id: picks the random spot check"),
                      mode: str = Form("short", description="short: one normal video; long: one picture a second plus clips"),
                      clip_info: str = Form("[]", description="Long task: for each clip, {at: seconds, why: active|final}"),
                      video: UploadFile = File(...), clips: list[UploadFile] = File(default=[]),
                      dev: Device = Depends(device)):
    rubric = kb.rubrics().get(rubric_id)
    if not rubric:
        raise HTTPException(404, "Unknown checklist")
    with db.connect(dev.schools) as con:
        auth.check_student_access(con, dev, student_id)
        ok = con.execute("select 1 from consent where student_id = %s and revoked_at is null and 'photos' = any(scopes)",
                         (student_id,)).fetchone()
        st = con.execute("select birth_year from student where id = %s", (student_id,)).fetchone()
    if not ok:
        raise HTTPException(403, "No consent to check photos or videos for this student")
    rubric = safety.safe_rubric(kb.graph(), rubric, safety.is_minor(st["birth_year"] if st else None))
    if rubric is None:
        raise HTTPException(403, "This task is not allowed under 18")
    mime = (video.content_type or "video/webm").split(";")[0]
    if mime not in VIDEO_TYPES:
        raise HTTPException(415, "Send a WebM or MP4 video")
    long = mode == "long"
    data = await video.read()
    if len(data) > (gemini_video.MAX_LONG_VIDEO_BYTES if long else gemini_video.MAX_VIDEO_BYTES):
        raise HTTPException(413, "Video too large")
    extra: list[tuple[bytes, str, dict]] = []
    if long:
        infos = [i for i in _json(clip_info, []) if isinstance(i, dict)]
        if len(clips) > gemini_video.MAX_CLIPS:
            raise HTTPException(413, "Too many clips")
        for i, c in enumerate(clips):
            cm = (c.content_type or "video/webm").split(";")[0]
            if cm not in VIDEO_TYPES:
                raise HTTPException(415, "Send WebM or MP4 clips")
            b = await c.read()
            if len(b) > gemini_video.MAX_CLIP_BYTES:
                raise HTTPException(413, "Clip too large")
            info = infos[i] if i < len(infos) else {}
            at = info.get("at") if isinstance(info.get("at"), (int, float)) and not isinstance(info.get("at"), bool) else 0
            extra.append((b, cm, {"at": max(0, at), "why": "final" if info.get("why") == "final" else "active"}))
    try:
        proc = json.loads(process)
        proc = proc if isinstance(proc, dict) else {}
    except json.JSONDecodeError:
        proc = {}
    try:
        marks = [m for m in _json(moments, []) if isinstance(m, dict)][:60]
        # a short task is scored exactly as before; only a long task passes its clips
        out = gemini_video.score(rubric, data, mime, proc, marks, **({"clips": extra} if long else {}))
    except GeminiUnavailable:
        raise HTTPException(503, "AI scoring unavailable; a teacher will score this video") from None
    # Rules after the AI: is it really her (rule.identity), and may the system confirm the score itself (rule.autoconfirm)?
    ident = trust.identity_check(_json(identity, {}))
    with db.connect() as con:
        rows = con.execute("select * from evidence_event where kind in ('work_sample', 'rating') order by created_at, id").fetchall()
    from .trust import ai_kappa
    from .v2 import _row_to_event
    kappa, kappa_basis = ai_kappa([_row_to_event(r) for r in rows])
    flags = [str(f) for f in _json(integrity, []) if isinstance(f, str)][:10]
    # Trust score (rule, not AI): worked out here again from the counts, never taken from the phone or the AI.
    # The AI can only add one more warning, "ai_noticed", per suspicious moment it reports.
    counts = {k: v for k, v in _json(integrity_counts, {}).items() if k != "ai_noticed"}
    if out.get("suspicious"):
        counts["ai_noticed"] = len(out["suspicious"])
        flags.append("ai_noticed")
    trusted = trust.trust_score(counts, proc.get("seconds"))
    auto = trust.auto_confirm({"trust_score": trusted["score"],"identity": ident["status"], "integrity_flags": flags, "safety_flags": len(out.get("safety") or []),
                               "cannot_see": len(out.get("cannot_see") or []), "criteria": len(rubric["criteria"]),
                               "ai_kappa": kappa, "audit_draw": trust.draw_from_id(sample_id or student_id + rubric_id)})
    auto["kappa_basis"] = kappa_basis
    return {**out, "rubric_id": rubric_id, "scorer": "ai", "media": "video", "identity": ident, "trust": trusted,
            "autoconfirm": auto}


def _json(raw: str, default):
    try:
        v = json.loads(raw)
        return v if isinstance(v, type(default)) else default
    except json.JSONDecodeError:
        return default
