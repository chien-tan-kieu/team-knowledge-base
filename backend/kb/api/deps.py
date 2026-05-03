from functools import lru_cache
from kb.wiki.fs import WikiFS
from kb.jobs.store import InMemoryJobStore
from kb.config import settings


@lru_cache
def get_wiki_fs() -> WikiFS:
    return WikiFS(settings.knowledge_dir, settings.schema_dir)


@lru_cache
def get_job_store() -> InMemoryJobStore:
    return InMemoryJobStore()
