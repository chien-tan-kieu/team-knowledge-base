from fastapi import APIRouter, Depends
from kb.agents.lint import LintAgent
from kb.api.deps import get_wiki_fs
from kb.wiki.fs import WikiFS

router = APIRouter(prefix="/api/lint", tags=["lint"])


@router.post("")
def run_lint(fs: WikiFS = Depends(get_wiki_fs)):
    agent = LintAgent(fs=fs)
    return agent.lint()
