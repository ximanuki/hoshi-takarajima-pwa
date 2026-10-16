from knowledge_ai.text import MatchIndex, display_text, locate_quote, split_units

SOURCE = "第２３条 採用日から６か月間継続勤務し、所定労働日の８割以上出勤した労働者に\n対しては、１０日の年次有給休暇を与える。"


def test_quote_found_across_line_break_and_width_differences():
    span = locate_quote(
        SOURCE, "所定労働日の8割以上出勤した労働者に対しては、10日の年次有給休暇を与える。"
    )
    assert span is not None
    s, e = span
    assert SOURCE[s:e].startswith("所定労働日")
    assert SOURCE[s:e].endswith("与える。")
    assert "\n" in SOURCE[s:e]  # the span covers the original line break


def test_quote_wrapped_in_japanese_brackets():
    assert locate_quote(SOURCE, "「１０日の年次有給休暇を与える。」") is not None


def test_paraphrase_is_not_a_quote():
    assert locate_quote(SOURCE, "有給休暇は10日もらえる") is None
    assert locate_quote(SOURCE, "   ") is None


def test_find_all_returns_every_occurrence():
    idx = MatchIndex("満７０歳まで継続雇用する。…満７０歳まで継続雇用する。")
    assert len(idx.find_all("満70歳まで継続雇用")) == 2
    assert len(idx.find_all("満70歳まで継続雇用", limit=1)) == 1


def test_split_units_on_sentence_end_and_list_items():
    text = "賃金から控除するもの\n① 源泉所得税\n② 住民税\n２ 前項の規定は、次の場合に適用する。残りの文。"
    units = [text[s:e] for s, e in split_units(text)]
    assert units == [
        "賃金から控除するもの",
        "① 源泉所得税",
        "② 住民税",
        "２ 前項の規定は、次の場合に適用する。",
        "残りの文。",
    ]


def test_display_text_joins_wrapped_lines():
    assert display_text("労働者に\n対しては、１０日") == "労働者に対しては、１０日"
    assert display_text("PDF\nfile") == "PDF file"
