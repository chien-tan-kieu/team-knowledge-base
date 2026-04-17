from fastapi import FastAPI
from fastapi.testclient import TestClient
from kb.auth.routes import router as auth_router
from kb.errors import install_error_handlers
from kb.middleware import RequestContextMiddleware
from kb.logging import setup_logging


def _app() -> FastAPI:
    setup_logging(level="WARNING")
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)
    install_error_handlers(app)
    app.include_router(auth_router)
    return app


def test_session_returns_204_with_cookie_for_allowed_origin():
    tc = TestClient(_app())
    r = tc.get("/api/auth/session", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 204
    cookie = r.cookies.get("kb_session")
    assert cookie is not None and len(cookie) > 10
    # Must be httpOnly — check the raw Set-Cookie header.
    raw = r.headers.get("set-cookie", "")
    assert "HttpOnly" in raw
    assert "SameSite=lax" in raw.lower() or "samesite=lax" in raw.lower()


def test_session_rejects_disallowed_origin():
    tc = TestClient(_app())
    r = tc.get("/api/auth/session", headers={"Origin": "https://evil.example"})
    assert r.status_code == 401
    assert r.json()["code"] == "UNAUTHENTICATED"


def test_session_rejects_missing_origin():
    tc = TestClient(_app())
    r = tc.get("/api/auth/session")
    assert r.status_code == 401
