# Step1 仕様書 v1.0
## 誤答ドリブン適応学習エンジン（Pattern 1）

- 作成日: 2026-02-04
- 対象プロダクト: `hoshi-takarajima-pwa`
- ステータス: Draft（実装前レビュー待ち）
- 位置づけ: 段階導入計画 `1 -> 3 -> 2` の Step1

---

## 0. この仕様の狙い（要約）
現状は「正答率と平均難易度」で難易度を上下させるため、**なぜ間違えたか**が学習計画に反映されにくい。  
本仕様は、誤答を「失敗」ではなく「診断データ」として扱い、次のミッションに確実に反映する。

達成したい体験は3つ。
1. 子どもが「できなかった理由」を短い言葉で理解できる
2. 次のミッションで同じつまずきに最短で再挑戦できる
3. 難易度上昇が見かけだけでなく、出題内容として実感できる

---

## 1. 現状分析とギャップ

## 1.1 現状（実装済み）
- `skillId` / `difficulty` / 軽量SRS（`mastery`, `streak`, `nextReviewAt`）は動作している
- 直近問題の連投抑制（recent IDs）も入っている
- ただし誤答は `correct: false` としてしか保存されない

## 1.2 ギャップ
- 「計算ミス」「演算の取り違え」「語彙の意味誤解」など誤答の種類が区別されない
- そのため、復習はスキル単位でしか最適化できず、誤答原因の再学習が弱い
- 難易度更新がスキル平均寄りで、誤概念が残っていても昇格しやすいケースがある

## 1.3 根本原因
- 問題データに「誤答選択肢の意味（誤概念タグ）」がない
- セッションログに「回答時間」「誤答カテゴリ」がない
- 出題器が「弱点スキル」は見ているが「弱点誤概念」は見ていない

---

## 2. 設計原則（Step1で守ること）
1. **診断優先**: 正誤だけでなく誤答タイプを主信号にする  
2. **低年齢負荷制御**: UI文言は短く、内部ロジックだけ高度化する  
3. **後方互換**: 既存問題データのままでも動作する（タグ未設定はフォールバック）  
4. **依存分離**: Step3（コンテンツ工場化）に先行できる実装にする  
5. **説明可能性**: なぜその問題を出したかをログで再現できるようにする

---

## 3. スコープ定義

## 3.1 In Scope（Step1で実装対象）
- 誤答分類モデル（misconception taxonomy）導入
- 回答ログ拡張（選択肢、回答時間、誤答タグ）
- 誤概念ごとの優先度管理（due/priority）
- ミッション編成に誤概念優先枠を導入
- 難易度昇降格に「未解消誤概念ペナルティ」を追加
- 結果画面に「今回のつまずきトップ表示」を追加

## 3.2 Out of Scope（Step1ではやらない）
- 章構成・ワールドマップ等の大型ストーリー演出（Step2）
- 問題制作パイプラインの自動Lint（Step3）
- サーバ同期・外部分析基盤
- 音声認識や手書き入力

---

## 4. 依存関係と前提

## 4.1 技術前提
- 状態管理: Zustand persist
- 出題: `src/utils/mission.ts`
- データ源: `docs/question_bank_master.md` -> `src/data/questions.generated.ts`

## 4.2 Step1での依存戦略
Step3より先に導入するため、問題データ本体の列拡張は必須にしない。

- 必須導入: `src/data/question_meta.ts`（新規）
  - `questionId` ごとに誤答選択肢のタグを持つ任意メタ
- フォールバック:
  - メタ未登録問題は `unknown_guess` として処理
  - アルゴリズムは `unknown_guess` でも破綻しない設計にする

これにより、Step1は既存ジェネレータ変更なしで先行可能。  
Step3で `question_bank_master.md` へタグを統合し、`question_meta.ts` を縮退予定。

---

## 5. ドメインモデル仕様

## 5.1 誤概念タグ定義

共通タグ:
- `unknown_guess`（推測回答）
- `attention_slip`（不注意）

算数タグ:
- `math_counting_slip`（数え間違い）
- `math_operation_confusion`（+/- の取り違え）
- `math_place_value_confusion`（位取り混同）
- `math_carry_confusion`（繰り上がり理解不足）
- `math_borrow_confusion`（繰り下がり理解不足）

国語タグ:
- `jp_sound_confusion`（音の混同）
- `jp_dakuten_confusion`（濁点・半濁点の混同）
- `jp_particle_confusion`（助詞の混同）
- `jp_vocab_meaning_confusion`（語彙意味の誤解）
- `jp_antonym_confusion`（反対語の誤解）

## 5.2 新規型（TypeScript）
```ts
type MisconceptionTag =
  | 'unknown_guess'
  | 'attention_slip'
  | 'math_counting_slip'
  | 'math_operation_confusion'
  | 'math_place_value_confusion'
  | 'math_carry_confusion'
  | 'math_borrow_confusion'
  | 'jp_sound_confusion'
  | 'jp_dakuten_confusion'
  | 'jp_particle_confusion'
  | 'jp_vocab_meaning_confusion'
  | 'jp_antonym_confusion';

interface MisconceptionState {
  errorCount: number;       // 累積誤答回数
  recentErrorCount: number; // 直近ウィンドウ誤答
  resolvedStreak: number;   // 再学習後の連続正解
  priority: number;         // 出題優先度（0..100）
  dueAt: number;            // 次回再学習時刻
  lastSeenAt: number;
}
```

## 5.3 既存状態への追加
- `SkillProgress` 拡張:
  - `misconceptions: Partial<Record<MisconceptionTag, MisconceptionState>>`
  - `lastErrorTag?: MisconceptionTag`
- `MissionSession` 拡張:
  - `answerTraces: AnswerTrace[]`
- `AnswerTrace` 新規:
  - `questionId`, `skillId`, `difficulty`, `selectedIndex`, `correct`, `latencyMs`, `errorTag`

---

## 6. データ設計（Step1版）

## 6.1 `question_meta.ts` 仕様（新規）
```ts
interface QuestionMeta {
  wrongChoiceTags?: [MisconceptionTag?, MisconceptionTag?, MisconceptionTag?];
  remediationHintByTag?: Partial<Record<MisconceptionTag, string>>;
}

export const questionMetaById: Record<string, QuestionMeta> = { ... };
```

注意:
- `wrongChoiceTags` は選択肢インデックスに対応
- 正答選択肢のタグは未使用（`undefined`）
- 未定義問題はフォールバック推定へ移行

## 6.2 フォールバック推定ルール（タグ未設定時）
- 回答時間が極端に短い（例: < 900ms）かつ不正解 -> `unknown_guess`
- 算数で誤答が正答±1に集中 -> `math_counting_slip`
- それ以外 -> `attention_slip`

---

## 7. 学習アルゴリズム仕様

## 7.1 回答時診断フロー
1. `selectedIndex` を記録
2. 正誤判定
3. 不正解なら `question_meta` から `errorTag` 推定
4. `latencyMs` を含め `answerTraces` へ保存
5. `misconceptionState` を更新

## 7.2 誤概念優先度更新式

不正解時:
- `severity = 1.0 + difficulty*0.2 + fastGuessPenalty`
- `priority = clamp(priority + 12*severity, 0, 100)`
- `recentErrorCount += 1`
- `resolvedStreak = 0`
- `dueAt = now + min(3min * 2^(recentErrorCount-1), 24h)`

正解時（当該tagが過去にある場合）:
- `resolvedStreak += 1`
- `priority = clamp(priority - (6 + resolvedStreak*2), 0, 100)`
- `recentErrorCount = max(recentErrorCount - 1, 0)`
- `dueAt = now + 8h`（最低）

## 7.3 ミッション編成（5問固定）
構成は固定ではなく「優先条件」で決定する。

優先順:
1. `dueAt <= now` かつ `priority >= 25` の誤概念に紐づく問題（最大2問）
2. 弱点スキル（mastery低）問題
3. 目標難易度近傍
4. challenge枠（既存）
5. filler（不足時）

制約:
- 同一問題IDは1ミッションで重複禁止
- 直近30問は強ペナルティ
- 可能なら同一誤概念タグ連打を避け、1ミッション最大2問

## 7.4 難易度更新（Step1改訂）
既存の正答率判定に、未解消誤概念指標を追加する。

追加指標:
- `unresolvedIndex = avg(priority of top2 misconception tags) / 100`
- `remediationHitRate = (誤答タグ関連問題の正答数 / 出題数)`

昇格条件（全て満たす）:
1. `accuracy >= 0.8`
2. `avgDifficulty >= targetDifficulty - 0.2`
3. `unresolvedIndex <= 0.35`
4. `remediationHitRate >= 0.6`

降格条件（いずれか）:
1. `accuracy <= 0.4`
2. `unresolvedIndex >= 0.65`

---

## 8. UX仕様（Step1）

## 8.1 Play画面
- 「つぎへ」押下時に、正誤と短文フィードバックを1ステップ表示
- フィードバック文はタグ別テンプレート（最大20文字程度）
  - 例: `math_operation_confusion` -> 「＋と−を もういちど みてみよう」

## 8.2 Result画面
- 追加表示:
  - 「こんかいの つまずき」上位2件
  - 「つぎは ここを れんしゅう」1文
- 保護者向け用語は裏側で保持、子ども向け表示は平易語に変換

## 8.3 Parent画面
- 追加カード:
  - 直近7ミッションの「誤概念再発率」
  - 「再挑戦後1回目で正解できた率」

---

## 9. 指標（KPI/KQI）

主要KPI:
1. **誤概念再発率**  
   - 定義: 同一タグが3ミッション以内に再発した割合
   - 目標: 現状比 -25%

2. **再挑戦初回成功率**  
   - 定義: 誤答タグ関連問題の次回出題で正解した割合
   - 目標: 60%以上

3. **表示難易度と実出題難易度の整合差**  
   - 定義: `abs(target - servedAvg)`
   - 目標: 平均 0.35 以下

監視指標:
- `unknown_guess` 比率（高すぎる場合はメタ不足）
- フォールバック率（メタ未登録問題率）
- 出題重複率

---

## 10. 実装ステップ（依存順）

### Step1-0 計測基盤
- `AnswerTrace` 追加
- `latencyMs`, `selectedIndex` 記録
- 既存挙動を変えずログだけ保存

完了条件:
- 全回答が trace に記録される
- 既存のビルド/画面動作が不変

### Step1-1 誤概念モデル導入
- タグ型追加
- `question_meta.ts` 新設
- `inferErrorTag()` 実装（メタ + フォールバック）

完了条件:
- 不正解の70%以上が `unknown_guess` 以外に分類

### Step1-2 学習状態更新
- `SkillProgress` に `misconceptions` を追加
- priority/due 更新ロジックを導入
- persistのマイグレーション処理追加

完了条件:
- 既存ユーザーデータからの復元でクラッシュしない

### Step1-3 出題器統合
- `buildAdaptiveMission()` に誤概念優先枠を追加
- recentペナルティと共存
- 5問固定を維持

完了条件:
- due中の高priority誤概念が2ミッション以内に再出題される

### Step1-4 UI反映
- Play: 短文フィードバック
- Result: つまずき上位2件表示
- Parent: 再発率カード追加

完了条件:
- 子ども向け文言が難語なしで表示される

### Step1-5 チューニングと固定
- 閾値調整（priority増減、昇降格条件）
- テストシナリオのゴールデン化

完了条件:
- KPIの初期目標を満たすか、未達理由が説明可能

---

## 11. テスト計画

## 11.1 Unit
- `inferErrorTag()` の分岐網羅
- priority更新式の境界値（0/100）
- 難易度昇降格判定の閾値テスト

## 11.2 Integration
- 連続ミッションで誤概念が再出題されるか
- `clearProgress` 後に誤概念状態が初期化されるか
- 既存ストリーク/報酬が回帰しないか

## 11.3 Simulation（自動）
- 1000ミッション疑似プレイ（正答率分布パターン複数）
- 指標:
  - 再発率の低下
  - 難易度暴騰/暴落がないこと
  - `unknown_guess` 依存が過剰でないこと

---

## 12. リスクと潰し込み

| リスク | 影響 | 対策 |
|---|---|---|
| メタ未整備で `unknown_guess` が多い | 診断精度低下 | Step1はフォールバックで動かしつつ、Step3でタグ移管を義務化 |
| 誤概念優先しすぎて難易度が下がる | 成長実感低下 | 1ミッション最大2問までに制限、残りはtarget近傍を維持 |
| UI情報過多で子どもが混乱 | 離脱 | 子ども表示は短文1行、詳細はParent画面へ分離 |
| persistスキーマ追加で既存データ破損 | 起動不能 | バージョン付きマイグレーションとデフォルト補完を必須化 |

---

## 13. 仕様自己監査（矛盾・依存・穴チェック）

### 13.1 5問固定 vs 再学習強化
- 判断: 5問固定を維持し、配分で再学習枠を確保する
- 理由: UXテンポと既存画面設計を壊さないため

### 13.2 Step1先行 vs データ拡張依存
- 判断: `question_meta.ts` に分離して依存切り離し
- 理由: Step3未完でも診断学習を開始できるため

### 13.3 難易度上昇と誤概念残存の矛盾
- 判断: 昇格に `unresolvedIndex` ゲートを追加
- 理由: 見かけ上の昇格を防止するため

### 13.4 高精度タグ運用の現実性
- 判断: 最初は高頻度問題から優先付与（80/20）
- 理由: 全556問を一括整備しない段階導入を可能にするため

---

## 14. Step1完了の受け入れ基準（最終）
1. 不正解の診断ログ（errorTag + latency）が全件保存される  
2. 高priority誤概念が次回2ミッション以内に再出題される  
3. 昇格時に `unresolvedIndex` 条件を満たさない場合は昇格しない  
4. Result画面で「つまずき上位」が表示される  
5. 既存機能（XP/スター/バッジ/ストリーク/PWA）が回帰しない  

---

## 15. Step3/Step2への接続（将来互換）
- Step3でやること:
  - `question_bank_master.md` に誤答タグ列を正式統合
  - 自動Lintでタグ未設定・偏りを検出
  - `question_meta.ts` の一時運用を段階的に廃止

- Step2でやること:
  - 本Stepの誤概念情報を「島の練習テーマ」に翻訳
  - ストーリー進行と再学習優先度を両立

このためStep1では、**学習エンジンの説明可能性とデータ粒度**を最優先に固定する。

---

## 16. 実装詳細設計（ファイル単位）

## 16.1 `src/types.ts`
追加/変更:
- `MisconceptionTag` 型を追加
- `MisconceptionState` 型を追加
- `AnswerTrace` 型を追加
- `SkillProgress` 拡張（`misconceptions`, `lastErrorTag`）
- `MissionSession` 拡張（`answerTraces`, `questionStartedAt`）
- `MissionResult` 拡張（`topMisconceptions`, `servedDifficultyAvg`）

型安全ポリシー:
- タグは文字列unionで固定し、自由入力を禁止
- 既存保存データとの互換維持のため、追加項目は optional で導入後に migrate

## 16.2 `src/data/question_meta.ts`（新規）
責務:
- 問題IDに対し「誤答選択肢がどの誤概念か」を保持
- 学習エンジンはこのファイルのみを参照し、UIは直接参照しない

設計ルール:
- まず出題頻度上位200問から埋める
- 未登録IDは許容（フォールバック処理）
- 同一問題で選択肢を変更した場合、必ずメタも同時更新

## 16.3 `src/utils/mission.ts`
追加責務:
- `inferErrorTag(traceContext)` 実装
- `updateMisconceptionState()` 実装
- `buildAdaptiveMission()` に `misconceptionPriorityPool` を追加
- `updateAdaptiveProgress()` に `unresolvedIndex` / `remediationHitRate` 判定追加

禁止事項:
- 出題の最終件数（5問）を変えない
- 既存の `review/core/challenge` 構造を破壊しない（優先順位のみ拡張）

## 16.4 `src/store/useAppStore.ts`
追加状態:
- `diagnosticLogs: AnswerTrace[]`（直近200件）
- `migrationVersion: number`

更新ポイント:
- `startMission`: `questionStartedAt` を初期化
- `submitAnswer`: `latencyMs` 計測、trace追加
- `finishMission`: top誤概念集計、結果へ格納
- `clearProgress`: 誤概念状態/ログも完全初期化

## 16.5 UI関連ファイル
- `src/pages/PlayPage.tsx`: 正誤フィードバック（1ステップ）
- `src/pages/ResultPage.tsx`: つまずき上位2件表示
- `src/pages/ParentPage.tsx`: 再発率・再挑戦成功率カード

UIルール:
- 子ども向け表示は「やさしい文」に限定
- タグ内部名（`math_operation_confusion` など）は画面に出さない

---

## 17. 永続化仕様（persist migration）

## 17.1 バージョン管理
- Zustand persist の保存オブジェクトに `schemaVersion` を追加
- Step1導入時バージョンを `2` とする（現行を `1` 扱い）

## 17.2 マイグレーション手順
`v1 -> v2`:
1. 既存 `skillProgress` を走査
2. `misconceptions` が無ければ空オブジェクトを補完
3. `lastErrorTag` は `undefined` 付与
4. `diagnosticLogs` を空配列で追加
5. `recentQuestionIdsBySubject` 欠落時は既定値を補完

失敗時フェイルセーフ:
- migrate例外時は保存データを破棄せず、対象キーだけデフォルト化
- アプリ起動不能を最優先で防ぐ

## 17.3 データ保持期間
- `diagnosticLogs` は最新200件を保持し、古い順に削除
- `misconceptionState` は `lastSeenAt` が60日以上前ならクリーンアップ候補

---

## 18. アルゴリズム詳細（擬似コード）

## 18.1 エラータグ推定
```ts
function inferErrorTag(input): MisconceptionTag {
  const metaTag = questionMetaById[input.questionId]?.wrongChoiceTags?.[input.selectedIndex];
  if (metaTag) return metaTag;

  if (!input.correct && input.latencyMs < 900) return 'unknown_guess';
  if (input.subject === 'math' && Math.abs(input.selectedValue - input.correctValue) === 1) {
    return 'math_counting_slip';
  }
  return 'attention_slip';
}
```

## 18.2 誤概念状態更新
```ts
function updateMisconceptionState(prev, trace, now): MisconceptionState {
  const current = prev ?? createDefaultMisconceptionState(now);
  if (!trace.correct) {
    const fastGuessPenalty = trace.latencyMs < 900 ? 0.6 : 0;
    const severity = 1 + trace.difficulty * 0.2 + fastGuessPenalty;
    return {
      ...current,
      errorCount: current.errorCount + 1,
      recentErrorCount: current.recentErrorCount + 1,
      resolvedStreak: 0,
      priority: clamp(current.priority + 12 * severity, 0, 100),
      dueAt: now + Math.min(3 * 60_000 * 2 ** Math.max(current.recentErrorCount, 0), 24 * 60 * 60_000),
      lastSeenAt: now,
    };
  }
  return {
    ...current,
    resolvedStreak: current.resolvedStreak + 1,
    recentErrorCount: Math.max(0, current.recentErrorCount - 1),
    priority: clamp(current.priority - (6 + (current.resolvedStreak + 1) * 2), 0, 100),
    dueAt: now + 8 * 60 * 60_000,
    lastSeenAt: now,
  };
}
```

## 18.3 出題優先プール構築
```ts
priorityPool = skills
  .flatMap(skill => getHighPriorityMisconceptions(skill))
  .filter(tag => tag.dueAt <= now && tag.priority >= 25)
  .sort(byPriorityDescThenDueAsc);
```

選定規則:
- priorityPoolから最大2問
- 同一タグは最大2問
- targetDifficulty からの乖離が2を超える場合は skip

---

## 19. 受け入れテスト詳細（Given/When/Then）

## 19.1 診断ログ記録
- Given: 1問回答（不正解）
- When: `submitAnswer` 実行
- Then: `answerTraces` に `selectedIndex`, `latencyMs`, `errorTag` が保存される

## 19.2 誤概念優先再出題
- Given: `math_operation_confusion` priority=70, dueAt<=now
- When: 次ミッションを2回開始
- Then: 2回以内に該当タグ関連問題が最低1回出題される

## 19.3 昇格抑制
- Given: accuracy=0.9 だが unresolvedIndex=0.7
- When: `finishMission`
- Then: `afterDifficulty === beforeDifficulty`（昇格しない）

## 19.4 UI平易表示
- Given: topMisconceptions に内部タグが入っている
- When: Result画面表示
- Then: 内部タグ文字列は表示されず、平易語のみ表示される

---

## 20. 計測イベント仕様（分析ログ）

イベント:
1. `mission_answered`
2. `mission_completed`
3. `misconception_resolved`
4. `difficulty_blocked_by_unresolved`

`mission_answered` payload:
- `subject`
- `questionId`
- `skillId`
- `difficulty`
- `selectedIndex`
- `correct`
- `latencyMs`
- `errorTag`
- `targetDifficulty`

ログ運用:
- ローカル保存のみ（Step1）
- Step3以降でエクスポート機能検討

---

## 21. ロールアウト計画

## 21.1 Feature Flag
- フラグ名: `adaptiveErrorDrivenV1`
- 既定: ON（開発）/ OFF（万一の即時ロールバック用）

## 21.2 段階リリース
1. 開発環境で有効化
2. 自己プレイ30ミッション検証
3. 既存ユーザーデータでマイグレーション検証
4. 本番有効化

## 21.3 ロールバック条件
- 起動失敗率 > 0%
- 連続クラッシュ再現
- ミッション生成不能（5問未満）

ロールバック手順:
- フラグOFF -> 既存ロジックへ即時退避
- 収集済みログは保持（再分析用）

---

## 22. Duolingoベンチマーク反映による確定事項
詳細根拠は以下を参照。  
`/Users/nizom/Documents/Codex/hoshi-takarajima-pwa/docs/duolingo_benchmark_step1.md`

### 22.1 `latencyMs` 閾値の端末差吸収
- 採用: ハイブリッド閾値（固定 -> 動的）
- 仕様:
  - 初期（正答ログ < 20）: `guessThresholdMs = 900`
  - 以降: `guessThresholdMs = clamp(medianCorrectLatency(subject,difficulty)*0.35, 700, 1400)`
- 判定:
  - 不正解かつ `latencyMs < guessThresholdMs` で `unknown_guess` 候補

### 22.2 `priority >= 25` の教科分離方針
- 採用: Step1は共通25で開始
- 分離条件（Step1.5）:
  - 算数/国語で「高priorityタグ再出題到達率」の差が15pt以上を2週連続で観測
  - 条件成立時のみ教科別閾値を導入

### 22.3 Parent画面の集計粒度
- 採用: 表示は日次、内部はミッション単位
- UI:
  - 既定カードは直近7日の日次推移
  - drill-downでミッション履歴を表示

### 22.4 `question_meta.ts` 初期整備範囲
- 採用: 上位200問を優先整備（全問一括はしない）
- 優先順:
  1. 出題頻度が高い
  2. 誤答率が高い
  3. 基礎スキルに属する
- 拡張ゲート:
  - `unknown_guess` 比率が35%以下になったら次バッチ（+100問）へ拡張

---

## 23. 残留リスク（実装時に監視）
1. `guessThresholdMs` が端末/学習者差を取り切れず誤判定する
2. 上位200問の偏りにより、特定スキルのみタグ精度が先行する
3. 日次集計が粗く、短期の異常検知が遅れる

監視指標:
- `unknown_guess` 比率
- 再出題到達率（タグ別/教科別）
- 日次値とミッション値の乖離

---

## 24. 実装着手チェックリスト（DoR）
- [ ] 型拡張が `npm run build` を通る
- [ ] persist migrate実装が破壊的変更を含まない
- [ ] `question_meta.ts` 初期データが優先200問分ある
- [ ] Unitテスト雛形（infer/update/threshold）が用意されている
- [ ] UI文言レビュー（小1〜2可読）を完了している

この5項目が満たされるまで、Step1の本実装は開始しない。
