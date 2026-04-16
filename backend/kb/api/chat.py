from fastapi import APIRouter, Depends
from pydantic import field_validator
from sse_starlette.sse import EventSourceResponse
from kb.agents.query import QueryAgent
from kb.api.deps import get_wiki_fs
from kb.wiki.fs import WikiFS
from kb.wiki.models import ChatRequest
from kb.config import settings

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ValidatedChatRequest(ChatRequest):
    @field_validator("question")
    @classmethod
    def question_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("question must not be empty")
        return v


@router.post("")
async def chat(
    request: ValidatedChatRequest,
    fs: WikiFS = Depends(get_wiki_fs),
):
    agent = QueryAgent(fs=fs, model=settings.llm_model)

    async def event_generator():
        async for token in agent.query(request.question):
            yield {"data": token}

    return EventSourceResponse(event_generator())
