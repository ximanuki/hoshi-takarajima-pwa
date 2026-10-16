import pytest

from knowledge_ai.retrieval.tokenizer import CharNgramTokenizer, normalize


def test_bigrams_for_japanese_compound():
    assert CharNgramTokenizer(2)("年次有給休暇") == ["年次", "次有", "有給", "給休", "休暇"]


def test_full_width_digits_are_normalised_and_kept_whole():
    # "１０日" → NFKC "10日": the number stays one token, the lone kanji is a unigram
    assert CharNgramTokenizer(2)("１０日") == ["10", "日"]


def test_pdf_line_wraps_inside_words_are_ignored():
    tok = CharNgramTokenizer(2)
    assert tok("就業規\n則") == tok("就業規則")
    assert tok("就業規 　則") == tok("就業規則")


def test_ascii_words_are_lowercased_and_not_split():
    assert CharNgramTokenizer(2)("PDFファイル") == ["pdf", "ファ", "ァイ", "イル"]
    assert CharNgramTokenizer(2)("12,000円") == ["12,000", "円"]


def test_punctuation_separates_runs():
    assert CharNgramTokenizer(2)("賞与、退職金。") == ["賞与", "退職", "職金"]


def test_with_unigrams_and_trigrams():
    assert CharNgramTokenizer(2, with_unigrams=True)("賞与") == ["賞", "与", "賞与"]
    assert CharNgramTokenizer(3)("年次有給") == ["年次有", "次有給"]
    assert CharNgramTokenizer(3)("賞与") == ["賞与"]  # shorter than n → whole run


def test_name_and_validation():
    assert CharNgramTokenizer(2).name == "char2gram"
    assert CharNgramTokenizer(2, True).name == "char2gram+uni"
    with pytest.raises(ValueError):
        CharNgramTokenizer(0)


def test_normalize_is_nfkc_lowercase():
    assert normalize("ＡＢＣ　１２") == "abc 12"
