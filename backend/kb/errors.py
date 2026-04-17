from enum import Enum
from pydantic import BaseModel


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
