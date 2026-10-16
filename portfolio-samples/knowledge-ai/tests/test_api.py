"""HTTP API through FastAPI's TestClient with the extractive provider (no key, no network)."""

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from knowledge_ai.api.app import create_app


@pytest.fixture
def client(service, settings):
    with TestClient(create_app(service=service, settings=settings)) as c:
        yield c


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["provider"] == "extractive"
    assert body["chunks"] > 0


def test_documents_include_source_and_attribution(client):
    docs = client.get("/documents").json()
    assert docs == [
        {
            "doc_id": "test-rules",
            "title": "テスト用就業規則",
            "kind": "markdown",
            "pages": None,
            "chunks": docs[0]["chunks"],
            "source_url": "https://example.invalid/rules",
            "license": "test",
            "attribution": "テスト用",
        }
    ]


def test_ask_returns_answer_with_highlightable_citations(client):
    r = client.post("/ask", json={"question": "在宅勤務手当はいくらですか？"})
    assert r.status_code == 200
    body = r.json()
    assert body["abstained"] is False
    assert body["provider"] == "extractive"
    assert "3,000円" in body["answer"]
    c = body["citations"][0]
    assert c["chunk_text"][c["chunk_start"] : c["chunk_end"]] == c["quote"]
    assert c["heading"].endswith("第4条（在宅勤務）")
    assert body["retrieved"] and body["retrieved"][0]["rank"] == 1


def test_ask_abstains_with_fixed_message(service, settings):
    strict = replace(service.policy, threshold=10.0)
    service.policy = strict
    with TestClient(create_app(service=service, settings=settings)) as c:
        body = c.post("/ask", json={"question": "社員食堂の営業時間は？"}).json()
    assert body["abstained"] is True
    assert body["answer"] == "資料に記載がありません"
    assert body["citations"] == []


@pytest.mark.parametrize("question", ["", "   ", "あ" * 301])
def test_ask_validates_question(client, question):
    assert client.post("/ask", json={"question": question}).status_code == 422


def test_rate_limit_per_minute(service, settings):
    limited = replace(settings, rate_limit_per_minute=2)
    with TestClient(create_app(service=service, settings=limited)) as c:
        codes = [
            c.post("/ask", json={"question": "副業はできますか"}).status_code for _ in range(3)
        ]
        assert codes == [200, 200, 429]
        r = c.post("/ask", json={"question": "副業はできますか"})
        assert int(r.headers["Retry-After"]) >= 1
        assert "時間をおいて" in r.json()["detail"]


def test_daily_cap(service, settings):
    capped = replace(settings, daily_cap=1)
    with TestClient(create_app(service=service, settings=capped)) as c:
        assert c.post("/ask", json={"question": "副業"}).status_code == 200
        r = c.post("/ask", json={"question": "副業"})
        assert r.status_code == 429 and "上限" in r.json()["detail"]


def test_ui_and_security_headers(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "AI総務さん" in r.text
    assert "default-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["x-content-type-options"] == "nosniff"
    assert client.get("/static/app.js").status_code == 200


def test_health_reports_missing_index(tmp_path, settings):
    missing = replace(settings, index_path=tmp_path / "nope.sqlite")
    with TestClient(create_app(settings=missing)) as c:
        r = c.get("/health")
        assert r.status_code == 503
        assert "index not found" in r.json()["error"]
        assert c.post("/ask", json={"question": "副業"}).status_code == 503
