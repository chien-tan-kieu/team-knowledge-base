from fastapi.testclient import TestClient
from kb.main import create_app
from tests.conftest import authenticate


def test_healthz_returns_ok():
    tc = TestClient(create_app())
    r = tc.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_unknown_route_returns_flat_not_found():
    tc = TestClient(create_app())
    authenticate(tc)
    r = tc.get("/does-not-exist")
    assert r.status_code == 404
    body = r.json()
    assert body["code"] == "NOT_FOUND"
    assert "request_id" in body
