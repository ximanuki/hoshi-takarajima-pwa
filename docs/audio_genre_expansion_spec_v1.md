# Audio Genre Expansion Spec v1

作成日: 2026-02-05
対象: `src/utils/audioLabPlayer.ts` / `src/pages/AudioLabPage.tsx`

## 1. 背景と課題

現在のTone.jsプリセットはLo-fi系の質感は向上しているが、以下の課題がある。

1. **Jersey Clubのビート署名が弱い**
   - 「3連系/トレシーロ寄りのキック感」「止め・戻し」の明確さが不足。
2. **ジャンル拡張不足**
   - UK Garage / Future Garage / UK Dubstep（Burial志向）の比較体験が未実装。
3. **比較ラボの価値不足**
   - 「トレンド寄りの4つ打ちアレンジ」以上の、UK文脈のリズム差を体験しづらい。

## 2. リサーチ要点（実装に使う設計根拠）

### 2.1 Jersey Club
- 130–140 BPM帯、バウンシーなグルーヴ、triplet/tresillo系キックが中核。
- 具体例として、Native Instrumentsチュートリアルはキック配置を `1,5,9,12,15` の16分位置で提示。

### 2.2 UK Garage
- UKGは「shuffled/percussive + syncopated hats/snares」、4/4または2-step、テンポは約130 BPM。
- chopped / time-stretched / pitch-shifted vocalの文脈を持つ。

### 2.3 Future Garage
- UKG/2-step由来のオフキルターなリズム。
- pitched vocal chops、filtered reese bass、dark atmosphere、field recording、vinyl crackleが特徴。
- テンポ帯は130–140 BPMが中心。

### 2.4 UK Dubstep（Burial志向）
- South London起源、2-step由来 + sparse dub production、syncopated pattern、dark tone。
- Burial本人の言説（2007 interview再掲）では、クラブ直結より「夜に帰路で残響を抱える」内省的な文脈が強い。

## 3. デザイン方針

1. **Jersey修正は“音色”より先に“リズム署名”を固定**
   - まずキック骨格をJersey定型に寄せ、次にゴースト/フィルを足す。
2. **新規3曲は用途分離**
   - UKG: ダンス性（スキップ感）
   - Future Garage: 情景性（余白・揺らぎ）
   - UK Dubstep: 低域重心（半拍感・内省）
3. **Brostep回避**
   - 中高域の過剰なワブル・歪みリードを禁止。
   - サブベース中心、隙間を活かす。

## 4. 追加・修正プリセット仕様

## 4.1 既存修正: `lofi_jersey`
- BPM: `136 -> 138`
- キック（16分インデックス）: `0,4,8,11,14`（Jerseyの定型感）
- クラップ: `8,11`（メイン）、ゴーストをサブで補助
- ハット: `2,6,10,14` 基本 + セクション後半アクセント
- フィル: 小節末 `13/15` に短打追加

## 4.2 新規: `uk_garage_neon`
- 目的: 2-step寄りUKGグルーヴ
- BPM: `132`
- キック: `0,6,10`（4/4回避、スキップ感）
- クラップ/スネア: `4,12`
- ハット: `1,3,6,8,10,14`
- ゴースト: `7,11,15`
- 和声: 明るめ7thコード、短いキー/ボーカル風モチーフ

## 4.3 新規: `future_garage_mist`
- 目的: 余白・揺らぎ・情景
- BPM: `134`
- キック: `0,9`（低密度）
- スネア: `8`（半拍感）
- ハット: `2,6,10,14`（控えめ）
- ゴースト: `7,11,15`
- テクスチャ: crackle/air/noise成分を通常より強め
- 和声: マイナー寄り、レスポンス的高域モチーフ

## 4.4 新規: `dubstep_nightbus`
- 目的: Burial的な「夜の帰路」志向のUK Dubstep
- BPM: `140`（半拍体感）
- キック: `0,6,11`（疎・重）
- スネア: `8`中心
- ハット: `3,7,11,15`（UKG由来のスウィング感を残す）
- サブ: `0,8`（最重要）
- 音色制約:
  - 中高域の過剰歪みを抑制
  - サブ + ダブ空間（delay/reverb）優先

## 5. エンジン変更仕様

1. `TonePresetId` に3曲を追加。
2. `TonePresetConfig` に `rhythmProfile` を追加し、
   - `lofi` / `jersey` / `ukg` / `future_garage` / `dubstep` / `ambient` を分岐キーに使う。
3. `buildToneGraph` の分岐をIDハードコードから `rhythmProfile` ベースへ移行。
4. `AudioLabPage` の説明文をジャンル追加に合わせ更新。
5. 既存の`playToneSfx`は継続利用しつつ、UKG/Jersey系はアクセント挙動を強める。

## 6. 受け入れ条件（Definition of Done）

1. BGM比較ラボで新規3曲が再生可能。
2. `lofi_jersey` のキック主骨格が `0,4,8,11,14` へ変更済み。
3. `dubstep_nightbus` で半拍体感（snare on 3拍目相当）が成立。
4. `future_garage_mist` で明確な余白とテクスチャ差（ambient寄り）が体感できる。
5. `npm run build` / `npm run test:golden` が通過。

## 7. リスクと緩和

- **リスク**: 音数増加でモバイルCPU負荷が上がる。
  - **緩和**: セクション別確率トリガーを維持し、常時同時発音数を制限。
- **リスク**: DubstepがBrostep寄りに聞こえる。
  - **緩和**: distortion量上限を設け、サブ優先ミックスを固定。
- **リスク**: Jerseyの定型が過度に機械的。
  - **緩和**: 定型キックを固定しつつ、ゴーストと微小humanizeで動きを付与。

## 8. 実装タスク

1. 型拡張（`TonePresetId` / `TonePresetConfig.rhythmProfile`）
2. 既存`lofi_jersey`のリズム修正
3. 新規3プリセット追加
4. `buildToneGraph`分岐のprofile化
5. `AudioLabPage`説明更新
6. build/test実行
7. commit/push

## 参考ソース
- Jersey club定義: [Wikipedia](https://en.wikipedia.org/wiki/Jersey_club)
- Jerseyキック配置実例: [Native Instruments Blog](https://blog.native-instruments.com/jersey-club/)
- UK Garage定義: [Wikipedia](https://en.wikipedia.org/wiki/UK_garage)
- Future Garage定義: [Wikipedia](https://en.wikipedia.org/wiki/Future_garage)
- Dubstep定義: [Wikipedia](https://en.wikipedia.org/wiki/Dubstep)
- Burial文脈（2007 interview再掲）: [Mixmag](https://mixmag.net/read/burial-interview-untrue-2007-producer-hyperdub-news)
- UK Garage教育アクティビティ: [Ableton Classroom Activities](https://www.ableton.com/fr/classroom/support/classroom-activities/)
