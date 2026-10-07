#!/usr/bin/env python3
"""Score the week-1 blind test against the revealed answers.

The solver outputs are read from ``runs/frozen/<domain>/`` and ``runs/assisted/<domain>/``
(``predictions.csv`` and ``rules.json``). The answers are read from ``blind/<domain>/revealed/``
(or from ``--answers-root DIR``, which must hold ``DIR/<domain>/truth.csv`` and ``RULES.md``).
Before anything is scored, every answer file is hashed and compared with the hashes committed in
``447a2ae`` (``blind/<domain>/SEALED.sha256``). A mismatch stops the script.

Optional: ``runs/grading/threshold0/<run>/<domain>/predictions.csv`` (the same ``rules.json``
re-applied with ``ea check --threshold 0``, i.e. without the stop rule) is scored as a diagnostic.

Standard library only. Usage::

    python3 scripts/score_blind.py                      # prints Markdown tables
    python3 scripts/score_blind.py --json reports/blind-week1.json
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEAL_COMMIT = "447a2ae"
DOMAINS = ("print", "sign")
RUNS = ("frozen", "assisted")

# ---------------------------------------------------------------------------------------------
# Mapping: generator quirk label -> solver deviation class
#   strict  = the one class of the solver's taxonomy that describes the quirk
#   lenient = classes a reviewer would also accept (strict is always included)
#   conforming quirks (priced by the rules, written correctly) are expected to be *reproduced*
# ---------------------------------------------------------------------------------------------
SOLVER_CLASSES = (
    "stale_table",
    "copied_rate",
    "undocumented_discount",
    "typo",
    "unrecorded_surcharge",
    "rounding_inconsistency",
    "revision_or_duplicate",
    "unexplained",
)
QUIRK_CLASSES = SOLVER_CLASSES[:-1]  # every class except unexplained names a human cause

MAPPING = {
    "print": {
        "stale_price_table": ("stale_table", ()),
        "stale_customer_rate": ("stale_table", ("copied_rate",)),
        "copied_customer_rate": ("copied_rate", ()),
        "undocumented_discount": ("undocumented_discount", ()),
        "unrecorded_rush": ("unrecorded_surcharge", ()),
        "rounding_inconsistency": ("rounding_inconsistency", ()),
        "omitted_delivery_fee": ("undocumented_discount", ("unexplained",)),
        "tax_label_error": ("unexplained", ()),
        "quantity_entry_error": ("typo", ("unexplained",)),
        "digit_typo": ("typo", ()),
        "duplicate_entry": ("revision_or_duplicate", ()),
        "superseded_by_revision": ("revision_or_duplicate", ()),
        "negotiated_revision": ("revision_or_duplicate", ("undocumented_discount",)),
        "unreconcilable": ("unexplained", ()),
    },
    "sign": {
        "stale_table": ("stale_table", ("copied_rate",)),
        "multiplier_copy": ("copied_rate", ()),
        "manager_discount": ("undocumented_discount", ()),
        "rush_unrecorded": ("unrecorded_surcharge", ()),
        "rounding_inconsistent": ("rounding_inconsistency", ()),
        "travel_omitted": ("undocumented_discount", ("unexplained",)),
        "tax_label_error": ("unexplained", ()),
        "digit_typo": ("typo", ()),
        "revision_v1": ("revision_or_duplicate", ("undocumented_discount",)),
        "revision_v2": ("revision_or_duplicate", ("undocumented_discount",)),
        "duplicate": ("revision_or_duplicate", ()),
        "impossible": ("unexplained", ()),
    },
}

SIGN_ITEMS = {"ACM": "アルミ複合板看板", "IJ": "インクジェット出力", "CALP": "カルプ文字", "SODE": "袖看板"}

# ---------------------------------------------------------------------------------------------
# Rule recovery, judged by the grader from rules.json / rules_ja.md of each run (see report).
#   exact     = same amounts as the hidden rule wherever it applies (trigger, form, value)
#   approx    = right trigger / key / boundary, but value or form differs
#   missed    = no corresponding element, or the element does not correspond to the rule
#   flagged   = the solver marked the value as not identifiable (要聞き取り) and the truth lies
#               inside the stated range (correctly withheld)
#   na        = does not apply to this run
# Evidence strings point at the element in rules.json that the verdict rests on.
# ---------------------------------------------------------------------------------------------
RECOVERY = {
    "print": [
        (
            "単価表の改定日 2023-04-01 / 2024-07-01 / 2025-04-01",
            "missed",
            "exact",
            "frozen: meta.revisions 空、版つきの表なし。assisted: 分析者が残差から読んだ3つの日付（3つとも正確）を price_period 列として拡張で投入し、エンジンが18項で使用。エンジン単独では見つけていない",
        ),
        (
            "改定の中身（用紙×1.15・×1.08、版代・通し・最低料金・端数単位などの改定、2025-04 は名刺と封筒だけ）",
            "missed",
            "approx",
            "assisted: price_period ごとの差額を区分ごとに当てはめたもので、単価表の改定としては読めない",
        ),
        (
            "製法の切替（1種類あたり1,000枚以上はオフセット。冊子は300部以上）",
            "approx",
            "missed",
            "frozen: チラシ『total_qty≥1000 で版数×種類×5,000』（境界は総数で近似、版代2,500＋通し2,000に近い値）。assisted: 該当する境界なし",
        ),
        (
            "オフセットの積算（版代・通し・用紙250枚単位・断裁）",
            "missed",
            "missed",
            "assisted は分析者の sheets（全判換算の通し）を候補にしたが、係数は打ち消し合う値で積算にならない",
        ),
        ("オンデマンドの積算（クリックの段階、データ処理料、前回同様で免除）", "missed", "missed", "対応する項なし"),
        ("折り加工（二つ折／三つ折・Z折）", "missed", "missed", "assisted は語を候補にしたが採用されず"),
        (
            "片面PP（チラシ：3,000円＋A4換算単価）",
            "approx",
            "missed",
            "frozen: 片面PP で ×1.1 の掛率（語は正しく、形が違う）。assisted: チラシには項なし",
        ),
        (
            "冊子の積算・製本（台数、製本の段取り＋部数単価）",
            "missed",
            "missed",
            "pages・quantity の表は ±百万円規模の打ち消し合い",
        ),
        (
            "封筒（箱単位の用紙、版・通し、角2は×1.5）",
            "approx",
            "missed",
            "frozen: 『1,000枚ごとの箱数×用紙別単価』（白ケント80g 5,000、クラフト85g 11,500 など。真値は長3/洋長3 1,000枚箱、角2 500枚箱、改定あり）。assisted: 箱の構造なし",
        ),
        (
            "名刺の基本（1箱目＋追加箱、色数別）",
            "missed",
            "missed",
            "frozen: 人数×数量別の表（100枚 2,300 …）と色数別の枚数単価で、正常見積の±1%一致は1割台。assisted: kinds と persons_eff に ±40万円の打ち消し合う係数",
        ),
        (
            "名刺の人数段階（6〜10人目90%、11人目〜80%）",
            "missed",
            "approx",
            "assisted: 分析者の persons_eff（min(k,5)+0.9×…+0.8×…）は正確な式だが、エンジンは kinds と打ち消し合う係数で使い、6人以上の正常見積85件のうち円単位の一致は8件（frozen は12件）。frozen: なし",
        ),
        (
            "名刺の片面PP（1箱あたり+600円）",
            "missed",
            "exact",
            "assisted: 片面PP で persons_eff×枚数×6円（=100枚あたり600円、掛率の対象）",
        ),
        ("名刺の特殊紙（1箱あたり+300円）", "missed", "missed", "用紙別の表は打ち消し合う大きな値"),
        (
            "名刺の角丸（1人あたり+500円）",
            "missed",
            "missed",
            "assisted: 角丸で max(人数,7)×200＋版数×人数×100。値も形も違う",
        ),
        (
            "名刺の新規デザイン（3,000円＋500円×(人数−1)）",
            "approx",
            "approx",
            "frozen: 『新規』で一律3,000円（掛率対象外）＝1人の場合だけ一致。assisted: 1,000円×掛率＋2,000円×persons_eff",
        ),
        (
            "名刺の修正料 1,000円（『修正なし』『肩書変更あり』は対象外）",
            "missed",
            "exact",
            "assisted: 分析者のタグ #fix（データ修正/文字修正/修正あり）で 1,000円、掛率の対象外",
        ),
        (
            "名刺以外の修正料 3,000円→2024-07以降3,500円",
            "missed",
            "approx",
            "assisted: #fix でチラシ 3,500円×種類数、リーフレット 6,000円×種類数−1.3円×枚数、冊子はページ数比例。改定なし",
        ),
        (
            "特色・DIC（オフセットと封筒で4,000円）",
            "approx",
            "approx",
            "frozen: 封筒だけ『DIC』で4,000円×種類数。assisted: #spot（DIC/特色）で ×1.2 の掛率",
        ),
        ("色校（オフセット8,000円、オンデマンド1,500円）", "missed", "missed", "対応する項なし"),
        (
            "帯掛（1,000部ごとに400円）",
            "missed",
            "approx",
            "assisted: 分析者の bundles（『N枚ごと』の束数）×360円。語は正しく、単位が違う",
        ),
        (
            "特急（『特急』のみ、最低料金後の+25%）",
            "approx",
            "exact",
            "frozen: 『特急』で ×1.2。assisted: #rush（特急のみ）で ×1.25",
        ),
        (
            "得意先ごとの掛率（0.75〜1.10）",
            "missed",
            "missed",
            "掛率が1.0でない30得意先のうち一致は frozen 6（G区分0.90の5校と C019）、assisted 2（C036、G07）。frozen は D区分を1.10（真値0.75〜0.85）、K区分を0.80（真値1.00）とした",
        ),
        ("掛率の変更（C003 2024-01-01、D02 2024-07-01）", "missed", "missed", "掛率表に版なし"),
        (
            "掛率は加工・配送などの加算に掛からない",
            "approx",
            "approx",
            "一部の項は『掛率の後に加算』だが、どの項かは真の構造と対応しない",
        ),
        (
            "最低料金 5,000円→2024-07以降5,500円（名刺を除く。掛率の後）",
            "missed",
            "approx",
            "チラシで68件発動。frozen: 全区分『要聞き取り（発動例なし）』で、チラシの上限5,530円は真値を含むが『発動例なし』は誤り。assisted: チラシ5,000円（P0〜P1は正確、5,500円への改定なし）",
        ),
        (
            "名刺には最低料金がない",
            "flagged",
            "flagged",
            "両方とも『要聞き取り（発動例なし）』で、真値（なし）と矛盾しない（assisted の上限は負の値で、自分の誤った予測から計算されている）",
        ),
        (
            "封筒の最低料金 5,000→5,500円（履歴では発動しない）",
            "flagged",
            "missed",
            "frozen: 上限6,900円で真値を含む。assisted: 上限5,180円で、2024-07以降の5,500円を含まない",
        ),
        (
            "リーフレット・冊子の最低料金（履歴では発動しない）",
            "missed",
            "missed",
            "上限が負の値（自分の誤った予測から計算）で、真値と矛盾",
        ),
        (
            "配送料（市内800円・小計1万円以上無料、市外1,500円・3万円以上無料、引取0円）",
            "missed",
            "missed",
            "配送区分の定数と係数はあるが無料になる境界がない（assisted の分析メモは境界に気づいたが、文法で表せない）",
        ),
        ("県外の重量制（1kg以下はメール便、超えると15kgごとの箱）", "missed", "missed", "対応する項なし"),
        (
            "端数処理（10円未満切り捨て→2024-07以降100円未満切り捨て）",
            "approx",
            "approx",
            "両方『10円未満四捨五入』。単位は前半だけ正しく、方式（切り捨て）と100円への変更が違う",
        ),
        (
            "高橋の癖（1万円以上は500円未満切り捨て）",
            "approx",
            "approx",
            "両方『高橋は500円未満四捨五入』。単位は正しく、方式と1万円の条件が違う",
        ),
        (
            "税表示（インボイス前、空欄は C/D=税抜・G/K/一般=税込）",
            "missed",
            "approx",
            "frozen: 規則はなく、見積ごとに整合する読みを選ぶ。空欄の正常見積371件のうち128件を誤読。assisted: 分析者の式で C/D=税抜・K/一般=税込（G は未指定）、誤読3件（すべて G）",
        ),
    ],
    "sign": [
        (
            "改定日 2023-05-01 / 2024-04-01 / 2025-07-01",
            "missed",
            "missed",
            "両方とも meta.revisions 空、版つきの表なし",
        ),
        ("改定の猶予（常連・1023・1041 は 2024-05-31 まで旧表）", "missed", "missed", "対応する項なし"),
        (
            "得意先区分の掛率（常連0.95、同業0.80、1023 0.88→0.85、1041 0.90）",
            "missed",
            "missed",
            "frozen: 得意先の掛率なし。assisted: 1015 ×1.2、1019 ×1.32、1048 ×1.1（真値は1.0、0.8、1.0）",
        ),
        ("掛率は製品小計だけに掛かる", "missed", "missed", "掛率がないため該当なし"),
        ("1077 は出張費なし", "missed", "missed", "対応する項なし"),
        (
            "アルミ複合板の材料（3×6／4×8 の板取り、超える場合は継ぎ）",
            "missed",
            "approx",
            "assisted: 分析者の board36／board48／board_over をエンジンが採用。単価 6,200／11,000（真値 5,200→6,400／9,800→12,000、改定なし）、継ぎは 30,000×枚数",
        ),
        (
            "アルミ複合板の出力（0.1m²切り上げ・最低0.3m²、面数、10m²/30m²の数量割引）",
            "missed",
            "missed",
            "assisted: ceil(面積,0.1)×13,000 と 面積×(−12,000) の打ち消し合い。面数は片面/両面で符号の違う面積単価",
        ),
        ("加工費（1枚あたり1,200→1,500円、角R+400、穴あけ+300）", "missed", "missed", "対応する項なし"),
        (
            "セットアップ（アルミ・IJ 2,000円、カルプ 3,000→3,500円。リピートで免除）",
            "missed",
            "approx",
            "assisted: アルミの固定 2,000円は正しいが、リピート免除（『前回』のフラグは作られたが未使用）なし",
        ),
        ("インクジェットのロール幅課金（短辺900mm超は1.37m幅×長さ）", "missed", "missed", "対応する項なし"),
        (
            "インクジェットのメディア単価・ラミネート・20/50m²の数量割引",
            "missed",
            "missed",
            "frozen: メディア別はターポリンだけ、値は無関係。assisted: 面積単価なし",
        ),
        ("ハトメ（ターポリン、500mmごと）", "missed", "missed", "assisted: 分析者の eyelets を候補にしたが採用されず"),
        (
            "カルプ文字（文字高の段階、厚み・仕上げの係数、10円切り上げ）",
            "missed",
            "missed",
            "frozen: 文字高×文字数（100mm単位）×1,000円＋固定230,000−施工200,000 など。assisted: 厚み30mmだけ文字高×文字数×10円",
        ),
        ("カルプ文字の21文字目以降15%引き", "missed", "missed", "対応する項なし"),
        (
            "袖看板（サイズ区分の表、大型は0.5m²ごと、LED内照）",
            "missed",
            "missed",
            "frozen: 面積の連続式と『最低料金165,000円』（真の区分表にない値）。assisted: 面積値ごとの表（打ち消し合い）",
        ),
        (
            "製品の最低料金 5,000円→2024-04以降6,000円",
            "approx",
            "approx",
            "履歴で発動するのはインクジェットだけ（168件、うち95件が6,000円）。両方ともインクジェット6,000円（改定前の5,000円なし）",
        ),
        (
            "カルプ文字・袖看板の最低料金（履歴では発動しない）",
            "missed",
            "flagged",
            "frozen: カルプの上限は負の値、袖看板は最低料金165,000円と断定（真の表にない値）。assisted: カルプ ≤10,000円・袖看板 ≤75,000円で、真値を含む",
        ),
        (
            "アルミ複合板の最低料金（履歴では発動しない）",
            "missed",
            "missed",
            "上限が負の値（自分の誤った予測から計算）",
        ),
        (
            "特急・至急（製品額の30%、最低3,000円）",
            "approx",
            "approx",
            "frozen: 『至急』だけ ×1.4（『特急』のフラグは未使用）。assisted: 分析者の rush（特急/至急）で ×1.3。最低3,000円と『製品額だけ』の範囲はなし",
        ),
        (
            "デザイン料（修正3,000円、新規は品目別 10,000/6,000/8,000/15,000）",
            "approx",
            "approx",
            "design 列で項は立つが値が違う（例: frozen IJ 修正8,000・新規10,000、assisted アルミ 新規10,000（正しい）＋面積比例の項）",
        ),
        (
            "施工費（品目別の基本、最低12,000→15,000円）",
            "missed",
            "missed",
            "installed／install_qty の定数は真の式と対応しない",
        ),
        ("夜間（施工費の50%増）", "missed", "approx", "assisted: 分析者の night で ×1.3（全体に掛かる）"),
        (
            "高所（2m／4m／9m の段階）",
            "approx",
            "approx",
            "frozen: 4.5m以上（=4m超）でアルミ+20,000・袖+10,000、カルプは3.5m以上。assisted: アルミ 2.2m以上（=2m超）+10,000（2024-04以降の値と一致）、4.5m以上でさらに+30,000、カルプ4m以上。9m超の段階はなし",
        ),
        ("電気工事（LED袖看板の施工で18,000→22,000円）", "missed", "missed", "対応する項なし"),
        (
            "撤去15,000→18,000円・処分5,000円（『撤去は別途』『処分不要』は除外）",
            "missed",
            "approx",
            "frozen: 撤去・処分のフラグは作られたが未使用。assisted: 分析者の removal でアルミ+10,000・IJ+20,000、処分は未使用",
        ),
        (
            "現地調査 5,000→6,000円（＋出張費）",
            "missed",
            "missed",
            "assisted: 『現地調査』と survey のフラグは作られたが未使用",
        ),
        (
            "出張費（現場までの距離帯、施工または現調のとき）",
            "missed",
            "missed",
            "frozen: 市町村別の定数（袋井市 690,000 など）。assisted: 町名の語に ×0.7〜×1.4 の掛率など",
        ),
        (
            "担当者別の端数処理（田中 3万円以上は1,000円切り捨て、渡辺 100円四捨五入、高橋 2024-06まで10円）",
            "approx",
            "approx",
            "frozen: 100円四捨五入・高橋10円四捨五入。assisted: 100円切り捨て・高橋10円切り捨て（佐藤・鈴木・田中の3万円未満と高橋の前半は正しい）。田中の1,000円・渡辺の四捨五入・高橋の切替はなし",
        ),
        (
            "税込見積（インボイス前は税込額を100円未満切り捨て）",
            "missed",
            "missed",
            "対応する処理なし（assisted の分析メモは指摘）。インボイス前の税込の正常見積129件のうち78件で税抜額を読み違える",
        ),
        (
            "税表示の空欄（渡辺など。空欄はすべて税抜）",
            "missed",
            "missed",
            "規則はなく見積ごとに読みを選ぶ。空欄の正常見積185件のうち frozen 96件、assisted 84件を税込と誤読",
        ),
    ],
}

VERDICT_JA = {"exact": "正確", "approx": "近似", "missed": "未復元", "flagged": "保留（正しい）", "na": "—"}


# ---------------------------------------------------------------------------------------------
def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True, check=True).stdout


def integrity(answers: dict[str, Path]) -> dict:
    prefix = git("rev-parse", "--show-prefix").strip()
    out: dict = {"commit": git("log", "-1", "--format=%H %cI %s", SEAL_COMMIT).strip(), "domains": {}}
    for d, adir in answers.items():
        committed = git("show", f"{SEAL_COMMIT}:{prefix}blind/{d}/SEALED.sha256")
        rows = []
        for line in committed.splitlines():
            if not line.strip() or line.startswith("#"):
                continue
            want, name = line.split()
            got = sha256(adir / name) if (adir / name).exists() else "(missing)"
            rows.append({"file": name, "committed": want, "now": got, "ok": want == got})
        out["domains"][d] = {"dir": str(adir), "files": rows, "ok": all(r["ok"] for r in rows)}
    log = git("log", "--format=%h %cI %s", "--", ".").strip().splitlines()
    out["history_of_folder"] = log
    out["solver_files_tracked"] = [
        f for f in git("ls-files", "src", "configs", "assist", "extensions", "tests").split("\n") if f
    ]
    first_mtime = min(p.stat().st_mtime for p in (ROOT / "src").rglob("*.py"))
    out["solver_first_file_mtime_utc"] = _utc(first_mtime)
    out["ok"] = all(v["ok"] for v in out["domains"].values())
    return out


def _utc(ts: float) -> str:
    import datetime as _dt

    return _dt.datetime.fromtimestamp(ts, _dt.UTC).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------------------------
def _int(x: str) -> int | None:
    x = (x or "").strip()
    if not x:
        return None
    try:
        return round(float(x))
    except ValueError:
        return None


def load_truth(d: str, adir: Path) -> list[dict]:
    rows = []
    with open(adir / "truth.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if d == "print":
                written_ok = r["written_net"] == r["rule_net"]
                seg = r["product"]
                date = r["quote_date"]
                rate = float(r["rate_applied"])
            else:
                written_ok = _sign_written_ok(r)
                seg = SIGN_ITEMS.get(r["item"], r["item"])
                date = r["issue_date"]
                rate = int(r["rule_mult"]) / 1000
            rows.append(
                {
                    "id": r["quote_id"],
                    "quirk": r["quirk"],
                    "detail": r["quirk_detail"],
                    "rule_net": int(r["rule_net"]),
                    "true_net": int(r["true_net"]),
                    "seg": seg,
                    "date": date,
                    "customer": r["customer_code"],
                    "rep": r["rep"],
                    "rate": rate,
                    "clean": r["quirk"] == "clean",
                    "conforming": written_ok,  # the written amount is what the rules give
                }
            )
    return rows


def _sign_written_ok(r: dict) -> bool:
    w = _int(r["written_amount"])
    n = int(r["rule_net"])
    if r["tax_basis"] == "excl":
        exp = n
    elif r["issue_date"] < "2023-10-01":
        exp = (n * 11 // 10) // 100 * 100
    else:
        exp = n + n // 10
    return w == exp


def load_pred(path: Path) -> dict[str, dict]:
    out = {}
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            p = _int(r["predicted_net"])
            o = _int(r["observed_net"])
            out[r["quote_id"]] = {
                "status": r["status"],
                "class": r["class"],
                "pred": p if p is not None and p >= 0 else None,
                "obs": o if o is not None and o >= 0 else None,
                "evidence": r["evidence"],
            }
    return out


# ---------------------------------------------------------------------------------------------
def _close(p: int | None, t: int, kind: str) -> bool:
    if p is None:
        return False
    if kind == "exact":
        return p == t
    if kind == "100":
        return abs(p - t) <= 100
    return abs(p - t) <= 0.01 * abs(t)


def _rate(num: int, den: int) -> float | None:
    return num / den if den else None


def score(d: str, truth: list[dict], pred: dict[str, dict]) -> dict:
    res: dict = {"n": len(truth), "n_clean": sum(t["clean"] for t in truth)}
    missing = [t["id"] for t in truth if t["id"] not in pred]
    res["missing_predictions"] = len(missing)
    P = lambda t: pred.get(t["id"], {"status": "missing", "class": "", "pred": None, "obs": None, "evidence": ""})  # noqa: E731

    # (a) accuracy of predicted_net
    acc = {}
    for target in ("rule_net", "true_net"):
        for subset, rows in (("all", truth), ("clean", [t for t in truth if t["clean"]])):
            acc[f"{target}/{subset}"] = {
                k: sum(_close(P(t)["pred"], t[target], k) for t in rows) for k in ("exact", "100", "1pct")
            } | {"n": len(rows)}
    res["accuracy"] = acc
    seg = {}
    for s in sorted({t["seg"] for t in truth}):
        rows = [t for t in truth if t["clean"] and t["seg"] == s]
        seg[s] = {
            "n": len(rows),
            "exact": sum(_close(P(t)["pred"], t["rule_net"], "exact") for t in rows),
            "1pct": sum(_close(P(t)["pred"], t["rule_net"], "1pct") for t in rows),
            "10pct": sum(
                P(t)["pred"] is not None and abs(P(t)["pred"] - t["rule_net"]) <= 0.1 * t["rule_net"] for t in rows
            ),
        }
    res["by_segment_clean"] = seg

    # statuses
    res["status"] = dict(Counter(P(t)["status"] for t in truth))
    rep = [t for t in truth if P(t)["status"] == "reproduced"]
    res["reproduced"] = {
        "n": len(rep),
        "clean": sum(t["clean"] for t in rep),
        "nonclean_conforming": sum((not t["clean"]) and t["conforming"] for t in rep),
        "nonclean_deviating": sum((not t["clean"]) and not t["conforming"] for t in rep),
        "pred_equals_rule_net": sum(P(t)["pred"] == t["rule_net"] for t in rep),
        "examples_absorbed": [
            (t["id"], t["quirk"], t["detail"][:60], P(t)["pred"], t["rule_net"])
            for t in rep
            if (not t["clean"]) and not t["conforming"]
        ][:8],
    }

    # (b) detection
    flagged = lambda t: P(t)["status"] in ("deviation", "unexplained")  # noqa: E731
    det = {}
    for name, pos in (
        ("nonclean_all", lambda t: not t["clean"]),
        ("nonclean_deviating", lambda t: not t["conforming"]),
    ):
        tp = sum(flagged(t) and pos(t) for t in truth)
        fp = sum(flagged(t) and not pos(t) for t in truth)
        fn = sum((not flagged(t)) and pos(t) for t in truth)
        det[name] = {
            "positives": tp + fn,
            "flagged": tp + fp,
            "tp": tp,
            "fp": fp,
            "fn": fn,
            "precision": _rate(tp, tp + fp),
            "recall": _rate(tp, tp + fn),
        }
    res["detection"] = det

    # (c) class accuracy among flagged true deviations
    m = MAPPING[d]
    flagged_true = [t for t in truth if flagged(t) and not t["clean"]]
    strict = 0
    lenient = 0
    confusion: Counter = Counter()
    for t in flagged_true:
        c = P(t)["class"] or ("unexplained" if P(t)["status"] == "unexplained" else "")
        s, extra = m[t["quirk"]]
        confusion[(t["quirk"], c)] += 1
        strict += c == s
        lenient += c == s or c in extra
    dev_only = [t for t in flagged_true if P(t)["status"] == "deviation"]
    res["class_accuracy"] = {
        "flagged_true": len(flagged_true),
        "strict": strict,
        "lenient": lenient,
        "deviation_only_n": len(dev_only),
        "deviation_only_strict": sum((P(t)["class"] == m[t["quirk"]][0]) for t in dev_only),
        "confusion": {f"{q} -> {c}": n for (q, c), n in sorted(confusion.items(), key=lambda kv: -kv[1])},
    }

    # (d) false accusations
    fa = [t for t in truth if t["clean"] and P(t)["status"] == "deviation" and P(t)["class"] in QUIRK_CLASSES]
    res["false_accusations"] = {
        "n": len(fa),
        "by_class": dict(Counter(P(t)["class"] for t in fa)),
        "clean_unexplained": sum(t["clean"] and P(t)["status"] == "unexplained" for t in truth),
        "examples": [
            (t["id"], t["seg"], P(t)["class"], P(t)["pred"], t["rule_net"], P(t)["evidence"][:70]) for t in fa
        ][:8],
    }

    # (e) abstentions
    ab = [t for t in truth if P(t)["status"] == "abstained"]
    res["abstentions"] = {
        "n": len(ab),
        "clean": sum(t["clean"] for t in ab),
        "nonclean": sum(not t["clean"] for t in ab),
        "reasons": dict(Counter(re.sub(r"[0-9,.%]+", "#", P(t)["evidence"])[:40] for t in ab).most_common(6)),
    }

    # reading of the written amount (tax label) on clean quotes
    cl = [t for t in truth if t["clean"]]
    res["reading_clean"] = {"n": len(cl), "obs_equals_true_net": sum(P(t)["obs"] == t["true_net"] for t in cl)}
    return res


# ---------------------------------------------------------------------------------------------
def customer_class(d: str, code: str) -> str:
    if d == "print":
        m = re.match(r"^(一般|[A-Za-z]+)", code)
        return m.group(1) if m else "その他"
    return "諸口" if code == "9999" else "口座"


def rule_checks(d: str, truth: list[dict], rules_path: Path) -> dict:
    p = json.loads(rules_path.read_text(encoding="utf-8"))
    cust = next((m for m in p["multipliers"] if m["role"] == "customer_rate"), None)

    def eff(code: str) -> float:
        if cust is None:
            return 1.0
        if code in cust["table"]:
            return float(cust["table"][code])
        fb = cust.get("fallback_table") or {}
        cc = customer_class(d, code)
        if cc in fb:
            return float(fb[cc])
        return float(cust.get("default", 1.0))

    true_rate: dict[str, Counter] = {}
    for t in truth:
        if t["clean"]:
            true_rate.setdefault(t["customer"], Counter())[round(t["rate"], 4)] += 1
    rows = []
    for code, cnt in sorted(true_rate.items()):
        tr = cnt.most_common(1)[0][0]
        rows.append(
            {
                "customer": code,
                "true": tr,
                "true_all": sorted(cnt),
                "solver": eff(code),
                "ok": abs(eff(code) - tr) < 1e-9,
            }
        )
    non1 = [r for r in rows if abs(r["true"] - 1.0) > 1e-9]
    one = [r for r in rows if abs(r["true"] - 1.0) <= 1e-9]
    versions = sorted({str(v) for t in p["terms"] for v in (t.get("versions") or [])})
    derived = (p["meta"].get("config") or {}).get("derived") or {}
    period_dates = sorted({x for v in derived.values() for x in re.findall(r"date\('(\d{4}-\d{2}-\d{2})'\)", v)})
    return {
        "customer_rates": {
            "customers": len(rows),
            "ok": sum(r["ok"] for r in rows),
            "true_not_1": len(non1),
            "true_not_1_ok": sum(r["ok"] for r in non1),
            "true_1": len(one),
            "true_1_ok": sum(r["ok"] for r in one),
            "mismatch_examples": [(r["customer"], r["true"], r["solver"]) for r in rows if not r["ok"]][:12],
        },
        "rounding": p["rounding"],
        "min_charge": {
            k: v.get("value")
            if v.get("value") is not None
            else f"要聞き取り ≤{v.get('consistent_range', [None, None])[1]}"
            for k, v in p["min_charge"].items()
        },
        "multipliers": {m["id"]: m["table"] for m in p["multipliers"] if m["role"] != "customer_rate"},
        "revisions_engine": p["meta"].get("revisions") or [],
        "term_versions": versions,
        "dates_in_extension_columns": period_dates,
        "n_terms": len(p["terms"]),
        "n_params": sum(len(t["table"]) for t in p["terms"]),
        "extensions": [e["file"] for e in p["meta"].get("extensions") or []],
    }


# ---------------------------------------------------------------------------------------------
def pct(a: int, b: int) -> str:
    return f"{100 * a / b:.1f}%" if b else "—"


def fmt_rate(x: float | None) -> str:
    return "—（判定なし）" if x is None else f"{100 * x:.1f}%"


def markdown(report: dict) -> str:
    L: list[str] = []
    w = L.append
    w("## Integrity\n")
    w(f"- seal commit: {report['integrity']['commit']}")
    for d, v in report["integrity"]["domains"].items():
        w(f"- {d}: " + ", ".join(f"{r['file']} {'OK' if r['ok'] else 'MISMATCH'}" for r in v["files"]))
    w(
        f"- solver files tracked in git: {len(report['integrity']['solver_files_tracked'])}; first solver file mtime {report['integrity']['solver_first_file_mtime_utc']}\n"
    )
    for kind in ("official", "threshold0"):
        if kind not in report:
            continue
        w(f"## {kind}\n")
        w(
            "| domain | run | n | 1円一致(rule) | ±100(rule) | ±1%(rule) | 1円一致(true) | ±1%(true) | 正常: 1円 | 正常: ±100 | 正常: ±1% | flagged | 検出 P/R（全非正常） | 検出 P/R（金額の外れ） | 分類 strict/lenient | 誤告発 | 判定保留 |"
        )
        w("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for d in DOMAINS:
            for run in RUNS:
                r = report[kind].get(d, {}).get(run)
                if not r:
                    continue
                a = r["accuracy"]
                n = r["n"]
                nc = r["n_clean"]
                de = r["detection"]
                ca = r["class_accuracy"]
                w(
                    f"| {d} | {run} | {n} | {a['rule_net/all']['exact']} ({pct(a['rule_net/all']['exact'], n)}) | {pct(a['rule_net/all']['100'], n)} | {pct(a['rule_net/all']['1pct'], n)} "
                    f"| {a['true_net/all']['exact']} ({pct(a['true_net/all']['exact'], n)}) | {pct(a['true_net/all']['1pct'], n)} "
                    f"| {a['rule_net/clean']['exact']} ({pct(a['rule_net/clean']['exact'], nc)}) | {pct(a['rule_net/clean']['100'], nc)} | {pct(a['rule_net/clean']['1pct'], nc)} "
                    f"| {de['nonclean_all']['flagged']} | {fmt_rate(de['nonclean_all']['precision'])} / {fmt_rate(de['nonclean_all']['recall'])} "
                    f"| {fmt_rate(de['nonclean_deviating']['precision'])} / {fmt_rate(de['nonclean_deviating']['recall'])} "
                    f"| {ca['strict']}/{ca['lenient']} of {ca['flagged_true']} | {r['false_accusations']['n']} | {r['abstentions']['n']} (clean {r['abstentions']['clean']}) |"
                )
        w("")
    w("## Clean quotes by segment (predicted == rule_net / within ±1% / within ±10%)\n")
    w("| domain | segment | n | frozen 1円 | frozen ±1% | frozen ±10% | assisted 1円 | assisted ±1% | assisted ±10% |")
    w("|---|---|---|---|---|---|---|---|---|")
    for d in DOMAINS:
        segs = report["official"][d]["frozen"]["by_segment_clean"]
        for s, v in segs.items():
            a2 = report["official"][d]["assisted"]["by_segment_clean"][s]
            w(
                f"| {d} | {s} | {v['n']} | {pct(v['exact'], v['n'])} | {pct(v['1pct'], v['n'])} | {pct(v['10pct'], v['n'])} "
                f"| {pct(a2['exact'], v['n'])} | {pct(a2['1pct'], v['n'])} | {pct(a2['10pct'], v['n'])} |"
            )
    w("")
    w("## Rule recovery\n")
    for d in DOMAINS:
        cnt = {run: Counter(v[1 if run == "frozen" else 2] for v in RECOVERY[d]) for run in RUNS}
        w(
            f"- {d}: {len(RECOVERY[d])} rules; "
            + "; ".join(
                f"{run}: "
                + ", ".join(f"{VERDICT_JA[k]} {cnt[run].get(k, 0)}" for k in ("exact", "approx", "missed", "flagged"))
                for run in RUNS
            )
        )
    for d in DOMAINS:
        w(f"\n### {d}\n")
        w("| 隠れたルール | frozen | assisted | 根拠 |")
        w("|---|---|---|---|")
        for r, f, s, e in RECOVERY[d]:
            w(f"| {r} | {VERDICT_JA[f]} | {VERDICT_JA[s]} | {e} |")
    w("\n## Scored files (sha256)\n")
    for k, v in report["scored_files"].items():
        w(f"- `{k}` {v['sha256'][:16]}… (mtime {v['mtime_utc']})")
    return "\n".join(L)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--answers-root", help="folder with <domain>/truth.csv (default: blind/<domain>/revealed)")
    ap.add_argument("--json", help="write the full results as JSON here")
    a = ap.parse_args(argv)

    answers = {d: (Path(a.answers_root) / d if a.answers_root else ROOT / "blind" / d / "revealed") for d in DOMAINS}
    integ = integrity(answers)
    if not integ["ok"]:
        print(json.dumps(integ, ensure_ascii=False, indent=2))
        print(
            "INTEGRITY CHECK FAILED: answer files do not match the hashes committed in " + SEAL_COMMIT, file=sys.stderr
        )
        return 1

    report: dict = {
        "integrity": integ,
        "mapping": MAPPING,
        "official": {},
        "rule_checks": {},
        "recovery": {},
        "scored_files": {},
    }
    for d in DOMAINS:
        for run in RUNS:
            for name in ("predictions.csv", "rules.json"):
                f = ROOT / "runs" / run / d / name
                report["scored_files"][str(f.relative_to(ROOT))] = {
                    "sha256": sha256(f),
                    "mtime_utc": _utc(f.stat().st_mtime),
                }
    for d in DOMAINS:
        truth = load_truth(d, answers[d])
        report["truth_summary"] = report.get("truth_summary", {}) | {
            d: {
                "n": len(truth),
                "clean": sum(t["clean"] for t in truth),
                "nonclean": sum(not t["clean"] for t in truth),
                "nonclean_conforming": sum((not t["clean"]) and t["conforming"] for t in truth),
                "quirks": dict(Counter(t["quirk"] for t in truth)),
            }
        }
        report["official"][d] = {}
        report["rule_checks"][d] = {}
        for run in RUNS:
            pred = load_pred(ROOT / "runs" / run / d / "predictions.csv")
            report["official"][d][run] = score(d, truth, pred)
            report["rule_checks"][d][run] = rule_checks(d, truth, ROOT / "runs" / run / d / "rules.json")
            diag = ROOT / "runs" / "grading" / "threshold0" / run / d / "predictions.csv"
            if diag.exists():
                report.setdefault("threshold0", {}).setdefault(d, {})[run] = score(d, truth, load_pred(diag))
        report["recovery"][d] = [{"rule": r, "frozen": f, "assisted": s, "evidence": e} for (r, f, s, e) in RECOVERY[d]]
    print(markdown(report))
    if a.json:
        Path(a.json).write_text(json.dumps(report, ensure_ascii=False, indent=1, default=str) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
