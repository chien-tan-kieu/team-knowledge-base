from enum import StrEnum
from typing import Literal
from pydantic import BaseModel


class JobStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class WikiPage(BaseModel):
    slug: str
    content: str
    frontmatter: dict
    body: str


class IngestJob(BaseModel):
    job_id: str
    filename: str
    status: JobStatus = JobStatus.PENDING
    error: str | None = None


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatTurn]


class LintResult(BaseModel):
    orphans: list[str]
    contradictions: list[str]
