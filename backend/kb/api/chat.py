import json
import logging

from fastapi import APIRouter, Depends
from pydantic import model_validator
from sse_starlette.sse import EventSourceResponse

from kb.agents.query import QueryAgent
from kb.api.deps import get_wiki_fs
from kb.config import settings
from kb.errors import ErrorCode, LLMUpstreamError
from kb.logging import request_id_var
from kb.wiki.fs import WikiFS
from kb.wiki.models import ChatRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])


class ValidatedChatRequest(ChatRequest):
    @model_validator(mode="after")
    def validate_shape(self):
        if not self.messages:
            raise ValueError("messages must not be empty")
        if self.messages[-1].role != "user":
            raise ValueError("last message must have role=user")
        for m in self.messages:
            if not m.content.strip():
                raise ValueError("content must not be blank")
        return self


def _error_event(code: ErrorCode, message: str) -> dict:
    payload = {
        "code": code.value,
        "message": message,
        "request_id": request_id_var.get(),
    }
    return {"event": "error", "data": json.dumps(payload)}


@router.post("")
async def chat(
    request: ValidatedChatRequest,
    fs: WikiFS = Depends(get_wiki_fs),
):
    agent = QueryAgent(fs=fs, model=settings.llm_model)

    async def event_generator():
        try:
            async for token in agent.query(request.question):
                yield {"data": token}
        except LLMUpstreamError as exc:
            logger.warning("chat.stream_llm_error")
            yield _error_event(ErrorCode.UPSTREAM_LLM_ERROR, exc.message)
        except Exception:
            logger.exception("chat.stream_failed")
            yield _error_event(ErrorCode.INTERNAL_ERROR, "Stream failed. Please try again.")

    return EventSourceResponse(event_generator())
