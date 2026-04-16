from fastapi import APIRouter, Depends, HTTPException
from kb.api.deps import get_wiki_fs
from kb.wiki.fs import WikiFS

router = APIRouter(prefix="/api/wiki", tags=["wiki"])


@router.get("")
def list_pages(fs: WikiFS = Depends(get_wiki_fs)):
    return {"pages": fs.list_pages()}


@router.get("/{slug}")
def get_page(slug: str, fs: WikiFS = Depends(get_wiki_fs)):
    try:
        page = fs.read_page(slug)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Page '{slug}' not found")
    return page
