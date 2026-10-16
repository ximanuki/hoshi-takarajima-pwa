from pathlib import Path

import pytest

from knowledge_ai.ingest.chunker import StructureChunker, chunk_document
from knowledge_ai.ingest.loaders import clean_page_text, load_document, load_manifest
from knowledge_ai.models import Document, PageSpan

FIXTURES = Path(__file__).parent / "fixtures"

PAGES = [
    # page 1: table of contents (must not produce article chunks)
    "目 次\n第１章 総則……………１\n 第 １条（目的）\n第２章 労働時間……２\n第１９条（労働時間）",
    # page 2
    "第１章  総則\n総則には目的等を定めます。\n\n（目的）\n第１条  この規則は、就業に関する事項を定める。\n"
    "２ この規則に定めのない事項は法令による。\n\n【第１条  目的】\n１ 解説の本文です。",
    # page 3
    "第２章 労働時間\n［例１］ 完全週休２日制の例\n（労働時間）\n第１９条 労働時間は１日８時間とする。\n"
    "［例２］ 変形労働時間制の例\n（労働時間）\n第１９条 労働時間は平均して週４０時間とする。\n"
    "【第１９条 労働時間】\n解説：変形労働時間制とは…\n"
    "（参考）\n・労基法\n第３８条 労働時間は、事業場を異にする場合においても通算する。\n"
    "（時間外労働）\n第２１条 業務の都合により時間外労働をさせることがある。",
]


def make_doc(pages=PAGES) -> Document:
    text, spans, pos = "", [], 0
    for i, p in enumerate(pages, start=1):
        if text:
            text += "\n"
            pos += 1
            spans[-1] = PageSpan(spans[-1].number, spans[-1].start, pos)
        spans.append(PageSpan(i, pos, pos + len(p)))
        text += p
        pos += len(p)
    return Document("doc", "テスト", "pdf", text, spans, "x.pdf", "sha")


def ids(chunks):
    return [c.chunk_id.split("#")[1] for c in chunks]


def test_offsets_are_exact_and_pages_are_tracked():
    doc = make_doc()
    chunks = chunk_document(doc)
    for c in chunks:
        assert doc.text[c.start : c.end] == c.text
    by_id = {c.chunk_id.split("#")[1]: c for c in chunks}
    assert by_id["art001"].page_start == 2
    assert by_id["art019-ex1"].page_start == 3


def test_structure_articles_commentary_variants():
    chunks = chunk_document(make_doc())
    got = ids(chunks)
    assert got[:2] == ["art001", "com001"]
    assert "art019-ex1" in got and "art019-ex2" in got
    # the alternatives run ends at the next new article
    assert "art021" in got
    by_id = {c.chunk_id.split("#")[1]: c for c in chunks}
    assert by_id["art021"].variant is None
    assert by_id["art001"].heading == "第1章 総則 > 第1条（目的）"
    assert by_id["com001"].heading.endswith("【解説】第1条 目的")


def test_toc_is_not_indexed_and_quoted_statute_is_not_an_article():
    chunks = chunk_document(make_doc())
    assert not any("目 次" in c.text for c in chunks)
    # "第３８条 労働時間は…" is a statute quoted inside a reference box
    assert not any(i.startswith("art038") for i in ids(chunks))
    ref = next(c for c in chunks if c.kind == "reference")
    assert "第３８条" in ref.text
    assert "【解説】第19条" in ref.heading


def test_label_only_blocks_are_merged_into_the_following_article():
    chunks = chunk_document(make_doc())
    by_id = {c.chunk_id.split("#")[1]: c for c in chunks}
    # the chapter heading + intro line and the ［例１］ label are part of the article chunk
    assert by_id["art001"].text.startswith("第１章")
    assert by_id["art019-ex1"].text.startswith("第２章") or by_id["art019-ex1"].text.startswith(
        "［例１］"
    )
    assert "ch02-intro" not in by_id


def test_long_blocks_are_split_at_item_boundaries_with_stable_ids():
    items = "\n".join(f"{n} 第{n}項の規定。" + "あ" * 60 for n in "２３４５６７８９")
    doc = make_doc(["第１章 総則\n（目的）\n第１条 本文。" + "い" * 50 + "\n" + items])
    chunker = StructureChunker(max_chars=150)
    chunks = chunker.chunk(doc)
    got = ids(chunks)
    assert got[0] == "art001" and got[1] == "art001-p2"
    assert all(len(c.text) <= 150 for c in chunks)
    # every part starts at an item boundary, not in the middle of a sentence
    for c in chunks[1:]:
        assert c.text[0] in "２３４５６７８９"
    # ids are deterministic
    assert ids(StructureChunker(max_chars=150).chunk(doc)) == got


def test_oversized_sentence_is_hard_split():
    doc = make_doc(["（目的）\n第１条 " + "あ" * 500])
    chunks = StructureChunker(max_chars=120).chunk(doc)
    assert all(len(c.text) <= 120 for c in chunks)
    assert "".join(c.text for c in chunks).replace("\n", "") == doc.text.replace("\n", "")


def test_markdown_rules_document():
    path = FIXTURES / "sample_rules.md"
    doc = load_document(path, {"doc_id": "t"})
    chunks = chunk_document(doc)
    got = ids(chunks)
    assert {"art001", "art002", "art003", "art004", "art005", "art006"} <= set(got)
    by_id = {c.chunk_id.split("#")[1]: c for c in chunks}
    assert by_id["art003"].heading == "第2章 勤務 > 第3条（年次有給休暇）"
    assert by_id["art003"].page_start is None
    for c in chunks:
        assert doc.text[c.start : c.end] == c.text


def test_clean_page_text_drops_page_number_and_blank_runs():
    assert clean_page_text("- 10 - \n\n本文１ \n\n\n本文２\n") == "本文１\n\n本文２"
    assert clean_page_text("２\nはじめに") == "はじめに"


def test_chunker_rejects_tiny_max_chars():
    with pytest.raises(ValueError):
        StructureChunker(max_chars=10)


@pytest.mark.skipif(
    not (Path(__file__).parents[1] / "data/raw/mhlw_model_shugyo_kisoku_r0712.pdf").exists(),
    reason="corpus PDF not present",
)
def test_real_model_rules_pdf():
    raw = Path(__file__).parents[1] / "data" / "raw"
    meta = load_manifest(raw)["mhlw_model_shugyo_kisoku_r0712.pdf"]
    doc = load_document(raw / "mhlw_model_shugyo_kisoku_r0712.pdf", meta)
    assert len(doc.pages) == 94
    chunks = chunk_document(doc)
    by_id = {c.chunk_id.split("#")[1]: c for c in chunks}
    assert len(by_id) == len(chunks)  # unique ids
    assert by_id["art023"].page_start == 40
    assert "１０日の年次有給休暇を与える" in by_id["art023"].text
    assert {"art051-ex1", "art051-ex2", "art051-ex3", "art051-ex4"} <= set(by_id)
    assert "art038~2" not in by_id  # statute quoted in the 副業 commentary
    assert all(len(c.text) <= 600 for c in chunks)
