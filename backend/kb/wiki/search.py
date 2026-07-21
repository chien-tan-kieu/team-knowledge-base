import re
from rank_bm25 import BM25Okapi
from kb.wiki.fs import WikiFS

_TOKEN_RE = re.compile(r"[^\w\s]", flags=re.UNICODE)
_SNIPPET_RADIUS = 80  # chars either side of the first matched term (~160 total)


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.sub(" ", text.lower()).split()


def _snippet(body: str, query_tokens: list[str]) -> str:
    lower = body.lower()
    pos = -1
    for tok in query_tokens:
        found = lower.find(tok)
        if found != -1 and (pos == -1 or found < pos):
            pos = found
    if pos == -1:
        pos = 0
    start = max(0, pos - _SNIPPET_RADIUS)
    end = min(len(body), pos + _SNIPPET_RADIUS)
    snippet = body[start:end].strip().replace("\n", " ")
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(body) else ""
    return f"{prefix}{snippet}{suffix}"


class WikiSearch:
    """In-memory BM25 index over wiki page bodies. Rebuilds lazily when the
    pages directory changes (WikiFS.pages_fingerprint)."""

    def __init__(self, fs: WikiFS) -> None:
        self._fs = fs
        self._fingerprint: tuple | None = None
        self._slugs: list[str] = []
        self._bodies: list[str] = []
        self._titles: dict[str, str] = {}
        self._bm25: BM25Okapi | None = None

    def _ensure_index(self) -> None:
        fingerprint = self._fs.pages_fingerprint()
        if fingerprint == self._fingerprint and self._bm25 is not None:
            return
        self._fingerprint = fingerprint
        self._slugs = self._fs.list_pages()
        self._bodies = []
        for slug in self._slugs:
            try:
                page = self._fs.read_page(slug)
                self._bodies.append(page.body)
            except ValueError:
                # Handle pages without proper frontmatter by treating entire content as body
                path = self._fs._pages / f"{slug}.md"
                self._bodies.append(path.read_text(encoding="utf-8"))
        meta = {m["slug"]: m for m in self._fs.list_page_meta()}
        self._titles = {
            slug: (meta.get(slug, {}).get("title") or slug) for slug in self._slugs
        }
        if self._slugs:
            self._bm25 = BM25Okapi([_tokenize(body) for body in self._bodies])
        else:
            self._bm25 = None

    def search(self, query: str, limit: int = 10) -> list[dict]:
        query_tokens = _tokenize(query)
        if not query_tokens:
            return []
        self._ensure_index()
        if self._bm25 is None:
            return []
        scores = self._bm25.get_scores(query_tokens)
        query_set = set(query_tokens)
        ranked = sorted(
            (
                (score, i)
                for i, score in enumerate(scores)
                if score > 0 or (query_set & set(_tokenize(self._bodies[i])))
            ),
            key=lambda pair: pair[0],
            reverse=True,
        )[:limit]
        results = []
        for _score, i in ranked:
            slug = self._slugs[i]
            results.append({
                "slug": slug,
                "title": self._titles[slug],
                "snippet": _snippet(self._bodies[i], query_tokens),
            })
        return results
