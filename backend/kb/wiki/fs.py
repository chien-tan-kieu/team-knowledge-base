import re
from pathlib import Path
from kb.wiki.models import WikiPage
from kb.wiki.frontmatter import parse as parse_frontmatter


INDEX_SEED = "# Index\n\n"
_SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


class WikiFS:
    def __init__(self, knowledge_dir: Path, schema_dir: Path, raw_dir: Path) -> None:
        self._raw    = raw_dir
        self._wiki   = knowledge_dir / "wiki"
        self._pages  = knowledge_dir / "wiki" / "pages"
        self._schema = schema_dir
        self._raw.mkdir(parents=True, exist_ok=True)
        self._pages.mkdir(parents=True, exist_ok=True)
        # schema dir is app-owned, not auto-created by WikiFS
        index_path = self._wiki / "index.md"
        if not index_path.exists():
            index_path.write_text(INDEX_SEED, encoding="utf-8")
        log_path = self._wiki / "log.md"
        if not log_path.exists():
            log_path.write_text("", encoding="utf-8")

    def read_index(self) -> str:
        return (self._wiki / "index.md").read_text(encoding="utf-8")

    def write_index(self, content: str) -> None:
        (self._wiki / "index.md").write_text(content, encoding="utf-8")

    def read_page(self, slug: str) -> WikiPage:
        path = self._pages / f"{slug}.md"
        if not path.exists():
            raise FileNotFoundError(f"Wiki page not found: {slug}")
        content = path.read_text(encoding="utf-8")
        frontmatter, body = parse_frontmatter(content)
        return WikiPage(slug=slug, content=content, frontmatter=frontmatter, body=body)

    def write_page(self, slug: str, content: str) -> None:
        (self._pages / f"{slug}.md").write_text(content, encoding="utf-8")

    def list_pages(self) -> list[str]:
        return sorted(p.stem for p in self._pages.glob("*.md"))

    def list_page_meta(self) -> list[dict]:
        """Slug/title/topic for every page. Missing or invalid frontmatter
        degrades to None values rather than failing the whole listing."""
        metas: list[dict] = []
        for path in sorted(self._pages.glob("*.md")):
            try:
                frontmatter, _ = parse_frontmatter(path.read_text(encoding="utf-8"))
            except ValueError:
                frontmatter = {}
            title = frontmatter.get("title")
            topic = frontmatter.get("topic")
            metas.append({
                "slug": path.stem,
                "title": title if isinstance(title, str) and title else None,
                "topic": (
                    topic
                    if isinstance(topic, str) and _SLUG_RE.match(topic)
                    else None
                ),
            })
        return metas

    def pages_fingerprint(self) -> tuple[tuple[str, int, int], ...]:
        """Cheap change-detector for the pages dir: sorted (name, mtime_ns,
        size) for every page file. Used to decide when the search index is
        stale without reading file contents."""
        entries = []
        for path in sorted(self._pages.glob("*.md")):
            st = path.stat()
            entries.append((path.name, st.st_mtime_ns, st.st_size))
        return tuple(entries)

    def append_log(self, entry: str) -> None:
        log_path = self._wiki / "log.md"
        existing = log_path.read_text(encoding="utf-8")
        log_path.write_text(existing + "\n" + entry + "\n", encoding="utf-8")

    def save_raw(self, filename: str, content: str) -> None:
        (self._raw / filename).write_text(content, encoding="utf-8")

    def read_raw(self, filename: str) -> str:
        return (self._raw / filename).read_text(encoding="utf-8")

    def delete_raw(self, filename: str) -> None:
        (self._raw / filename).unlink()

    def read_schema(self) -> str:
        return (self._schema / "SCHEMA.md").read_text(encoding="utf-8")

    def list_raw_files(self) -> list[str]:
        return sorted(p.name for p in self._raw.glob("*.md"))

    def read_log(self) -> str:
        log_path = self._wiki / "log.md"
        return log_path.read_text(encoding="utf-8") if log_path.exists() else ""
