from kb.wiki.fs import WikiFS
from kb.wiki.models import LintResult


class LintAgent:
    def __init__(self, fs: WikiFS) -> None:
        self._fs = fs

    def lint(self) -> LintResult:
        orphans = self._find_orphans()
        return LintResult(orphans=orphans, contradictions=[])

    def _find_orphans(self) -> list[str]:
        index = self._fs.read_index()
        all_slugs = self._fs.list_pages()
        return [slug for slug in all_slugs if f"[[{slug}]]" not in index]
