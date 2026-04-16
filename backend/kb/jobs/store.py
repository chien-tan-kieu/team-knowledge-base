import uuid
from kb.wiki.models import IngestJob, JobStatus


class InMemoryJobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, IngestJob] = {}

    def create_job(self, filename: str) -> IngestJob:
        job = IngestJob(job_id=str(uuid.uuid4()), filename=filename)
        self._jobs[job.job_id] = job
        return job

    def get_job(self, job_id: str) -> IngestJob | None:
        return self._jobs.get(job_id)

    def update_job(
        self,
        job_id: str,
        *,
        status: JobStatus,
        error: str | None = None,
    ) -> None:
        job = self._jobs[job_id]
        self._jobs[job_id] = job.model_copy(update={"status": status, "error": error})
