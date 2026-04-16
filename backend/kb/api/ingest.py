from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile
from kb.agents.compile import CompileAgent
from kb.api.deps import get_job_store, get_wiki_fs
from kb.jobs.store import InMemoryJobStore
from kb.wiki.fs import WikiFS
from kb.wiki.models import JobStatus
from kb.config import settings

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


async def _run_compile(
    job_id: str,
    filename: str,
    raw_content: str,
    fs: WikiFS,
    store: InMemoryJobStore,
) -> None:
    store.update_job(job_id, status=JobStatus.RUNNING)
    try:
        fs.save_raw(filename, raw_content)
        agent = CompileAgent(fs=fs, model=settings.llm_model)
        await agent.compile(filename, raw_content)
        store.update_job(job_id, status=JobStatus.DONE)
    except Exception as exc:
        store.update_job(job_id, status=JobStatus.FAILED, error=str(exc))


@router.post("", status_code=202)
async def ingest_document(
    file: UploadFile,
    background_tasks: BackgroundTasks,
    fs: WikiFS = Depends(get_wiki_fs),
    store: InMemoryJobStore = Depends(get_job_store),
):
    raw_content = (await file.read()).decode("utf-8")
    job = store.create_job(file.filename or "upload.md")
    background_tasks.add_task(
        _run_compile, job.job_id, job.filename, raw_content, fs, store
    )
    return {"job_id": job.job_id, "status": job.status}


@router.get("/{job_id}")
def get_job_status(
    job_id: str,
    store: InMemoryJobStore = Depends(get_job_store),
):
    job = store.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
