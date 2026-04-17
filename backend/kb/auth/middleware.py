from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from kb.auth.jwt import SessionTokenError, decode_session_jwt
from kb.config import settings
from kb.errors import ErrorCode, _response
from kb.auth.routes import COOKIE_NAME

_BYPASS_PREFIXES = (
    "/api/auth/session",
    "/healthz",
    "/docs",
    "/openapi.json",
    "/redoc",
)


def _is_bypass(path: str) -> bool:
    return any(path == p or path.startswith(p + "/") for p in _BYPASS_PREFIXES)


def _unauthenticated_response(request: Request) -> Response:
    return _response(request, 401, ErrorCode.UNAUTHENTICATED, "Session required.")


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        if _is_bypass(request.url.path):
            return await call_next(request)

        token = request.cookies.get(COOKIE_NAME)
        if not token:
            return _unauthenticated_response(request)
        try:
            decode_session_jwt(token, secret=settings.jwt_secret)
        except SessionTokenError:
            return _unauthenticated_response(request)

        return await call_next(request)
