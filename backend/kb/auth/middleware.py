from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from kb.auth.jwt import SessionTokenError, decode_session_jwt
from kb.config import settings
from kb.errors import ErrorCode
from kb.logging import request_id_var
from kb.auth.routes import COOKIE_NAME

_BYPASS_PREFIXES = (
    "/api/auth/session",
    "/healthz",
    "/docs",
    "/openapi.json",
    "/redoc",
)


def _is_bypass(path: str) -> bool:
    return any(path == p or path.startswith(p + "/") or path == p for p in _BYPASS_PREFIXES)


def _unauthenticated_response() -> JSONResponse:
    return JSONResponse(
        status_code=401,
        content={
            "code": ErrorCode.UNAUTHENTICATED.value,
            "message": "Session required.",
            "request_id": request_id_var.get(),
        },
    )


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        if _is_bypass(request.url.path):
            return await call_next(request)

        token = request.cookies.get(COOKIE_NAME)
        if not token:
            return _unauthenticated_response()
        try:
            decode_session_jwt(token, secret=settings.jwt_secret)
        except SessionTokenError:
            return _unauthenticated_response()

        return await call_next(request)
