"""Smoke test of the real embedding model (downloads ~470 MB on first run).

Run with ``make test-all`` or ``pytest -m slow``.
"""

import numpy as np
import pytest

from knowledge_ai.config import Settings


@pytest.mark.slow
def test_e5_ranks_the_relevant_passage_first():
    from knowledge_ai.retrieval.embeddings import E5Embedder

    s = Settings.from_env()
    emb = E5Embedder(s.embedding_model, s.embedding_revision, s.model_cache_dir)
    passages = [
        "採用日から６か月間継続勤務し、所定労働日の８割以上出勤した労働者に対しては、１０日の年次有給休暇を与える。",
        "賃金は、毎月末日に締め切って計算し、翌月２５日に支払う。",
        "労働者は、勤務時間外において、他の会社等の業務に従事することができる。",
    ]
    p = emb.embed_documents(passages)
    q = emb.embed_query("有給休暇は何日もらえますか")
    assert p.shape == (3, 384)
    assert np.allclose(np.linalg.norm(p, axis=1), 1.0, atol=1e-4)
    assert int(np.argmax(p @ q)) == 0
