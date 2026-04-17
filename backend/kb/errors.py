import logging
from enum import Enum

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException
from starlette.requests import Request

from kb.logging import request_id_var

logger = logging.getLogger(__name__)


class ErrorCode(str, Enum):
    VALIDATION_ERROR = "VALIDATION_ERROR"
    UNAUTHENTICATED = "UNAUTHENTICATED"
    NOT_FOUND = "NOT_FOUND"
    UPSTREAM_LLM_ERROR = "UPSTREAM_LLM_ERROR"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class ErrorResponse(BaseModel):
    code: ErrorCode
    message: str
    request_id: str | None = None


class LLMUpstreamError(Exception):
    """Raised when a downstream LLM call fails."""

    def __init__(self, message: str = "The language model is currently unavailable.") -> None:
        super().__init__(message)
        self.message = message


_STATUS_TO_CODE = {
    400: ErrorCode.VALIDATION_ERROR,
    401: ErrorCode.UNAUTHENTICATED,
    404: ErrorCode.NOT_FOUND,
    422: ErrorCode.VALIDATION_ERROR,
}


def _get_rid(request: Request) -> str | None:
    rid = request_id_var.get()
    if rid:
        return rid
    return getattr(request.state, "request_id", None)


def _body(request: Request, code: ErrorCode, message: str) -> dict:
    return {
        "code": code.value,
        "message": message,
        "request_id": _get_rid(request),
    }


def _response(request: Request, status_code: int, code: ErrorCode, message: str) -> JSONResponse:
    rid = _get_rid(request)
    headers = {"X-Request-ID": rid} if rid else None
    return JSONResponse(
        status_code=status_code,
        content=_body(request, code, message),
        headers=headers,
    )


async def _http_exception_handler(request: Request, exc: HTTPException):
    code = _STATUS_TO_CODE.get(exc.status_code, ErrorCode.INTERNAL_ERROR)
    message = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return _response(request, exc.status_code, code, message)


async def _validation_error_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    if errors:
        first = errors[0]
        loc = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        message = f"{loc}: {first.get('msg', 'invalid')}" if loc else first.get("msg", "invalid")
    else:
        message = "Request validation failed."
    return _response(request, 422, ErrorCode.VALIDATION_ERROR, message)


async def _llm_upstream_handler(request: Request, exc: LLMUpstreamError):
    return _response(request, 502, ErrorCode.UPSTREAM_LLM_ERROR, exc.message)


async def _unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("unhandled_exception")
    # Request id is returned in the `request_id` field and `X-Request-ID` header;
    # we don't embed it in the human-readable message to avoid double display.
    return _response(request, 500, ErrorCode.INTERNAL_ERROR, "Something went wrong.")


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(HTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
    app.add_exception_handler(LLMUpstreamError, _llm_upstream_handler)
    app.add_exception_handler(Exception, _unhandled_exception_handler)
