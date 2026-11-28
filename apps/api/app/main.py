"""Disha API server.

Run:  uvicorn app.main:app --reload --port 8000   (from apps/api)
Docs: http://localhost:8000/docs

If apps/web/dist exists (after `npm run build`), the app itself is served at / as well.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import db, settings
from .adapters import gemini
from .routers import accounts, classrooms, courses, proof, publish, see, trust, v1, v2


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings.validate_pii_key()
    db.pool()  # one pool, made before the first request instead of by whichever request comes first
    yield
    db.close_pool()


app = FastAPI(
    lifespan=lifespan,
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
app.include_router(accounts.router)
app.include_router(v1.router)
app.include_router(v2.router)
app.include_router(see.router)
app.include_router(proof.router)
app.include_router(trust.router)
app.include_router(courses.router)
app.include_router(publish.router)
app.include_router(classrooms.router)
app.include_router(classrooms.review)


@app.get("/health")
def health():
    return {"ok": True, "ai": "gemini" if gemini.enabled() else "keywords"}


class _WebFiles(StaticFiles):
    """Hashed build files never change, so cache them for a year. Everything else (index.html,
    sw.js, the manifest) must be rechecked every time, or a browser keeps an old index.html that
    points at chunk names the new deploy no longer has."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if path.replace("\\", "/").startswith("assets/") and response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "no-cache"
        return response


WEB_DIST = Path(os.getenv("WEB_DIST", Path(__file__).resolve().parents[2] / "web" / "dist"))
if WEB_DIST.is_dir():
    app.mount("/", _WebFiles(directory=WEB_DIST, html=True), name="web")
