"""Structure-aware chunking for Japanese rules documents.

Japanese company rules (就業規則, 規程) have a strong, regular structure::

    第５章 休暇等                     <- chapter
    （年次有給休暇）                  <- article caption
    第２３条 採用日から６か月間…      <- article body
    【第２３条 年次有給休暇】         <- commentary (解説) in the MHLW model rules
    ［例２］…                         <- alternative versions of the same article

Chunking along this structure (instead of fixed windows) keeps every chunk
answerable on its own and lets a citation say "第２３条" rather than
"characters 41,200–41,800". Long blocks are split at paragraph/item
boundaries, then at "。", never mid-sentence unless a sentence alone exceeds
the limit.

Chunk ids are derived from structure (``<doc>#art023``, ``<doc>#com023``,
``<doc>#art019-ex2``…), so they stay stable across re-ingestion and can be
referenced from the evaluation set. ``content_hash`` detects content changes.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass, field
from itertools import pairwise

from knowledge_ai.models import Chunk, Document

# Bump when chunking behaviour changes so that `kai ingest` re-chunks documents.
CHUNKER_VERSION = "3"

_SP = r"[ \t　]"
_NUM = r"[０-９0-9]+"

CHAPTER = re.compile(rf"^{_SP}*第({_NUM})章{_SP}+([^…\s][^…]*?){_SP}*$")
SUPPLEMENT = re.compile(rf"^{_SP}*附{_SP}*則{_SP}*$")
# body article line: "第２３条 採用日から…" (TOC lines look like "第２３条（年次有給休暇）")
ARTICLE = re.compile(rf"^{_SP}*第({_NUM})条(?:の({_NUM}))?{_SP}+\S")
CAPTION = re.compile(rf"^{_SP}*[（(]([^（）()]{{1,40}})[）)]{_SP}*$")
COMMENTARY = re.compile(rf"^{_SP}*【第({_NUM})条(?:の{_NUM})?{_SP}*([^】]*)】")
REFERENCE = re.compile(rf"^{_SP}*(?:【参{_SP}*考】|[（(]参考[：:）)])")
VARIANT = re.compile(rf"^{_SP}*[［\[〔]{_SP}*例{_SP}*({_NUM}){_SP}*[］\]〕]")
TOC = re.compile(rf"^{_SP}*目{_SP}*次{_SP}*$")
PREFACE_HEADING = re.compile(rf"^{_SP}*({_NUM}){_SP}+([^。、]{{2,30}}?){_SP}*$")
MD_HEADING = re.compile(r"^(#{1,6})[ \t]+(.+?)[ \t#]*$")
MD_ARTICLE = re.compile(rf"^第({_NUM})条(?:の({_NUM}))?{_SP}*(?:[（(]([^）)]+)[）)])?")
MD_CHAPTER = re.compile(rf"^第({_NUM})章{_SP}*(.*)$")

_SPLIT_LINE = re.compile(
    rf"{_SP}*(?:[０-９0-9]{{1,2}}{_SP}|[①-⑳]|[（(][イロハニホヘトチリヌ一二三四五六七八九十０-９0-9]{{1,2}}[）)]"
    rf"|[アイウエオカキクケコ]{_SP}|[・●○■□◆◇※]|[-*]{_SP})"
)


def to_int(num: str) -> int:
    return int(unicodedata.normalize("NFKC", num))


def _short_hash(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:8]


@dataclass
class _Line:
    text: str
    start: int
    end: int  # exclusive, excludes the newline


@dataclass
class _Block:
    kind: str
    first_line: int
    chapter: str | None
    chapter_no: int | None
    supplement: bool = False
    articles: list[int] = field(default_factory=list)
    caption: str | None = None
    variant: str | None = None
    label: str | None = None
    parent_label: str | None = None
    has_body: bool = False
    last_line: int = -1


def _split_lines(text: str) -> list[_Line]:
    lines: list[_Line] = []
    pos = 0
    for raw in text.split("\n"):
        lines.append(_Line(raw, pos, pos + len(raw)))
        pos += len(raw) + 1
    return lines


class StructureChunker:
    """Parse a document into structural blocks, then size-limit them into chunks."""

    def __init__(self, max_chars: int = 600, min_chars: int = 50) -> None:
        if max_chars < 100:
            raise ValueError("max_chars must be >= 100")
        self.max_chars = max_chars
        self.min_chars = min_chars

    # ------------------------------------------------------------------ parse
    def _parse(self, doc: Document) -> tuple[list[_Line], list[_Block]]:
        lines = _split_lines(doc.text)
        is_md = doc.kind == "markdown"
        blocks: list[_Block] = []
        chapter: str | None = None
        chapter_no: int | None = None
        supplement = False
        in_toc = False
        md_path: list[str] = []
        variant: str | None = None
        variant_group = 0
        first_group_articles: set[int] = set()
        max_article = 0  # highest article number seen in the main body

        def open_block(kind: str, idx: int, **kw) -> _Block:
            b = _Block(
                kind=kind,
                first_line=idx,
                chapter=chapter,
                chapter_no=chapter_no,
                supplement=supplement,
                variant=variant,
                **kw,
            )
            blocks.append(b)
            return b

        def reset_variant() -> None:
            nonlocal variant, variant_group, first_group_articles
            variant, variant_group, first_group_articles = None, 0, set()

        def plausible_article(n: int, captioned: bool) -> bool:
            # Statutes quoted inside commentary ("第３８条 労働時間は…") must not start
            # a new article. A captioned article may restate an earlier number only
            # inside alternatives (［例２］ restates 第１９条); an uncaptioned line
            # must be the next article in sequence.
            if supplement:
                return True
            if captioned:
                return variant is not None or n >= max_article
            return (
                max_article == 0
                or n == max_article + 1
                or (variant is not None and n in first_group_articles)
            )

        def on_article(n: int) -> None:
            # Alternatives ("［例１］…［例３］") restate the same articles; the
            # run ends at the first article beyond those in the first alternative.
            nonlocal variant, max_article
            if not supplement:
                max_article = max(max_article, n)
            if variant is None:
                return
            if variant_group == 1:
                first_group_articles.add(n)
            elif first_group_articles and n > max(first_group_articles):
                reset_variant()

        def next_nonblank(idx: int) -> int | None:
            for j in range(idx + 1, min(idx + 4, len(lines))):
                if lines[j].text.strip():
                    return j
            return None

        cur: _Block | None = None
        for idx, line in enumerate(lines):
            t = line.text
            if not t.strip():
                continue

            if not is_md and TOC.match(t):
                cur = open_block("toc", idx, label="目次")
                in_toc = True
                continue
            if in_toc:
                if CHAPTER.match(t) and "…" not in t:
                    in_toc = False
                else:
                    cur.last_line = idx  # type: ignore[union-attr]
                    continue

            if is_md and (m := MD_HEADING.match(t)):
                level, title = len(m.group(1)), m.group(2).strip()
                md_path = [*md_path[: level - 1], title]
                if am := MD_ARTICLE.match(title):
                    n = to_int(am.group(1))
                    on_article(n)
                    cur = open_block("article", idx, articles=[n], caption=am.group(3), label=title)
                elif cm := MD_CHAPTER.match(title):
                    chapter, chapter_no = title, to_int(cm.group(1))
                    reset_variant()
                    cur = open_block("intro", idx, label=None)
                elif level == 1:
                    chapter, chapter_no = None, None
                    cur = open_block("intro", idx, label=title)
                else:
                    cur = open_block("section", idx, label=" > ".join(md_path[1:]) or title)
                cur.last_line = idx
                continue

            if m := CHAPTER.match(t):
                chapter_no = to_int(m.group(1))
                chapter = f"第{chapter_no}章 {m.group(2).strip()}"
                supplement = False
                reset_variant()
                cur = open_block("intro", idx)
                cur.last_line = idx
                continue
            if SUPPLEMENT.match(t):
                chapter, chapter_no, supplement = "附則", None, True
                reset_variant()
                cur = open_block("intro", idx)
                cur.last_line = idx
                continue
            if (m := VARIANT.match(t)) and not (
                cur is not None and cur.kind == "intro" and cur.variant == str(to_int(m.group(1)))
            ):
                if variant is None:
                    variant_group = 0
                    first_group_articles = set()
                variant_group += 1
                variant = str(to_int(m.group(1)))
                cur = open_block("intro", idx, label=f"［例{variant}］")
                cur.last_line = idx
                continue
            if m := COMMENTARY.match(t):
                n = to_int(m.group(1))
                if cur is not None and cur.kind == "commentary" and not cur.has_body:
                    cur.articles.append(n)
                    cur.label = f"{cur.label}・第{n}条 {m.group(2).strip()}"
                else:
                    on_article(n)
                    cur = open_block(
                        "commentary", idx, articles=[n], label=f"第{n}条 {m.group(2).strip()}"
                    )
                cur.last_line = idx
                continue
            if REFERENCE.match(t):
                # A reference box belongs to the article/commentary it follows.
                prev = cur
                parent_label: str | None = None
                if prev is not None and prev.kind == "commentary":
                    parent_label = f"【解説】{prev.label}"
                elif prev is not None and prev.kind == "reference":
                    parent_label = prev.parent_label
                elif prev is not None and prev.kind == "article" and prev.articles:
                    cap = f"（{prev.caption}）" if prev.caption else ""
                    parent_label = f"第{prev.articles[0]}条{cap}"
                cur = open_block(
                    "reference",
                    idx,
                    label=t.strip(),
                    articles=list(prev.articles) if parent_label and prev else [],
                    parent_label=parent_label,
                )
                cur.last_line = idx
                continue
            if m := CAPTION.match(t):
                j = next_nonblank(idx)
                if (
                    j is not None
                    and (am := ARTICLE.match(lines[j].text))
                    and plausible_article(n := to_int(am.group(1)), captioned=True)
                ):
                    on_article(n)
                    cur = open_block("article", idx, articles=[n], caption=m.group(1).strip())
                    cur.last_line = idx
                    continue
            if m := ARTICLE.match(t):
                n = to_int(m.group(1))
                pending_caption = (
                    cur is not None
                    and cur.kind == "article"
                    and not cur.has_body
                    and cur.articles == [n]
                )
                if pending_caption or plausible_article(n, captioned=False):
                    if not pending_caption:
                        on_article(n)
                        cur = open_block("article", idx, articles=[n])
                    cur.has_body = True  # type: ignore[union-attr]
                    cur.last_line = idx  # type: ignore[union-attr]
                    continue
            if not is_md and chapter is None and not supplement and (m := PREFACE_HEADING.match(t)):
                cur = open_block("section", idx, label=m.group(2).strip())
                cur.last_line = idx
                continue

            if cur is None:
                cur = open_block("section", idx, label=None)
            cur.has_body = True
            cur.last_line = idx

        # A commentary that appears once after a run of alternatives (e.g. after
        # ［例４］ of 第５１条) explains the article in general, not one alternative.
        for b in blocks:
            if b.kind == "commentary" and b.variant is not None:
                siblings = [
                    o
                    for o in blocks
                    if o.kind == "commentary"
                    and o.variant is not None
                    and o.chapter == b.chapter
                    and set(o.articles) & set(b.articles)
                ]
                if len(siblings) == 1:
                    b.variant = None
        return lines, blocks

    # ------------------------------------------------------------------ build
    def _merge_forward(self, lines: list[_Line], blocks: list[_Block]) -> set[int]:
        """Blocks that are only a label for what follows are merged into the next block.

        * a variant intro ("［例２］ … の規程例") describes the article right after it;
        * tiny headings ("第３章 服務規律", "附 則", "## 第1章 総則") carry no
          answer on their own and only add noise to the ranking.
        Returns the indices of blocks that were absorbed.
        """
        absorbed: set[int] = set()
        for i, b in enumerate(blocks[:-1]):
            nxt = blocks[i + 1]
            if b.kind == "toc" or nxt.kind == "toc" or b.last_line < b.first_line:
                continue
            size = lines[b.last_line].end - lines[b.first_line].start
            label_only = (b.kind == "intro" and b.variant is not None) or (
                b.kind in {"intro", "section"} and size < self.min_chars
            )
            if label_only:
                nxt.first_line = b.first_line
                absorbed.add(i)
        return absorbed

    def chunk(self, doc: Document) -> list[Chunk]:
        lines, blocks = self._parse(doc)
        absorbed = self._merge_forward(lines, blocks)
        chunks: list[Chunk] = []
        seen: dict[str, int] = {}
        for bi, block in enumerate(blocks):
            if bi in absorbed or block.kind == "toc" or block.last_line < block.first_line:
                continue
            start = lines[block.first_line].start
            end = lines[block.last_line].end
            if not doc.text[start:end].strip():
                continue
            heading = self._heading(doc, block)
            base_id = f"{doc.doc_id}#{self._slug(block, blocks, bi, heading)}"
            for part_no, (s, e) in enumerate(self._split(doc.text, start, end), start=1):
                cid = base_id if part_no == 1 else f"{base_id}-p{part_no}"
                if cid in seen:
                    seen[cid] += 1
                    cid = f"{cid}~{seen[cid]}"
                else:
                    seen[cid] = 1
                chunks.append(
                    Chunk(
                        chunk_id=cid,
                        doc_id=doc.doc_id,
                        ordinal=len(chunks),
                        kind=block.kind,
                        heading=heading,
                        text=doc.text[s:e],
                        start=s,
                        end=e,
                        page_start=doc.page_at(s),
                        page_end=doc.page_at(max(s, e - 1)),
                        article=block.articles[0] if block.articles else None,
                        variant=block.variant,
                    )
                )
        return chunks

    @staticmethod
    def _heading(doc: Document, b: _Block) -> str:
        parts: list[str] = []
        if b.chapter:
            parts.append(b.chapter)
        elif doc.kind == "pdf" and not b.supplement:
            parts.append("はじめに")
        variant = f"［例{b.variant}］" if b.variant else ""
        if b.kind == "article":
            if b.label:
                parts.append(b.label + variant)
            else:
                cap = f"（{b.caption}）" if b.caption else ""
                parts.append(f"第{b.articles[0]}条{cap}{variant}")
        elif b.kind == "commentary":
            parts.append(f"【解説】{b.label}{variant}")
        elif b.kind == "reference" and b.parent_label:
            parts.extend([b.parent_label, b.label or "参考"])
        elif b.label:
            parts.append(b.label)
        return " > ".join(p for p in parts if p)

    @staticmethod
    def _slug(b: _Block, blocks: list[_Block], idx: int, heading: str) -> str:
        prefix = "suppl-" if b.supplement else ""
        ex = f"-ex{b.variant}" if b.variant else ""
        if b.kind == "article" and b.articles:
            return f"{prefix}art{b.articles[0]:03d}{ex}"
        if b.kind == "commentary" and b.articles:
            nums = "-".join(f"{n:03d}" for n in b.articles)
            return f"{prefix}com{nums}{ex}"
        if b.kind == "intro" and b.variant:
            # name a variant intro after the article it introduces
            nxt = next((x for x in blocks[idx + 1 :] if x.articles), None)
            anchor = f"art{nxt.articles[0]:03d}" if nxt else "end"
            return f"{prefix}{anchor}-ex{b.variant}-intro"
        if b.kind == "intro" and b.chapter_no is not None:
            return f"ch{b.chapter_no:02d}-intro"
        if b.kind == "intro" and b.supplement:
            return "suppl-intro"
        prefix = {"reference": "ref", "section": "sec"}.get(b.kind, b.kind)
        return f"{prefix}-{_short_hash(heading)}"

    # ------------------------------------------------------------------ split
    def _split(self, text: str, start: int, end: int) -> list[tuple[int, int]]:
        if end - start <= self.max_chars:
            return [(start, end)]
        # candidate boundaries: starts of lines that begin a new item/paragraph,
        # or lines following a line that ends with "。" or a blank line.
        boundaries: list[int] = []
        pos = start
        prev_line = ""
        for raw in text[start:end].split("\n"):
            if pos > start and (
                _SPLIT_LINE.match(raw) or prev_line.rstrip().endswith("。") or not prev_line.strip()
            ):
                boundaries.append(pos)
            prev_line = raw
            pos += len(raw) + 1
        segments = self._segments(start, end, boundaries)
        # break oversized segments at sentence ends, then hard-split as last resort
        pieces: list[tuple[int, int]] = []
        for s, e in segments:
            if e - s <= self.max_chars:
                pieces.append((s, e))
                continue
            cuts = [s + m.end() for m in re.finditer("。", text[s:e]) if s + m.end() < e]
            for ss, ee in self._segments(s, e, cuts):
                while ee - ss > self.max_chars:
                    pieces.append((ss, ss + self.max_chars))
                    ss += self.max_chars
                pieces.append((ss, ee))
        # greedy packing of consecutive pieces up to max_chars
        packed: list[tuple[int, int]] = []
        for s, e in pieces:
            if packed and e - packed[-1][0] <= self.max_chars:
                packed[-1] = (packed[-1][0], e)
            else:
                packed.append((s, e))
        # trim whitespace at the edges of each part (keeps text == doc.text[s:e])
        out: list[tuple[int, int]] = []
        for s, e in packed:
            while s < e and text[s].isspace():
                s += 1
            while e > s and text[e - 1].isspace():
                e -= 1
            if e > s:
                out.append((s, e))
        return out

    @staticmethod
    def _segments(start: int, end: int, cuts: list[int]) -> list[tuple[int, int]]:
        points = [start, *sorted(c for c in cuts if start < c < end), end]
        return [(a, b) for a, b in pairwise(points) if b > a]


def chunk_document(doc: Document, max_chars: int = 600) -> list[Chunk]:
    return StructureChunker(max_chars=max_chars).chunk(doc)
