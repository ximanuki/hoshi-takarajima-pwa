# ほしのたからじま PWA

小学1〜2年生向けの、かわいい × 冒険テイストのゲーミフィケーション学習アプリです。

## 主な機能（MVP）
- 算数 / 国語の5問ミッション
- XP・スター・バッジによる報酬
- 連続学習ストリーク
- 保護者向けの簡易ダッシュボード
- PWA対応（オフライン起動、インストール）

## 開発
```bash
npm install
npm run dev
```

## ビルド
```bash
npm run build
npm run preview
```

## デプロイ（GitHub Pages）
- `main` へ push すると `.github/workflows/deploy.yml` で自動デプロイされます。
- GitHub の Settings > Pages で **Source = GitHub Actions** を選択してください。
- 本リポジトリ名は `hoshi-takarajima-pwa` 想定です。
