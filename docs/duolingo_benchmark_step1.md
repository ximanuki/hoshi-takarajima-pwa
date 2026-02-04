# Duolingo Deep Research（Step1反映）

- 作成日: 2026-02-04
- 対象: `誤答ドリブン適応学習エンジン（Step1）`
- 参照仕様: `/Users/nizom/Documents/Codex/hoshi-takarajima-pwa/docs/step1_error_driven_adaptive_spec_v1.md`

---

## 0. 調査目的
「Duolingoの何を、どこまで、低学年向けPWAに移植するか」を定義する。

主な問い:
1. 誤答ドリブン学習の精度を上げる設計要素は何か
2. 難易度制御が「表示だけ上がる問題」を避けるには何が必要か
3. 低年齢UXを壊さずに取り込める要素は何か

---

## 1. 調査方法
- 調査日: 2026-02-04（最新公開情報ベース）
- 優先ソース:
  - Duolingo公式ブログ/公式研究サイト
  - Duolingo公開論文（一次情報）
- 除外:
  - まとめ記事、推測系動画、二次解説のみの媒体

---

## 2. 主要発見（一次情報）

## 2.1 パーソナライズは「セッション中に更新」される
Duolingoは Birdbrain を用いて、学習者ごとに「難しすぎず簡単すぎない」問題を選び、回答のたびに推定を更新する設計を採用。  
Step1への示唆: ミッション終了時だけでなく、問題回答時の痕跡（誤答タグ・回答時間）を継続学習に使うべき。

出典:
- [Birdbrain: Personalizing content difficulty in language learning](https://blog.duolingo.com/learning-how-to-help-you-learn-introducing-birdbrain/)

## 2.2 難易度可視化は継続率に効く（ただし実体と一致が前提）
Duolingoの difficulty score 可視化は、 lesson completion と practiceの増加に寄与した（公開値: +45%, +27%）。  
Step1への示唆: 可視化だけでは不十分。表示難易度と実出題難易度の一致を強制する必要がある。

出典:
- [The AI system making lessons just right](https://blog.duolingo.com/duolingo-ai-scores-english-exercises/)

## 2.3 「どこが難しいか」の局所ヒントが有効
Duolingoは difficult words indicator で、つまずきやすい語に事前マークを付ける。  
Step1への示唆: つまずきタグを結果画面だけでなく、Play中の短文フィードバックにも反映する。

出典:
- [How Duolingo experts work to make the app effective, engaging, and fair](https://blog.duolingo.com/how-well-does-duolingo-work/)

## 2.4 復習はSRS（間隔拡大）を中核に置く
Duolingoは復習タイミングを段階的に広げる spaced repetition を明示している。  
Step1への示唆: 誤概念の優先度更新は、SRS間隔と一体で扱う。

出典:
- [How Duolingo experts work to make the app effective, engaging, and fair](https://blog.duolingo.com/how-well-does-duolingo-work/)

## 2.5 誤答に基づく個別練習は実装済み思想
Duolingoの適応レッスン説明では、学習者が間違えた内容を優先して練習させることを明示。  
Step1への示唆: 「弱点スキル」だけでなく「誤概念タグ」を再出題トリガーにするのが妥当。

出典:
- [Improving motivation and personalizing learning with AI](https://blog.duolingo.com/duolingo-ai/)

## 2.6 忘却曲線モデル（HLR）の実装知見がある
Duolingo公開論文では、記憶確率を経過時間と半減期で扱う trainable model（HLR）を提示。  
Step1への示唆: 完全導入はStep1で過剰だが、`dueAt` 設計に「指数的間隔」を使う判断は妥当。

出典:
- [A Trainable Spaced Repetition Model for Language Learning](https://aclanthology.org/P16-1174/)
- [Duolingo HLR dataset](https://github.com/duolingo/halflife-regression/blob/master/settles.acl16.hlr_dataset.csv.gz)
- [Duolingo HLR code](https://github.com/duolingo/halflife-regression/blob/master/hlr.py)

## 2.7 社会的動機は効果が大きい（ただしStep2向き）
公開研究では、協調/友人要素が継続に有意効果を持つことが示される。  
Step1への示唆: 今回は学習ロジック優先。社会機能はStep2に移管するのが依存的に正しい。

出典:
- [Uncovering the power of social motivators in language learning](https://blog.duolingo.com/social-motivators-language-learning/)

---

## 3. 採用/調整/不採用マトリクス（Step1）

| 要素 | 判断 | 理由 |
|---|---|---|
| 誤答ベース個別練習 | 採用 | Step1の中心目的に直結 |
| 回答ごとの推定更新 | 採用 | ミッション単位更新だけだと遅い |
| 難易度の透明表示 | 採用（条件付き） | 実出題と整合して初めて有効 |
| difficult words的事前警告 | 調整採用 | 低学年向けに「やさしいヒント」へ翻訳 |
| HLR完全導入 | 今回不採用 | 実装負荷が高くStep1過剰 |
| HLR的間隔拡大思想 | 採用 | 既存SRSと整合、導入コスト小 |
| ソーシャル機能強化 | Step2へ延期 | 依存順 `1 -> 3 -> 2` を優先 |

---

## 4. 4論点に対する最終解（Duolingo参照反映）

## 4.1 `latencyMs` 閾値（900ms）補正
決定:
- 固定閾値から開始し、データ蓄積後に動的化するハイブリッド方式を採用

仕様:
1. ブートストラップ期（該当教科の正答ログ < 20件）
   - `guessThresholdMs = 900`
2. 通常期
   - `guessThresholdMs = clamp(medianCorrectLatency(subject,difficulty) * 0.35, 700, 1400)`
3. 判定
   - 不正解かつ `latencyMs < guessThresholdMs` で `unknown_guess` 候補

根拠:
- Duolingoの「回答ごと推定更新」思想に合わせ、静的閾値のみの運用を避けるため。

## 4.2 `priority >= 25` の教科別分離
決定:
- Step1初期は共通閾値 `25` を採用し、Step1.5でデータ差に応じ分離可否を判断

分離判定条件（Step1.5）:
- 算数と国語で「高priorityタグ再出題到達率」の差が 15pt 以上を2週連続で観測

根拠:
- 早期分岐は調整自由度を増やす反面、因果検証を難化させるため。

## 4.3 Parent画面の集計粒度
決定:
- 表示は日次集計、内部保持はミッション単位

仕様:
- デフォルトカード: 直近7日の日次値
- 詳細ビュー: 直近ミッション履歴

根拠:
- 保護者向け可読性と、調査可能性（原因追跡）の両立。

## 4.4 `question_meta.ts` 初期整備範囲
決定:
- 全問一括ではなく上位200問を優先整備

優先選定基準:
1. 直近出題頻度が高い
2. 誤答率が高い
3. 学習基礎スキル（小1-2の根幹）に属する

拡張ゲート:
- `unknown_guess` 比率が 35% 以下になったら次バッチ（+100問）へ進む

根拠:
- Step1効果の早期立ち上げと、タグ品質担保の両立。

---

## 5. Step1仕様への反映差分（確定）
1. 未解決事項4件を「確定仕様」に昇格  
2. `latencyMs` 動的閾値の式を明文化  
3. `priority` 教科分離の発動条件を定義  
4. Parent表示粒度を二層化（表示=日次, 内部=ミッション）  
5. `question_meta.ts` の段階導入ゲートを定量化  

---

## 6. 実行順（Step-by-Step）
1. `types/store` に動的閾値計算に必要な集計値を追加  
2. `inferErrorTag` にハイブリッド閾値を実装  
3. `priority=25` 共通運用でログ収集を開始  
4. Parent画面に日次カード + 詳細表示の土台を追加  
5. `question_meta.ts` を上位200問から整備し、`unknown_guess` 比率を監視  
6. Step1.5で閾値分離の要否を判定  

---

## 7. 参考リンク一覧（一次情報）
- [Duolingo Birdbrain personalization](https://blog.duolingo.com/learning-how-to-help-you-learn-introducing-birdbrain/)
- [Duolingo AI difficulty score](https://blog.duolingo.com/duolingo-ai-scores-english-exercises/)
- [Duolingo adaptive lessons / personalized practice](https://blog.duolingo.com/duolingo-ai/)
- [How Duolingo works: spacing & difficult words](https://blog.duolingo.com/how-well-does-duolingo-work/)
- [Social motivators study](https://blog.duolingo.com/social-motivators-language-learning/)
- [HLR paper (ACL 2016)](https://aclanthology.org/P16-1174/)
- [HLR dataset](https://github.com/duolingo/halflife-regression/blob/master/settles.acl16.hlr_dataset.csv.gz)
- [HLR code](https://github.com/duolingo/halflife-regression/blob/master/hlr.py)
