from pathlib import Path
from kb.wiki.models import WikiPage


class WikiFS:
    def __init__(self, knowledge_dir: Path) -> None:
        self._raw = knowledge_dir / "raw"
        self._wiki = knowledge_dir / "wiki"
        self._pages = knowledge_dir / "wiki" / "pages"
        self._schema = knowledge_dir / "schema"

    def read_index(self) -> str:
        return (self._wiki / "index.md").read_text(encoding="utf-8")

    def write_index(self, content: str) -> None:
        (self._wiki / "index.md").write_text(content, encoding="utf-8")

    def read_page(self, slug: str) -> WikiPage:
        path = self._pages / f"{slug}.md"
        if not path.exists():
            raise FileNotFoundError(f"Wiki page not found: {slug}")
        return WikiPage(slug=slug, content=path.read_text(encoding="utf-8"))

    def write_page(self, slug: str, content: str) -> None:
        (self._pages / f"{slug}.md").write_text(content, encoding="utf-8")

    def list_pages(self) -> list[str]:
        return sorted(p.stem for p in self._pages.glob("*.md"))

    def append_log(self, entry: str) -> None:
        log_path = self._wiki / "log.md"
        existing = log_path.read_text(encoding="utf-8")
        log_path.write_text(existing + "\n" + entry + "\n", encoding="utf-8")

    def save_raw(self, filename: str, content: str) -> None:
        (self._raw / filename).write_text(content, encoding="utf-8")

    def read_raw(self, filename: str) -> str:
        return (self._raw / filename).read_text(encoding="utf-8")

    def read_schema(self) -> str:
        return (self._schema / "SCHEMA.md").read_text(encoding="utf-8")
