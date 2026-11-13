"""Disha API server.

Run:  uvicorn app.main:app --reload --port 8000   (from apps/api)
Docs: http://localhost:8000/docs

If apps/web/dist exists (after `npm run build`), the app itself is served at / as well.
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import settings
from .adapters import gemini
from .routers import v1

app = FastAPI(
    title="Disha API",
    version="0.1.0",
    description="Career matching, scheme eligibility and facilitator sync for rural students. Apache-2.0.",
    license_info={"name": "Apache-2.0", "identifier": "Apache-2.0"},
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(v1.router)


@app.get("/health")
def health():
    return {"ok": True, "ai": "gemini" if gemini.enabled() else "keywords"}


WEB_DIST = Path(os.getenv("WEB_DIST", Path(__file__).resolve().parents[2] / "web" / "dist"))
if WEB_DIST.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
