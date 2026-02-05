# Audio Realism Upgrade Spec v1

作成日: 2026-02-05  
対象: `src/utils/audioLabPlayer.ts`, `src/pages/AudioLabPage.tsx`

## 1. 目的

既存のTone.js楽曲（9プリセット）を、以下の方向で「実楽器らしい質感」に再構成する。

1. 音の立ち上がりに「打鍵・擦過・呼気」などの物理感を入れる  
2. 単体音色ではなく「層（Layer）」で楽器の胴鳴りと倍音を作る  
3. 曲ごとのSEセットとBGMの質感を連動させ、世界観を統一する  
4. 低端末でも破綻しないCPU設計を維持する

## 2. 制約と方針

## 2.1 制約
- 現状は外部サンプル資産を同梱していないため、フルサンプル方式は未採用
- ブラウザ実行であるため、ノード数・同時発音数の制御が必要

## 2.2 方針
- Phase A（今回）: Tone.js内で物理感を強化する「レイヤー再設計」
- Phase B（次段）: サンプル導入を想定したハイブリッド化（Sampler + Synth）

## 3. 音色再構成（Phase A）

## 3.1 BGMインストゥルメント再設計
- Pad: 本体 + Shimmer層
- Keys: 本体 + Body層 + Hammerノイズ
- Lead: 本体 + Body層 + Breathノイズ
- Bass: 本体 + Body層 + Fingerノイズ
- Drums:
  - Kick + Click
  - Clap + SnareTone + SnareSnap
  - Hat（close/open分離）
  - Ghost + Wood系補助打音

## 3.2 マスター段再設計
- `Distortion -> Filter -> EQ3 -> BusComp -> MultibandComp -> StereoWidener -> Limiter`
- プリセット別にマスター係数を分離管理
- セクション進行に応じてEQとフィルタを動的変化

## 3.3 SE再設計
- プリセット専用SEシグネチャを定義
- 同じ `tap/correct/miss/clear` でも、曲ごとにノート進行・余韻・トランジェントを変更

## 4. UX/体験要件

1. BGM比較ラボで「曲を変えるとSEキャラも変わる」が明確にわかる
2. ホーム/プレイ/結果の遷移で二重再生が発生しない
3. 連打しても耳障りな破綻が出ない（クールダウン・短時間dispose）

## 5. 受け入れ条件

1. `npm run build` が通る
2. `npm run test:golden` が通る
3. `npm run lint` が通る
4. AudioLabで全プリセット再生 + 全SE再生が動作

## 6. 今後（Phase B）

実楽器感をさらに上げるには、下記を追加する。

1. 楽器別サンプルパック（kick/snare/hihat/bass/keys/pluck/padアタック）
2. `Sampler` を使ったラウンドロビン再生
3. サンプル未読込時は現行Synth層へ自動フォールバック

これにより「実機材に近いアタック」と「ブラウザ内の安定性」を両立する。
