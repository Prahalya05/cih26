"""SEE: score a short video of a student doing a task (faces already blurred on her phone).

Same rules as photos (POST /v2/work-sample/score): needs the photos consent (it covers photos and videos),
hazardous checklist items are removed for under-18s, the video is scored in memory and never stored, and a
teacher confirms. The answer adds the MM:SS moment for each checklist item and any safety notes.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from .. import db, kb
from ..adapters import gemini_video
from ..adapters.gemini import GeminiUnavailable
from ..auth import Device, device
from ..services import safety

router = APIRouter(prefix="/v2", tags=["see"])

VIDEO_TYPES = {"video/webm", "video/mp4", "video/quicktime", "video/3gpp"}


@router.post("/work-sample/video", summary="Score a short task video step by step with time stamps (AI; a teacher confirms)")
async def score_video(student_id: str = Form(...), rubric_id: str = Form(...), process: str = Form("{}"),
                      video: UploadFile = File(...), dev: Device = Depends(device)):
    rubric = kb.rubrics().get(rubric_id)
    if not rubric:
        raise HTTPException(404, "Unknown checklist")
    with db.connect(dev.schools) as con:
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
    data = await video.read()
    if len(data) > gemini_video.MAX_VIDEO_BYTES:
        raise HTTPException(413, "Video too large; keep it under 30 seconds")
    try:
        proc = json.loads(process)
        proc = proc if isinstance(proc, dict) else {}
    except json.JSONDecodeError:
        proc = {}
    try:
        out = gemini_video.score(rubric, data, mime, proc)
    except GeminiUnavailable:
        raise HTTPException(503, "AI scoring unavailable; a teacher will score this video") from None
    return {**out, "rubric_id": rubric_id, "scorer": "ai", "media": "video"}
