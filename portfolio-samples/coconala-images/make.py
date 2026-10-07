import subprocess, pathlib
D = pathlib.Path(__file__).parent
CHROME = "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"
CSS = """
@font-face{font-family:Zen;src:url(fonts/zen-500.ttf);font-weight:500}
@font-face{font-family:Zen;src:url(fonts/zen-700.ttf);font-weight:700}
@font-face{font-family:Dela;src:url(fonts/dela.ttf)}
*{box-sizing:border-box;margin:0}
html,body{width:1220px;height:1240px;overflow:hidden}
body{font-family:Zen,sans-serif;background:%(bg)s;color:#fff;position:relative}
.band{position:absolute;z-index:1;left:0;right:0;top:150px;bottom:150px;padding:0 90px;display:flex;flex-direction:column;justify-content:center;gap:40px}
.kicker{font-weight:700;font-size:40px;letter-spacing:.06em;color:%(accent)s}
h1{font-family:Dela;font-weight:400;font-size:%(h1size)spx;line-height:1.18;letter-spacing:.01em}
h1 span{color:%(accent)s}
.chips{display:flex;gap:18px;flex-wrap:wrap}
.chips div{font-weight:700;font-size:36px;background:rgba(255,255,255,.12);border:3px solid rgba(255,255,255,.35);border-radius:16px;padding:10px 26px}
.price{font-weight:700;font-size:44px}
.price b{font-family:Dela;font-weight:400;font-size:84px;color:%(accent)s;margin-right:6px}
.art{position:absolute;right:80px;top:170px;opacity:.95}
body::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.07) 2px,transparent 2px),linear-gradient(90deg,rgba(255,255,255,.07) 2px,transparent 2px);background-size:122px 62px}
.sub{font-weight:700;font-size:34px;opacity:.9}
"""
SERVICES = [
 dict(name="gas", bg="#2d3fbf", accent="#ffd34d", h1size=104,
      kicker="Google スプレッドシート × GAS",
      h1="面倒な<br>スプレッドシート<br>作業を<span>自動化</span>",
      chips=["転記・集計","メール通知","定期実行"], price="10,000"),
 dict(name="scraping", bg="#0c7a68", accent="#ffe066", h1size=104,
      kicker="Python × データ収集",
      h1="Webの情報を<br>自動で集めて<br><span>Excel</span>に",
      chips=["価格・在庫","求人・物件","定期チェック"], price="15,000"),
 dict(name="webapp", bg="#8a3a12", accent="#ffd9a8", h1size=100,
      kicker="スマホ対応 × PWA",
      h1="スマホで使える<br><span>Webアプリ</span>・<br>LPを作ります",
      chips=["ホーム画面に追加","オフライン対応","LP 1枚から"], price="30,000"),
]
for s in SERVICES:
    chips = "".join(f"<div>{c}</div>" for c in s["chips"])
    html = f"""<!doctype html><meta charset="utf-8"><style>{CSS % s}</style>
<div class="band">
  <div class="kicker">{s['kicker']}</div>
  <h1>{s['h1']}</h1>
  <div class="chips">{chips}</div>
  <div><div class="price"><b>{s['price']}</b>円〜</div><div class="sub">手順書つき・修正2回まで無料</div></div>
</div>"""
    f = D / f"{s['name']}.html"
    f.write_text(html, encoding="utf-8")
    out = D / f"coconala-{s['name']}.png"
    subprocess.run([CHROME, "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                    "--window-size=1220,1240", "--virtual-time-budget=3000",
                    f"--screenshot={out}", f.as_uri()], check=True, capture_output=True)
    print(out)
