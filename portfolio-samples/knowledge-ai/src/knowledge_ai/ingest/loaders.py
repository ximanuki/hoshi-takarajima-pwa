"""Load PDF and Markdown files into :class:`~knowledge_ai.models.Document`.

The loader produces one canonical text per document plus page spans. Nothing
downstream rewrites that text; chunks and citations are offsets into it.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from pypdf import PdfReader

from knowledge_ai.models import Document, PageSpan

SUPPORTED_SUFFIXES = {".pdf", ".md", ".markdown"}
MANIFEST_NAME = "manifest.json"

# Printed page numbers at the top of a page: "- 10 -", "１", "10"
_PAGE_NUMBER_LINE = re.compile(r"^[\s\-－‐―ー]*[０-９0-9]{1,4}[\s\-－‐―ー]*$")


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 16), b""):
            h.update(block)
    return h.hexdigest()


def slugify(stem: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")
    return slug or "doc-" + hashlib.sha1(stem.encode("utf-8")).hexdigest()[:8]


def clean_page_text(raw: str) -> str:
    """Normalise one extracted PDF page.

    * unify newlines, strip trailing spaces on every line
    * drop the printed page-number line at the top of the page
    * collapse runs of blank lines to a single blank line
    """
    lines = [ln.rstrip() for ln in raw.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    while lines and not lines[0].strip():
        lines.pop(0)
    if lines and _PAGE_NUMBER_LINE.match(lines[0]):
        lines.pop(0)
    out: list[str] = []
    for ln in lines:
        if not ln.strip():
            if out and out[-1] == "":
                continue
            out.append("")
        else:
            out.append(ln)
    while out and out[0] == "":
        out.pop(0)
    while out and out[-1] == "":
        out.pop()
    return "\n".join(out)


def load_manifest(raw_dir: Path) -> dict[str, dict[str, Any]]:
    path = raw_dir / MANIFEST_NAME
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def load_pdf(path: Path, meta: dict[str, Any] | None = None) -> Document:
    meta = meta or {}
    reader = PdfReader(str(path))
    texts: list[str] = []
    pages: list[PageSpan] = []
    offset = 0
    for number, page in enumerate(reader.pages, start=1):
        page_text = clean_page_text(page.extract_text() or "")
        if texts:
            texts.append("\n")  # page separator belongs to the previous page
            offset += 1
            prev = pages[-1]
            pages[-1] = PageSpan(prev.number, prev.start, offset)
        pages.append(PageSpan(number, offset, offset + len(page_text)))
        texts.append(page_text)
        offset += len(page_text)
    return Document(
        doc_id=meta.get("doc_id") or slugify(path.stem),
        title=meta.get("title") or path.stem,
        kind="pdf",
        text="".join(texts),
        pages=pages,
        source_path=path.name,
        sha256=_sha256(path),
        source_url=meta.get("source_url"),
        license=meta.get("license"),
        attribution=meta.get("attribution"),
    )


def load_markdown(path: Path, meta: dict[str, Any] | None = None) -> Document:
    meta = meta or {}
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
    title = meta.get("title")
    if not title:
        m = re.search(r"^#\s+(.+?)\s*$", text, flags=re.M)
        title = m.group(1) if m else path.stem
    return Document(
        doc_id=meta.get("doc_id") or slugify(path.stem),
        title=title,
        kind="markdown",
        text=text,
        pages=[],
        source_path=path.name,
        sha256=_sha256(path),
        source_url=meta.get("source_url"),
        license=meta.get("license"),
        attribution=meta.get("attribution"),
    )


def load_document(path: Path, meta: dict[str, Any] | None = None) -> Document:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return load_pdf(path, meta)
    if suffix in {".md", ".markdown"}:
        return load_markdown(path, meta)
    raise ValueError(f"unsupported file type: {path.name}")


def discover(raw_dir: Path) -> list[Path]:
    return sorted(
        p for p in raw_dir.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED_SUFFIXES
    )
