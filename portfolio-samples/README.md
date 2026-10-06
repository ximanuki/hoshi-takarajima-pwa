# ポートフォリオ用サンプル

受託開発（業務自動化・データ収集）の実績として見せるためのサンプルです。いずれもテスト付きです。

| サンプル | 内容 | 技術 |
|---|---|---|
| [gas-form-report](gas-form-report/) | 経費申請フォーム → 承認者へ通知 → 月次集計シートとメールレポート | Google Apps Script |
| [gas-invoice](gas-invoice/) | 明細シートから請求書（インボイス対応・税率別に切り捨て）をPDFで作成し、Gmailの下書きまたは送信。二重送信防止つき。販売用テンプレートとしても使える | Google Apps Script |
| [gas-inquiry-notify](gas-inquiry-notify/) | 問い合わせ・予約フォームの自動返信、Slack / Discord / Chatwork への通知、対応状況の管理と未対応リマインド、スパム判定。販売用テンプレートとしても使える | Google Apps Script |
| [scraper-books](scraper-books/) | 書籍一覧サイトを巡回して収集し、一覧と集計の Excel を出力 | Python / requests / BeautifulSoup / openpyxl |

あわせて、本リポジトリの「ほしのたからじま PWA」（オフライン対応の学習アプリ）を Webアプリの実績として使います。

> このフォルダは PWA 本体とは独立しています。公開用には専用のリポジトリへ移すのがおすすめです。
