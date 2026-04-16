from enum import StrEnum
from pydantic import BaseModel


class JobStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class WikiPage(BaseModel):
    slug: str
    content: str


class IngestJob(BaseModel):
    job_id: str
    filename: str
    status: JobStatus = JobStatus.PENDING
    error: str | None = None


class ChatRequest(BaseModel):
    question: str


class LintResult(BaseModel):
    orphans: list[str]
    contradictions: list[str]
