"""Command line: ``kai download-model | ingest | ask | serve``."""

from __future__ import annotations

import argparse
import logging
import sys

from knowledge_ai.config import Settings


def _embedder(settings: Settings):
    from knowledge_ai.retrieval.embeddings import build_embedder

    return build_embedder(
        settings.embedder,
        model=settings.embedding_model,
        revision=settings.embedding_revision,
        cache_dir=settings.model_cache_dir,
        threads=settings.embedding_threads,
    )


def cmd_download_model(settings: Settings, _args: argparse.Namespace) -> int:
    emb = _embedder(settings)
    print(f"model ready: {emb.name} (cache: {settings.model_cache_dir})")
    return 0


def cmd_ingest(settings: Settings, args: argparse.Namespace) -> int:
    from knowledge_ai.ingest.pipeline import ingest_directory
    from knowledge_ai.store.sqlite import SQLiteStore

    store = SQLiteStore(settings.index_path)
    report = ingest_directory(
        settings.raw_dir,
        store,
        _embedder(settings),
        max_chars=settings.chunk_max_chars,
        force=args.force,
    )
    store.close()
    for doc_id, n in report.ingested:
        print(f"ingested {doc_id}: {n} chunks")
    for doc_id in report.skipped:
        print(f"unchanged {doc_id}")
    for doc_id in report.removed:
        print(f"removed {doc_id}")
    print(f"index: {settings.index_path} ({report.seconds:.1f}s)")
    return 0


def cmd_ask(settings: Settings, args: argparse.Namespace) -> int:
    from knowledge_ai.service import AnswerService

    service = AnswerService.from_settings(settings, provider=args.provider)
    result = service.ask(args.question, mode=args.mode)
    if args.json:
        print(result.model_dump_json(indent=2))
        return 0
    print(result.answer)
    for c in result.citations:
        page = f" p.{c.page}" if c.page else ""
        print(f"  [{c.marker}] {c.doc_title}{page} {c.heading}")
        print(f"      「{c.quote.replace(chr(10), '')}」")
    print(
        f"(provider={result.provider}, support={result.support:.3f}, abstained={result.abstained})"
    )
    return 0


def cmd_serve(settings: Settings, args: argparse.Namespace) -> int:
    import uvicorn

    uvicorn.run("knowledge_ai.api.app:create_app", factory=True, host=args.host, port=args.port)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kai", description="AI総務さん (knowledge-ai)")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("download-model", help="download the pinned embedding model")

    p = sub.add_parser("ingest", help="index documents in data/raw")
    p.add_argument("--force", action="store_true", help="rebuild the whole index")

    p = sub.add_parser("ask", help="ask a question from the command line")
    p.add_argument("question")
    p.add_argument("--provider", choices=["auto", "claude", "extractive"], default=None)
    p.add_argument("--mode", choices=["hybrid", "bm25", "dense"], default="hybrid")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("serve", help="run the API + web UI")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)

    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )
    settings = Settings.from_env()
    handler = {
        "download-model": cmd_download_model,
        "ingest": cmd_ingest,
        "ask": cmd_ask,
        "serve": cmd_serve,
    }[args.command]
    return handler(settings, args)


if __name__ == "__main__":
    sys.exit(main())
