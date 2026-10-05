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
読み上げる文（問題・答え・レッスン・セリフ 約2,500文）を事前に音声ファイル化して同梱します。

### GitHub Actions で作る（おすすめ）
- GitHub の **Actions** タブ →「Generate read-aloud voice (VOICEVOX)」→ **Run workflow**
  - キャラクター名・スタイル名・全部作り直す（force）・お試し件数（limit）を指定可能
- 問題・レッスン・セリフ・読み辞書を変えて main に入れると自動で実行され、増えた文だけ作ります
- 生成した `public/voice/` を main にコミットし、GitHub Pages のデプロイも自動で起動します
- 初回は全件生成のため数十分〜1時間ほどかかります

### 手元の PC で作る
1. [VOICEVOX](https://voicevox.hiroshiba.jp/) を起動（エンジンが `http://127.0.0.1:50021` で待ち受け）
2. `ffmpeg` をインストール
3. `npm run voice:build`（`-- --limit 20` でお試し、`-- --dry-run` で件数だけ確認）
4. `public/voice/*.mp3` と `public/voice/manifest.json` をコミット

- 話者は名前で指定します（初期値 `--character もち子さん --style ノーマル`）。声を変えるときは `--force` で作り直し

### アクセント・イントネーション・長さのチューニング
- 表示用のひらがな分かち書きは、VOICEVOX に渡す前に読み用へ変換します（`scripts/voice-reading.mjs`）
  - 単語間の空白を除去（不自然な間・アクセント句の切れ目を防ぐ）
  - よく出る語を漢字化（`scripts/voice-dict.json` の `nouns` / `tokens`）、数＋助数詞を漢字化（1こ→1個、2にん→2人、3じはん→3時半 …）
  - 「こたえは 13」→「答えは、13」のように答えの前に短い間
- 文の種類ごとに速さ・抑揚・高さ・間・前後の無音を変えています（問題=ゆっくりはっきり／答え=落ち着いて／レッスン=いちばんゆっくり・間長め／ほめ言葉=明るく抑揚大きめ）
- 造語のアクセントは `voice-dict.json` の `accent` を VOICEVOX のユーザー辞書に登録します（例: はむちー＝ハムチー、1型）
- 試し聴き: `npm run voice:build -- --preview "とけいの はりが 3。なんじ？" --kind question`（mac は自動再生）
- 全体調整: `--speed 1.05`（速さ倍率）`--intonation 0.9`（抑揚倍率）`--pause 1.2`（間の倍率）`--pitch 0.02`（高さ加算）。気に入ったら `--force` を付けて全部作り直し
- すでにあるファイルはスキップするので、問題を追加したら再実行すればOK
- 音声がない文はブラウザの音声合成で読み上げます
- クレジット（もち子さんは「VOICEVOX:もち子(cv 明日葉よもぎ)」）は manifest に記録され、アプリ内（ホーム下部・おとなのへや）に表示されます。利用時は [VOICEVOX の利用規約](https://voicevox.hiroshiba.jp/term/) と各キャラクターの規約を守ってください

## 効果音（OtoLogic）

効果音は `public/sfx/` の mp3 を鳴らします（`manifest.json` に載っていない場面は、これまでどおりシンセで鳴らします）。素材は [OtoLogic](https://otologic.jp/)（CC BY 4.0、クレジット表記「OtoLogic」）を使い、クレジットはマップ下とおとなの へやに表示されます。

1. OtoLogic から使いたい効果音の zip / mp3 をダウンロードし、`sfx-src/` に置く
2. `node scripts/import-sfx.mjs --list` で候補のファイル名と長さを確認
3. `scripts/sfx-map.json` の各場面（tap / correct / wrong / combo / clear / gift）の `file` にファイル名を書く。`maxSeconds` で長さ、`gainDb` で音量を調整
4. `node scripts/import-sfx.mjs` を実行すると、無音カット・長さ調整・音量そろえをした `public/sfx/*.mp3` と `manifest.json` ができる（ffmpeg が必要）

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
