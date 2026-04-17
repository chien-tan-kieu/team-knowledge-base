from fastapi import FastAPI
from fastapi.testclient import TestClient
from kb.middleware import RequestContextMiddleware
from kb.logging import setup_logging


def _build_app() -> FastAPI:
    setup_logging(level="INFO")
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)

    @app.get("/ping")
    def ping():
        return {"ok": True}

    return app


def test_response_has_x_request_id_header():
    tc = TestClient(_build_app())
    response = tc.get("/ping")
    assert response.status_code == 200
    rid = response.headers.get("X-Request-ID")
    assert rid is not None and len(rid) >= 10


def test_request_ids_are_unique_per_request():
    tc = TestClient(_build_app())
    a = tc.get("/ping").headers["X-Request-ID"]
    b = tc.get("/ping").headers["X-Request-ID"]
    assert a != b
