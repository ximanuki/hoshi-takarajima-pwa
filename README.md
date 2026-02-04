# ほしのたからじま PWA

小学1〜2年生向けの、かわいい × 冒険テイストのゲーミフィケーション学習アプリです。

## 主な機能（MVP）
- 算数 / 国語の5問ミッション
- 教科ごとの適応難易度（Duolingo風の軽量ロジック）
- 復習期限つきのスキル学習（軽量SRS）
- XP・スター・バッジによる報酬
- 連続学習ストリーク
- 保護者向けの簡易ダッシュボード
- PWA対応（オフライン起動、インストール）

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
