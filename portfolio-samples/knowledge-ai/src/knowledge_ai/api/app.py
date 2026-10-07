"""HTTP API + single-page UI.

Endpoints
---------
``POST /ask``        question → answer with verified citations (or abstention)
``GET  /documents``  indexed documents with source URL, licence and attribution
``GET  /health``     readiness and configuration summary
``GET  /``           web UI (static files, no build step)
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from knowledge_ai import __version__
from knowledge_ai.answer.base import ProviderError
from knowledge_ai.api.ratelimit import RateLimiter
from knowledge_ai.config import Settings
from knowledge_ai.schemas import AnswerResult, DocumentInfo
from knowledge_ai.service import AnswerService

log = logging.getLogger(__name__)
STATIC_DIR = Path(__file__).parent / "static"

_RATE_MESSAGES = {
    "minute": "短時間に質問が集中しています。少し時間をおいてから再度お試しください。",
    "ip_daily": "本日の質問回数の上限に達しました。明日またお試しください。",
    "daily": "デモ全体の本日の利用上限に達しました。明日またお試しください。",
}

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
        "connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    ),
}


class AskRequest(BaseModel):
    question: str = Field(min_length=1, description="Question in Japanese")
    mode: Literal["hybrid", "bm25", "dense"] = "hybrid"


def client_ip(request: Request, trust_proxy_headers: bool) -> str:
    if trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def create_app(service: AnswerService | None = None, settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if app.state.service is None:
            try:
                app.state.service = AnswerService.from_settings(settings)
            except Exception as e:  # index missing, model download failed, …
                log.exception("could not load the index")
                app.state.load_error = f"{type(e).__name__}: {e}"
        yield

    app = FastAPI(title="AI総務さん API", version=__version__, lifespan=lifespan)
    app.state.service = service
    app.state.load_error = None
    app.state.limiter = RateLimiter(
        settings.rate_limit_per_minute,
        settings.per_ip_daily_cap,
        settings.daily_cap,
        settings.timezone,
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        for k, v in _SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        return response

    def get_service() -> AnswerService:
        svc: AnswerService | None = app.state.service
        if svc is None:
            raise HTTPException(
                503, detail="インデックスが読み込まれていません (run `make ingest`)."
            )
        return svc

    @app.post("/ask", response_model=AnswerResult)
    def ask(body: AskRequest, request: Request) -> AnswerResult | JSONResponse:
        question = body.question.strip()
        if not question:
            raise HTTPException(422, detail="質問を入力してください。")
        if len(question) > settings.max_question_chars:
            raise HTTPException(
                422, detail=f"質問は{settings.max_question_chars}文字以内で入力してください。"
            )
        decision = app.state.limiter.check(client_ip(request, settings.trust_proxy_headers))
        if not decision.allowed:
            return JSONResponse(
                status_code=429,
                content={"detail": _RATE_MESSAGES[decision.reason or "minute"]},
                headers={"Retry-After": str(decision.retry_after)},
            )
        svc = get_service()
        try:
            return svc.ask(question, mode=body.mode)
        except ProviderError as e:
            log.warning("provider error: %s", e)
            raise HTTPException(
                503, detail="回答の生成に失敗しました。時間をおいて再度お試しください。"
            ) from e

    @app.get("/documents", response_model=list[DocumentInfo])
    def documents() -> list[DocumentInfo]:
        return get_service().document_infos()

    @app.get("/health", response_model=None)
    def health() -> dict | JSONResponse:
        svc: AnswerService | None = app.state.service
        if svc is None:
            return JSONResponse(
                status_code=503,
                content={
                    "status": "unavailable",
                    "version": __version__,
                    "error": app.state.load_error,
                },
            )
        provider = svc.provider
        return {
            "status": "ok",
            "version": __version__,
            "documents": len(svc.documents),
            "chunks": len(svc.retriever.chunks),
            "embedder": svc.retriever.embedder.name,
            "provider": provider.name,
            "model": getattr(provider, "model", None),
            "abstain_threshold": svc.policy.threshold,
            "requests_today": app.state.limiter.used_today,
        }

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    return app
