#!/usr/bin/env python
"""Evaluate AI総務さん and write ``reports/eval-<date>.md`` (+ a JSON with raw numbers).

What is measured (all on data/eval/qa.jsonl):

1. Retrieval — Recall@1/3/5 and MRR@10 for BM25-only, dense-only and hybrid
   (RRF), plus two ablations: glossary on/off and BM25 tokenizer choice.
2. Abstention — precision/recall of 「資料に記載がありません」 for the full
   extractive pipeline (retrieval gate + extractive answer + citation check),
   AUROC of each support signal, and a threshold sweep on the *dev* split.
3. Answer quality (extractive) — key-phrase containment and whether a citation
   overlaps the gold evidence.
4. Answer quality (Claude) — same metrics plus unverified-citation rate, tokens
   and cost. Runs only when ANTHROPIC_API_KEY is set; otherwise it is reported
   as skipped. Never fabricated.
5. Cost estimate per question for Haiku 4.5 vs Sonnet 5.5 from measured prompt
   sizes and an explicitly stated tokens-per-character assumption.

Usage:  python scripts/eval.py [--qa data/eval/qa.jsonl] [--out reports] [--claude auto|skip]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import statistics
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from knowledge_ai import __version__
from knowledge_ai.answer.claude import ClaudeProvider, price_for
from knowledge_ai.answer.prompts import SYSTEM_PROMPT, build_user_message
from knowledge_ai.config import PROJECT_ROOT, Settings
from knowledge_ai.evaluation import (
    QAItem,
    abstention_metrics,
    auroc,
    citation_hits_evidence,
    contains_answer,
    first_relevant_rank,
    load_qa,
    locate_evidence,
    relevant_chunks,
    retrieval_metrics,
)
from knowledge_ai.retrieval.glossary import QueryExpander
from knowledge_ai.retrieval.retriever import MODES, HybridRetriever
from knowledge_ai.retrieval.tokenizer import CharNgramTokenizer
from knowledge_ai.schemas import AnswerResult
from knowledge_ai.service import AnswerService

K_RANK = 10
# Assumed tokens per Japanese character for the cost *estimate* (low, high).
TOKENS_PER_CHAR = (0.8, 1.3)
ASSUMED_OUTPUT_TOKENS = 250
COST_MODELS = ("claude-haiku-4-5-20251001", "claude-sonnet-5-5")


def pct(x: float) -> str:
    return f"{100 * x:.1f}%"


def f3(x: float) -> str:
    return f"{x:.3f}"


def median(xs: list[float]) -> float:
    return statistics.median(xs) if xs else float("nan")


def p95(xs: list[float]) -> float:
    if not xs:
        return float("nan")
    s = sorted(xs)
    return s[min(len(s) - 1, round(0.95 * (len(s) - 1)))]


def subset(
    items: list[QAItem],
    split: str | None = None,
    doc: str | None = None,
    answerable: bool | None = None,
) -> list[QAItem]:
    return [
        i
        for i in items
        if (split is None or i.split == split)
        and (doc is None or i.doc_id == doc)
        and (answerable is None or i.answerable == answerable)
    ]


# --------------------------------------------------------------------- retrieval
def eval_retrieval(retriever: HybridRetriever, items: list[QAItem], rel: dict[str, set[str]]):
    ranks: dict[str, dict[str, int | None]] = {m: {} for m in MODES}
    latency: dict[str, list[float]] = {m: [] for m in MODES}
    for it in items:
        for mode in MODES:
            t0 = time.perf_counter()
            res = retriever.search(it.question, k=K_RANK, mode=mode)
            wall = (time.perf_counter() - t0) * 1000
            # bm25-only latency excludes the query embedding that is computed for
            # the abstention signal; dense/hybrid include it.
            latency[mode].append(res.timings_ms["bm25"] if mode == "bm25" else wall)
            ranks[mode][it.id] = first_relevant_rank(
                [h.chunk.chunk_id for h in res.hits], rel[it.id]
            )
    return ranks, latency


def tokenizer_ablation(retriever: HybridRetriever, items: list[QAItem], rel: dict[str, set[str]]):
    """BM25-only and hybrid metrics per tokenizer, overall and per split."""
    tokenizers = [
        CharNgramTokenizer(1),
        CharNgramTokenizer(2),
        CharNgramTokenizer(2, True),
        CharNgramTokenizer(3),
    ]
    out: dict[str, dict[str, dict[str, dict[str, float]]]] = {}
    for tok in tokenizers:
        variant = HybridRetriever(
            retriever.chunks,
            retriever.embedder,
            retriever.vector_index,
            tokenizer=tok,
            rrf_k=retriever.rrf_k,
            candidate_k=retriever.candidate_k,
            expander=retriever.expander,
        )
        out[tok.name] = {}
        for mode in ("bm25", "hybrid"):
            ranks = {
                it.id: first_relevant_rank(
                    [
                        h.chunk.chunk_id
                        for h in variant.search(it.question, k=K_RANK, mode=mode).hits
                    ],
                    rel[it.id],
                )
                for it in items
            }
            out[tok.name][mode] = {
                g: retrieval_metrics([ranks[i.id] for i in items if g == "all" or i.split == g])
                for g in ("all", "dev", "test")
            }
    return out


# -------------------------------------------------------------------- abstention
def sweep(supports: list[float], unans: list[bool], declined: list[bool]) -> list[dict[str, Any]]:
    rows = []
    for t in [round(x * 0.02, 2) for x in range(0, 61)]:
        pred = [s < t or d for s, d in zip(supports, declined, strict=True)]
        m = abstention_metrics(pred, unans)
        rows.append({"threshold": t, **m})
    return rows


def pick_threshold(rows: list[dict[str, Any]]) -> dict[str, Any]:
    # maximise F1 on dev; ties → fewer false abstentions → lower threshold
    return sorted(rows, key=lambda r: (-r["f1"], r["fp"], r["threshold"]))[0]


# ------------------------------------------------------------------------ report
def table(headers: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    lines += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--qa", type=Path, default=PROJECT_ROOT / "data" / "eval" / "qa.jsonl")
    ap.add_argument("--out", type=Path, default=PROJECT_ROOT / "reports")
    ap.add_argument("--claude", choices=["auto", "skip"], default="auto")
    args = ap.parse_args()

    settings = Settings.from_env()
    if settings.embedder != "fastembed":
        print(
            "warning: KAI_EMBEDDER is not 'fastembed'; dense numbers will not be meaningful",
            file=sys.stderr,
        )
    service = AnswerService.from_settings(settings, provider="extractive")
    retriever = service.retriever
    items = load_qa(args.qa)
    answerable = [i for i in items if i.answerable]

    spans = {it.id: locate_evidence(it, service.documents) for it in answerable}
    rel = {it.id: relevant_chunks(spans[it.id], retriever.chunks) for it in answerable}
    missing = [i for i, r in rel.items() if not r]
    if missing:
        raise SystemExit(f"gold evidence not covered by any chunk: {missing}")

    # 1. retrieval ---------------------------------------------------------
    ranks, latency = eval_retrieval(retriever, answerable, rel)
    no_gloss = HybridRetriever(
        retriever.chunks,
        retriever.embedder,
        retriever.vector_index,
        rrf_k=retriever.rrf_k,
        candidate_k=retriever.candidate_k,
        expander=QueryExpander(),
    )
    ranks_ng, _ = eval_retrieval(no_gloss, answerable, rel)
    tok_ablation = tokenizer_ablation(retriever, answerable, rel)

    def rmetrics(rk: dict[str, int | None], its: list[QAItem]) -> dict[str, float]:
        return retrieval_metrics([rk[i.id] for i in its])

    groups = {
        "all": answerable,
        "dev": subset(answerable, split="dev"),
        "test": subset(answerable, split="test"),
        "mhlw": subset(answerable, doc="mhlw-model-rules"),
        "sample": subset(answerable, doc="sample-expense-rules"),
    }
    retrieval = {m: {g: rmetrics(ranks[m], its) for g, its in groups.items()} for m in MODES}
    retrieval_ng = {m: rmetrics(ranks_ng[m], answerable) for m in ("bm25", "hybrid")}

    # 2. abstention (extractive pipeline) ----------------------------------
    per_item: dict[str, dict[str, Any]] = {}
    for it in items:
        gate = service.gate(it.question)
        draft = service.provider.answer(it.question, gate.retrieval.hits)
        result: AnswerResult = service.ask(it.question)
        cited = [(c.doc_id, c.doc_start, c.doc_end) for c in result.citations]
        per_item[it.id] = {
            "support": gate.support,
            "signals": gate.retrieval.signals.as_dict(),
            "abstained": result.abstained,
            "abstain_reason": result.abstain_reason,
            "declined_by_extractive": not draft.answerable,
            "contains_answer": contains_answer(result.answer, it) if it.answerable else None,
            "citation_hits_gold": (
                citation_hits_evidence(cited, spans[it.id]) if it.answerable and cited else False
            ),
            "answer": result.answer,
        }

    def abst(its: list[QAItem]) -> dict[str, float]:
        return abstention_metrics(
            [per_item[i.id]["abstained"] for i in its], [not i.answerable for i in its]
        )

    abstention = {
        g: abst(subset(items, split=None if g == "all" else g)) for g in ("all", "dev", "test")
    }
    signal_auroc: dict[str, dict[str, float]] = {}
    for g in ("all", "dev", "test"):
        its = subset(items, split=None if g == "all" else g)
        labels = [not i.answerable for i in its]
        signal_auroc[g] = {
            "dense_top": auroc([-per_item[i.id]["signals"]["dense_top"] for i in its], labels),
            "lexical_coverage": auroc(
                [-per_item[i.id]["signals"]["lexical_coverage"] for i in its], labels
            ),
            "support (combined)": auroc([-per_item[i.id]["support"] for i in its], labels),
        }
    dev_items = subset(items, split="dev")
    test_items = subset(items, split="test")
    sweep_dev = sweep(
        [per_item[i.id]["support"] for i in dev_items],
        [not i.answerable for i in dev_items],
        [per_item[i.id]["declined_by_extractive"] for i in dev_items],
    )
    chosen = pick_threshold(sweep_dev)
    test_at_chosen = abstention_metrics(
        [
            per_item[i.id]["support"] < chosen["threshold"]
            or per_item[i.id]["declined_by_extractive"]
            for i in test_items
        ],
        [not i.answerable for i in test_items],
    )

    # 3. extractive answer quality -----------------------------------------
    answered = [i for i in answerable if not per_item[i.id]["abstained"]]
    extractive_quality = {
        "answered": len(answered),
        "answerable": len(answerable),
        "contains_answer": sum(per_item[i.id]["contains_answer"] for i in answered)
        / max(1, len(answered)),
        "citation_hits_gold": sum(per_item[i.id]["citation_hits_gold"] for i in answered)
        / max(1, len(answered)),
    }

    # 4. Claude ------------------------------------------------------------
    claude_section: dict[str, Any] = {"status": "skipped", "reason": ""}
    key = settings.anthropic_api_key
    if args.claude == "skip":
        claude_section["reason"] = "--claude skip"
    elif not key:
        claude_section["reason"] = (
            "ANTHROPIC_API_KEY が未設定のため未実行 (not run: no ANTHROPIC_API_KEY)"
        )
    else:
        claude = ClaudeProvider(
            settings.claude_model,
            api_key=key,
            max_tokens=settings.claude_max_tokens,
            timeout=settings.claude_timeout_s,
            titles={d.doc_id: d.title for d in service.documents.values()},
        )
        c_items: dict[str, dict[str, Any]] = {}
        errors = 0
        for it in items:
            t0 = time.perf_counter()
            try:
                r = service.ask(it.question, provider=claude)
            except Exception as e:  # record the failure and keep evaluating
                errors += 1
                c_items[it.id] = {"error": repr(e)}
                continue
            cited = [(c.doc_id, c.doc_start, c.doc_end) for c in r.citations]
            c_items[it.id] = {
                "abstained": r.abstained,
                "reason": r.abstain_reason,
                "answer": r.answer,
                "verified": len(r.citations),
                "unverified": r.unverified_citations,
                "contains_answer": contains_answer(r.answer, it) if it.answerable else None,
                "citation_hits_gold": (
                    citation_hits_evidence(cited, spans[it.id])
                    if it.answerable and cited
                    else False
                ),
                "usage": r.usage or {},
                "latency_ms": (time.perf_counter() - t0) * 1000,
                "degraded": r.degraded,
            }
        ok = [i for i in items if "error" not in c_items[i.id]]
        c_answered = [i for i in ok if i.answerable and not c_items[i.id]["abstained"]]
        llm_calls = [c_items[i.id] for i in ok if c_items[i.id]["usage"]]
        claude_section = {
            "status": "ran",
            "model": settings.claude_model,
            "errors": errors,
            "abstention": abstention_metrics(
                [c_items[i.id]["abstained"] for i in ok], [not i.answerable for i in ok]
            ),
            "answered": len(c_answered),
            "contains_answer": sum(c_items[i.id]["contains_answer"] for i in c_answered)
            / max(1, len(c_answered)),
            "citation_hits_gold": sum(c_items[i.id]["citation_hits_gold"] for i in c_answered)
            / max(1, len(c_answered)),
            "unverified_citation_rate": (
                sum(c["unverified"] for c in c_items.values() if "error" not in c)
                / max(
                    1,
                    sum(
                        c["verified"] + c["unverified"]
                        for c in c_items.values()
                        if "error" not in c
                    ),
                )
            ),
            "llm_calls": len(llm_calls),
            "mean_input_tokens": statistics.mean(c["usage"]["input_tokens"] for c in llm_calls)
            if llm_calls
            else None,
            "mean_output_tokens": statistics.mean(c["usage"]["output_tokens"] for c in llm_calls)
            if llm_calls
            else None,
            "mean_cost_usd": statistics.mean(c["usage"].get("cost_usd", 0) for c in llm_calls)
            if llm_calls
            else None,
            "median_latency_ms": median([c["latency_ms"] for c in llm_calls]),
            "items": c_items,
        }

    # 5. cost estimate -----------------------------------------------------
    titles = {d.doc_id: d.title for d in service.documents.values()}
    prompt_chars = []
    for it in answerable:
        if (
            per_item[it.id]["abstained"]
            and per_item[it.id]["abstain_reason"] == "low_retrieval_support"
        ):
            continue  # gated questions never reach the LLM
        hits = service.gate(it.question).retrieval.hits
        prompt_chars.append(len(SYSTEM_PROMPT) + len(build_user_message(it.question, hits, titles)))
    mean_chars = statistics.mean(prompt_chars)
    cost_rows = []
    for model in COST_MODELS:
        pin, pout = price_for(model) or (float("nan"), float("nan"))
        lo = mean_chars * TOKENS_PER_CHAR[0] / 1e6 * pin + ASSUMED_OUTPUT_TOKENS / 1e6 * pout
        hi = mean_chars * TOKENS_PER_CHAR[1] / 1e6 * pin + ASSUMED_OUTPUT_TOKENS / 1e6 * pout
        cost_rows.append(
            {
                "model": model,
                "input_per_mtok": pin,
                "output_per_mtok": pout,
                "usd_low": lo,
                "usd_high": hi,
            }
        )

    # ------------------------------------------------------------------ write
    tz = ZoneInfo(settings.timezone)
    now = datetime.now(tz)
    date = now.strftime("%Y-%m-%d")
    args.out.mkdir(parents=True, exist_ok=True)
    qa_sha = hashlib.sha256(args.qa.read_bytes()).hexdigest()[:12]
    meta = {
        "date": now.isoformat(timespec="seconds"),
        "version": __version__,
        "qa_file": str(args.qa.relative_to(PROJECT_ROOT))
        if args.qa.is_relative_to(PROJECT_ROOT)
        else str(args.qa),
        "qa_sha256_12": qa_sha,
        "questions": len(items),
        "answerable": len(answerable),
        "unanswerable": len(items) - len(answerable),
        "dev": len(dev_items),
        "test": len(test_items),
        "chunks": len(retriever.chunks),
        "documents": [d.title for d in service.documents.values()],
        "embedder": retriever.embedder.name,
        "glossary_terms": len(retriever.expander),
        "rrf_k": retriever.rrf_k,
        "candidate_k": retriever.candidate_k,
        "top_k": service.top_k,
        "threshold_configured": service.policy.threshold,
        "python": platform.python_version(),
        "machine": f"{platform.system()} {platform.machine()}, {os.cpu_count()} CPUs",
    }
    raw = {
        "meta": meta,
        "retrieval": retrieval,
        "retrieval_no_glossary": retrieval_ng,
        "bm25_tokenizer_ablation": tok_ablation,
        "latency_ms": {m: {"median": median(v), "p95": p95(v)} for m, v in latency.items()},
        "abstention": abstention,
        "signal_auroc": signal_auroc,
        "sweep_dev": sweep_dev,
        "threshold_selected_on_dev": chosen,
        "test_at_selected_threshold": test_at_chosen,
        "extractive_quality": extractive_quality,
        "claude": claude_section,
        "cost_estimate": {
            "mean_prompt_chars": mean_chars,
            "tokens_per_char": TOKENS_PER_CHAR,
            "assumed_output_tokens": ASSUMED_OUTPUT_TOKENS,
            "rows": cost_rows,
        },
        "per_item": per_item,
        "ranks": ranks,
    }
    (args.out / f"eval-{date}.json").write_text(
        json.dumps(raw, ensure_ascii=False, indent=1, default=float), encoding="utf-8"
    )

    md: list[str] = []
    md.append(f"# 評価レポート / Evaluation report — {date}\n")
    md.append(
        "自動生成: `python scripts/eval.py`。数値はすべてこの実行で計測した実測値です "
        "(all numbers below were measured by this run; nothing is hand-edited).\n"
    )
    md.append("## Setup\n")
    md.append(
        table(
            ["item", "value"],
            [
                [
                    "questions",
                    f"{meta['questions']} ({meta['answerable']} answerable / {meta['unanswerable']} unanswerable)",
                ],
                ["split", f"dev {meta['dev']} / test {meta['test']}"],
                ["dataset", f"`{meta['qa_file']}` (sha256 {qa_sha}…)"],
                ["corpus", f"{len(meta['documents'])} documents, {meta['chunks']} chunks"],
                ["embedding model", f"`{meta['embedder']}` (ONNX, CPU)"],
                [
                    "retrieval",
                    f"BM25 (char bigram) + dense, RRF k={meta['rrf_k']}, "
                    f"{meta['candidate_k']} candidates/retriever, top-{meta['top_k']} to the answerer",
                ],
                ["glossary", f"{meta['glossary_terms']} terms (BM25 query expansion)"],
                ["machine", f"{meta['machine']}, Python {meta['python']}"],
            ],
        )
    )
    md.append(
        "\nRelevance: a chunk is relevant if it covers ≥50% of a gold evidence quote "
        "(gold labels are verbatim quotes, independent of chunking). "
        "Recall@k = share of answerable questions with ≥1 relevant chunk in the top k.\n"
    )

    md.append("## 1. Retrieval (answerable questions)\n")
    rows = []
    for m in MODES:
        r = retrieval[m]["all"]
        rows.append(
            [
                m,
                pct(r["recall@1"]),
                pct(r["recall@3"]),
                pct(r["recall@5"]),
                f3(r["mrr@10"]),
                f"{median(latency[m]):.1f} / {p95(latency[m]):.1f}",
            ]
        )
    md.append(
        table(
            ["mode", "Recall@1", "Recall@3", "Recall@5", "MRR@10", "latency ms (median / p95)"],
            rows,
        )
    )
    md.append(
        f"\nn = {len(answerable)}. Latency is per query on this machine; "
        "bm25 excludes the query embedding, dense/hybrid include it.\n"
    )
    md.append("### By split and document (Recall@5 / MRR@10)\n")
    rows = []
    for m in MODES:
        rows.append(
            [m]
            + [
                f"{pct(retrieval[m][g]['recall@5'])} / {f3(retrieval[m][g]['mrr@10'])}"
                for g in ("dev", "test", "mhlw", "sample")
            ]
        )
    md.append(
        table(
            [
                "mode",
                f"dev (n={len(groups['dev'])})",
                f"test (n={len(groups['test'])})",
                f"MHLW model rules (n={len(groups['mhlw'])})",
                f"fictional expense rules (n={len(groups['sample'])})",
            ],
            rows,
        )
    )
    md.append("\n### Ablation: glossary query expansion\n")
    rows = []
    for m in ("bm25", "hybrid"):
        a, b = retrieval_ng[m], retrieval[m]["all"]
        rows.append(
            [
                m,
                f"{pct(a['recall@1'])} → {pct(b['recall@1'])}",
                f"{pct(a['recall@5'])} → {pct(b['recall@5'])}",
                f"{f3(a['mrr@10'])} → {f3(b['mrr@10'])}",
            ]
        )
    md.append(table(["mode", "Recall@1 (without → with)", "Recall@5", "MRR@10"], rows))
    md.append("\n### Ablation: lexical tokenizer (Recall@1 / MRR@10)\n")
    rows = []
    for name, v in tok_ablation.items():
        for mode in ("bm25", "hybrid"):
            rows.append(
                [name, mode]
                + [
                    f"{pct(v[mode][g]['recall@1'])} / {f3(v[mode][g]['mrr@10'])}"
                    for g in ("all", "dev", "test")
                ]
            )
    md.append(table(["tokenizer", "mode", "all", "dev", "test"], rows))
    misses = [it for it in answerable if (ranks["hybrid"][it.id] or 99) > 5]
    md.append(f"\n### Hybrid misses (no relevant chunk in top 5): {len(misses)}\n")
    for it in misses:
        md.append(
            f"- `{it.id}` ({it.split}) {it.question} — gold: {it.gold_ref}, "
            f"first relevant rank: {ranks['hybrid'][it.id] or '>10'}"
        )

    md.append("\n## 2. Abstention (「資料に記載がありません」)\n")
    md.append(
        "Positive class = *should abstain*. Pipeline = hybrid retrieval → support gate → "
        "extractive answer → citation verification. Precision = abstentions that were correct; "
        "recall = unanswerable questions caught; false-abstention rate = answerable questions refused.\n"
    )
    rows = []
    for g in ("all", "dev", "test"):
        a = abstention[g]
        rows.append(
            [
                g,
                pct(a["precision"]),
                pct(a["recall"]),
                f3(a["f1"]),
                pct(a["false_abstention_rate"]),
                f"{a['tp']}/{a['fp']}/{a['fn']}/{a['tn']}",
            ]
        )
    md.append(
        table(["split", "precision", "recall", "F1", "false-abstention rate", "TP/FP/FN/TN"], rows)
    )
    md.append(
        f"\nConfigured threshold: **{service.policy.threshold}** "
        f"(support = lexical_coverage + {service.policy.dense_weight}·(dense_top − {service.policy.dense_floor})).\n"
    )
    md.append("### Signal quality (AUROC for separating unanswerable from answerable)\n")
    rows = [
        [s] + [f3(signal_auroc[g][s]) for g in ("all", "dev", "test")]
        for s in ("dense_top", "lexical_coverage", "support (combined)")
    ]
    md.append(table(["signal", "all", "dev", "test"], rows))
    md.append("\n### Threshold selection (dev only) and held-out check\n")
    md.append(
        f"Selected on dev by max F1 (ties → fewer false abstentions): **t = {chosen['threshold']}** "
        f"(dev P {pct(chosen['precision'])}, R {pct(chosen['recall'])}). "
        f"Applied to test: P {pct(test_at_chosen['precision'])}, R {pct(test_at_chosen['recall'])}, "
        f"false-abstention {pct(test_at_chosen['false_abstention_rate'])} "
        f"(TP/FP/FN/TN {test_at_chosen['tp']}/{test_at_chosen['fp']}/{test_at_chosen['fn']}/{test_at_chosen['tn']}).\n"
    )
    rows = [
        [
            str(r["threshold"]),
            pct(r["precision"]),
            pct(r["recall"]),
            f3(r["f1"]),
            pct(r["false_abstention_rate"]),
        ]
        for r in sweep_dev
        if 0.2 <= r["threshold"] <= 0.6
    ]
    md.append("<details><summary>dev sweep</summary>\n")
    md.append(table(["threshold", "precision", "recall", "F1", "false-abstention"], rows))
    md.append("\n</details>\n")
    wrong = [it for it in items if per_item[it.id]["abstained"] == it.answerable]
    md.append(f"### Abstention errors ({len(wrong)})\n")
    for it in wrong:
        kind = "refused answerable" if it.answerable else "answered unanswerable"
        md.append(
            f"- `{it.id}` ({it.split}, {kind}) {it.question} — support "
            f"{per_item[it.id]['support']:.3f}"
        )

    md.append("\n## 3. Answer quality — extractive provider (no LLM)\n")
    md.append(
        table(
            ["metric", "value"],
            [
                [
                    "answerable questions answered",
                    f"{extractive_quality['answered']}/{extractive_quality['answerable']}",
                ],
                [
                    "answer contains the expected key phrase",
                    pct(extractive_quality["contains_answer"]),
                ],
                [
                    "a citation overlaps the gold evidence",
                    pct(extractive_quality["citation_hits_gold"]),
                ],
            ],
        )
    )
    md.append(
        "\nKey-phrase containment is a cheap proxy (e.g. 「１０日」 must appear in the answer); "
        "it is not a human judgement of correctness.\n"
    )

    md.append("## 4. Answer quality — Claude\n")
    if claude_section["status"] != "ran":
        md.append(
            f"**Skipped** — {claude_section['reason']}. The code path is implemented "
            "(`ClaudeProvider`, structured outputs, citation verification) and unit-tested with a "
            "fake client, but it has **not** been run against the real API for this report.\n"
        )
    else:
        c = claude_section
        a = c["abstention"]
        md.append(
            table(
                ["metric", "value"],
                [
                    ["model", f"`{c['model']}`"],
                    ["errors", str(c["errors"])],
                    [
                        "abstention precision / recall",
                        f"{pct(a['precision'])} / {pct(a['recall'])}",
                    ],
                    ["false-abstention rate", pct(a["false_abstention_rate"])],
                    ["answer contains key phrase", pct(c["contains_answer"])],
                    ["a citation overlaps the gold evidence", pct(c["citation_hits_gold"])],
                    ["citations dropped by verification", pct(c["unverified_citation_rate"])],
                    ["LLM calls (gate passed)", str(c["llm_calls"])],
                    [
                        "mean input / output tokens",
                        f"{c['mean_input_tokens']:.0f} / {c['mean_output_tokens']:.0f}",
                    ],
                    ["mean cost per LLM call (USD)", f"{c['mean_cost_usd']:.5f}"],
                    ["median latency", f"{c['median_latency_ms']:.0f} ms"],
                ],
            )
        )

    md.append("\n## 5. Cost per question — ESTIMATE (not measured)\n")
    md.append(
        f"Measured: mean prompt size = **{mean_chars:.0f} characters** (system prompt + top-{service.top_k} "
        f"chunks + question) over {len(prompt_chars)} questions that pass the gate. "
        f"Assumed: {TOKENS_PER_CHAR[0]}–{TOKENS_PER_CHAR[1]} tokens per character and "
        f"{ASSUMED_OUTPUT_TOKENS} output tokens. Prices: Anthropic list prices (USD per 1M tokens) "
        "as of 2026-09. Questions stopped by the gate cost $0.\n"
    )
    rows = [
        [
            f"`{r['model']}`",
            f"${r['input_per_mtok']:.2f} / ${r['output_per_mtok']:.2f}",
            f"${r['usd_low']:.4f} – ${r['usd_high']:.4f}",
            f"${1000 * r['usd_low']:.2f} – ${1000 * r['usd_high']:.2f}",
        ]
        for r in cost_rows
    ]
    md.append(
        table(
            ["model", "input / output price", "per question (est.)", "per 1,000 questions (est.)"],
            rows,
        )
    )
    md.append(
        "\nReplace this estimate with the measured `usage` numbers from section 4 once the "
        "Claude run is available.\n"
    )

    md.append("\n## Caveats (read before quoting these numbers)\n")
    md.append(
        "- The questions were written by the developer after reading the corpus, not collected from "
        "real employees; real traffic will contain more vague and out-of-scope questions.\n"
        "- Only the abstention weights and threshold were selected strictly on the dev split. "
        "Retrieval design choices (merging label-only chunks, the glossary) were made while "
        "inspecting failures on the whole set, so test-split retrieval numbers are not a pure "
        "held-out estimate.\n"
        f"- Small n: {meta['unanswerable']} unanswerable questions, so one question moves abstention "
        f"recall by {100 / max(1, meta['unanswerable']):.1f} points.\n"
        "- Key-phrase containment and evidence overlap are automatic proxies, not human grading."
    )
    (args.out / f"eval-{date}.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md))
    print(f"\nwrote {args.out / f'eval-{date}.md'}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
