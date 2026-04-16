from kb.jobs.store import InMemoryJobStore
from kb.wiki.models import JobStatus


def test_create_and_get_job():
    store = InMemoryJobStore()
    job = store.create_job("report.md")
    retrieved = store.get_job(job.job_id)
    assert retrieved is not None
    assert retrieved.filename == "report.md"
    assert retrieved.status == JobStatus.PENDING


def test_update_job_status():
    store = InMemoryJobStore()
    job = store.create_job("doc.md")
    store.update_job(job.job_id, status=JobStatus.RUNNING)
    assert store.get_job(job.job_id).status == JobStatus.RUNNING


def test_update_job_with_error():
    store = InMemoryJobStore()
    job = store.create_job("doc.md")
    store.update_job(job.job_id, status=JobStatus.FAILED, error="LLM timeout")
    updated = store.get_job(job.job_id)
    assert updated.status == JobStatus.FAILED
    assert updated.error == "LLM timeout"


def test_get_missing_job_returns_none():
    store = InMemoryJobStore()
    assert store.get_job("no-such-id") is None
