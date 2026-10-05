# ほしのたからじま PWA

小学1〜2年生向けの、かわいい × 冒険テイストのゲーミフィケーション学習アプリです。

## 主な機能（v3.1 ゆめかわ×スイーツ）
- **ワールドマップ**: ミルクの海に浮かぶ5つのおかしの島（ドーナツ=さんすう / キャンディ=こくご / クッキー=くらし / カップケーキ=ひらめき / いちご=しぜん）。はむちーのボートが最後に遊んだ島へ移動
- **しまの みち**: 島ごとに単元（全54ステージ）が並ぶ道。各ステージは 📖まなぶ → ⚔️れんしゅう → 👑ボス
  - まなぶ: はむちーと進むカード型レッスン（めあて・説明・例題・コツ・ミニクイズ）。`src/data/lessons.ts`
  - れんしゅう: その単元の5問で星集め。★1で次のステージが開く
  - なかよしチャレンジ: 島ごとのいたずらっこに正解でハートを届け、なかよしになるとステッカーがもらえる
- 間違えた問題は最後にもう一度出題（採点は1回目のみ）。正解は下からのシートで解説
- たからばこ演出、レベルアップ、日替わりクエスト、バッジ、ステッカーを飾る「たからべや」
- もち子さん（VOICEVOX）の声で自動読み上げ（初期ON。未生成の文はブラウザの音声合成）、文字サイズ拡大、キーボード操作（1〜3 / Enter）。効果音のみ（BGMなし）
- 「おとなの へや」（3秒長押しで入室）: 学習ダッシュボードと設定
- 教科ごとの適応難易度・軽量SRS・つまずき分析による「おまかせ こうかい」
- PWA: ビルド時にプリキャッシュ一覧を生成する Service Worker でオフライン動作

## 開発
```bash
npm install
npm run dev
```

## 問題集データの編集
- 編集元: `docs/question_bank_master.md`
- 生成先: `src/data/questions.generated.ts`
- 手動生成:
```bash
npm run questions:build
```
- `npm run dev` / `npm run build` 実行時にも自動再生成されます。
- 生成時に id の重複・選択肢の重複をチェックします（`src/data/questionBank.test.ts` でも検証）。

## 画像
- はむちー: `public/assets/hamchee/*.webp`（512px）。元絵は `design/hamchee/*.png`。

## 読み上げ音声（VOICEVOX：もち子さん）
読み上げる文（問題・答え・レッスン・セリフ 約2,500文）を事前に音声ファイル化して同梱します。PCで1回実行してください。

1. [VOICEVOX](https://voicevox.hiroshiba.jp/) を起動（エンジンが `http://127.0.0.1:50021` で待ち受け）
2. `ffmpeg` をインストール
3. `npm run voice:build`（`-- --limit 20` でお試し、`-- --dry-run` で件数だけ確認）
4. `public/voice/*.mp3` と `public/voice/manifest.json` をコミット

- 話者は名前で指定します（初期値 `--character もち子さん --style ノーマル`）。声を変えるときは `--force` で作り直し
- すでにあるファイルはスキップするので、問題を追加したら再実行すればOK
- 音声がない文はブラウザの音声合成で読み上げます
- クレジット（もち子さんは「VOICEVOX:もち子(cv 明日葉よもぎ)」）は manifest に記録され、アプリ内（ホーム下部・おとなのへや）に表示されます。利用時は [VOICEVOX の利用規約](https://voicevox.hiroshiba.jp/term/) と各キャラクターの規約を守ってください

## ビルド
```bash
npm run build
npm run preview
```

## テスト
```bash
npm run test
npm run test:golden
```

## デプロイ（GitHub Pages）
- `main` へ push すると `.github/workflows/deploy.yml` で自動デプロイされます。
- GitHub の Settings > Pages で **Source = GitHub Actions** を選択してください。
- 本リポジトリ名は `hoshi-takarajima-pwa` 想定です。
