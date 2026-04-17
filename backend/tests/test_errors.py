from kb.errors import ErrorCode, ErrorResponse


def test_error_codes_are_screaming_snake_case():
    expected = {
        "VALIDATION_ERROR",
        "UNAUTHENTICATED",
        "NOT_FOUND",
        "UPSTREAM_LLM_ERROR",
        "INTERNAL_ERROR",
    }
    assert {c.value for c in ErrorCode} == expected


def test_error_response_serialises_flat():
    resp = ErrorResponse(
        code=ErrorCode.NOT_FOUND,
        message="Job not found.",
        request_id="01HN6YV8XTR9A1TQ2M3X7E1B4C",
    )
    assert resp.model_dump() == {
        "code": "NOT_FOUND",
        "message": "Job not found.",
        "request_id": "01HN6YV8XTR9A1TQ2M3X7E1B4C",
    }


from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from kb.errors import (
    LLMUpstreamError,
    install_error_handlers,
)
from kb.middleware import RequestContextMiddleware
from kb.logging import setup_logging
from pydantic import BaseModel


def _app() -> FastAPI:
    setup_logging(level="WARNING")
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)
    install_error_handlers(app)

    class Body(BaseModel):
        n: int

    @app.get("/boom-http")
    def boom_http():
        raise HTTPException(status_code=404, detail="Thing not found.")

    @app.get("/boom-unknown")
    def boom_unknown():
        raise RuntimeError("internals leaked")

    @app.get("/boom-llm")
    def boom_llm():
        raise LLMUpstreamError()

    @app.post("/validate")
    def validate(body: Body):
        return {"n": body.n}

    return app


def test_http_exception_maps_to_flat_shape():
    tc = TestClient(_app(), raise_server_exceptions=False)
    r = tc.get("/boom-http")
    assert r.status_code == 404
    body = r.json()
    assert body["code"] == "NOT_FOUND"
    assert body["message"] == "Thing not found."
    assert body["request_id"] == r.headers["X-Request-ID"]


def test_unhandled_exception_returns_generic_500():
    tc = TestClient(_app(), raise_server_exceptions=False)
    r = tc.get("/boom-unknown")
    assert r.status_code == 500
    body = r.json()
    assert body["code"] == "INTERNAL_ERROR"
    assert "internals leaked" not in body["message"]
    assert body["request_id"] == r.headers["X-Request-ID"]


def test_llm_upstream_error_maps_to_502():
    tc = TestClient(_app(), raise_server_exceptions=False)
    r = tc.get("/boom-llm")
    assert r.status_code == 502
    body = r.json()
    assert body["code"] == "UPSTREAM_LLM_ERROR"


def test_validation_error_maps_to_422_with_flat_shape():
    tc = TestClient(_app(), raise_server_exceptions=False)
    r = tc.post("/validate", json={"n": "not-an-int"})
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert "n" in body["message"]
