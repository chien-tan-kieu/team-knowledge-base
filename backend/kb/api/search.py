from fastapi import APIRouter, Depends
from kb.api.deps import get_wiki_search
from kb.wiki.search import WikiSearch

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
def search(q: str = "", search: WikiSearch = Depends(get_wiki_search)):
    return {"results": search.search(q)}
