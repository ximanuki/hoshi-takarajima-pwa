# ほしのたからじま PWA

小学1〜2年生向けの、かわいい × 冒険テイストのゲーミフィケーション学習アプリです。

## 主な機能
- 5つのしま（さんすう / こくご / くらし / ひらめき / しぜん）の5問ミッション、全1301問
- 教科ごとの適応難易度（Duolingo風の軽量ロジック）と復習期限つきスキル学習（軽量SRS）
- ゲーム要素: XP・レベル称号、スター、25種のバッジ（進捗バー付き）、しまランク、
  ミッションをまたぐコンボ、日替わりクエスト3つ＋たからばこ
- 正解の表示・はむちーのリアクション・紙吹雪・レベルアップ演出
- 読み上げ（Web Speech API）、文字サイズ拡大、ダークモード、キーボード操作（1〜3 / Enter）
- 保護者向けダッシュボード（教科別正答率・伸びしろスキル）
- PWA対応: ビルド時にプリキャッシュ一覧を生成する Service Worker でオフライン動作、PNG/maskable アイコン

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
