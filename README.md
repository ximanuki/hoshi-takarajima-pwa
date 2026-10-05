# ほしのたからじま PWA

小学1〜2年生向けの、かわいい × 冒険テイストのゲーミフィケーション学習アプリです。

## 主な機能（v3）
- **ワールドマップ**: よぞらの海に浮かぶ5つの島（さんすう / ことば / くらし / ひらめき / しぜん）。はむちーの船が最後に遊んだ島へ移動
- **しまの みち**: 島ごとに単元（全54ステージ）が並ぶ道。各ステージは 📖まなぶ → ⚔️れんしゅう → 👑ボス
  - まなぶ: はむちーと進むカード型レッスン（めあて・説明・例題・コツ・ミニクイズ）。`src/data/lessons.ts`
  - れんしゅう: その単元の5問で星集め。★1で次のステージが開く
  - ボス: 島ごとのボスとHPバトル。倒すとステッカーがもらえる
- 間違えた問題は最後にもう一度出題（採点は1回目のみ）。正解は下からのシートで解説
- たからばこ演出、レベルアップ、日替わりクエスト、バッジ、ステッカーを飾る「たからべや」
- 自動読み上げ（初期ON）、文字サイズ拡大、キーボード操作（1〜3 / Enter）。効果音のみ（BGMなし）
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
