import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from kb.logging import request_id_var

logger = logging.getLogger(__name__)


def _new_request_id() -> str:
    # ULIDs would be nicer but uuid4 keeps the dep surface smaller and is unique.
    return uuid.uuid4().hex


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        rid = _new_request_id()
        token = request_id_var.set(rid)
        request.state.request_id = rid
        start = time.perf_counter()
        logger.info("request.start", extra={
            "event": "request.start",
            "method": request.method,
            "path": request.url.path,
        })
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            logger.exception("request.error", extra={
                "event": "request.error",
                "method": request.method,
                "path": request.url.path,
                "duration_ms": duration_ms,
            })
            raise
        else:
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            logger.info("request.end", extra={
                "event": "request.end",
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": duration_ms,
            })
            response.headers["X-Request-ID"] = rid
            return response
        finally:
            request_id_var.reset(token)
