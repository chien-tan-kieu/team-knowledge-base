from fastapi import FastAPI
from fastapi.testclient import TestClient
from kb.auth.middleware import AuthMiddleware
from kb.auth.routes import router as auth_router
from kb.errors import install_error_handlers
from kb.middleware import RequestContextMiddleware
from kb.logging import setup_logging


def _app() -> FastAPI:
    setup_logging(level="WARNING")
    app = FastAPI()
    app.add_middleware(AuthMiddleware)
    app.add_middleware(RequestContextMiddleware)
    install_error_handlers(app)
    app.include_router(auth_router)

    @app.get("/api/private")
    def private():
        return {"ok": True}

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    return app


def test_private_route_without_cookie_returns_401():
    tc = TestClient(_app())
    r = tc.get("/api/private")
    assert r.status_code == 401
    assert r.json()["code"] == "UNAUTHENTICATED"


def test_private_route_with_valid_cookie_passes():
    tc = TestClient(_app())
    tc.get("/api/auth/session", headers={"Origin": "http://localhost:5173"})
    r = tc.get("/api/private")
    assert r.status_code == 200


def test_session_route_is_bypass():
    tc = TestClient(_app())
    r = tc.get("/api/auth/session", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 204


def test_healthz_is_bypass():
    tc = TestClient(_app())
    assert tc.get("/healthz").status_code == 200


def test_tampered_cookie_returns_401():
    tc = TestClient(_app())
    tc.cookies.set("kb_session", "not-a-valid-jwt")
    r = tc.get("/api/private")
    assert r.status_code == 401
