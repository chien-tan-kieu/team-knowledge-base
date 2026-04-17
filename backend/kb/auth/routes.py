from fastapi import APIRouter, HTTPException, Request, Response

from kb.auth.jwt import encode_session_jwt
from kb.config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE_NAME = "kb_session"


@router.get("/session")
def bootstrap_session(request: Request):
    origin = request.headers.get("origin")
    if origin not in settings.allowed_origins:
        raise HTTPException(status_code=401, detail="Session required.")

    token = encode_session_jwt(
        secret=settings.jwt_secret,
        ttl_seconds=settings.jwt_ttl_seconds,
    )
    response = Response(status_code=204)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=settings.jwt_ttl_seconds,
        httponly=True,
        samesite="lax",
        path="/",
        # secure=True in production — leave off for dev (http://localhost).
    )
    return response
