# フェーズ 6.6 発注仕様書: variantSelector の実エージェント接続

> **期間目安**: 半日〜1日
> **目的**: Phase 6 で作ったプロンプト進化基盤を実エージェントに接続し、experimental プロンプトの実運用を開始する
> **前提**: Phase 6, 6.5, 6 hotfix 完了

---

## 0. このフェーズの位置付け

### 0.1 これまでの経緯

Phase 6 でプロンプト進化基盤を実装したが、`variantSelector` を実エージェントに接続する作業は MVP 外として明記されていた。そのため現状は「**箱だけあって動いてない**」状態:

- PromptRegistry: バージョン管理してる(箱はある)
- ABTestRunner: 実装済み(動かす相手がいない)
- PromptMutationAgent: 改善案を生成できる(でもどのエージェントも experimental プロンプトを使ってない)
- 各エージェント: active プロンプトしか使ってない(進化が回ってない)

このフェーズで **プロンプト進化の輪を閉じる**。

### 0.2 何を実現するか

各エージェント呼び出し点で:

1. `getActive` + `getExperimental` でプロンプト候補を取得
2. `selectVariant` でどのプロンプトを使うか確率的に決定(experimental は 20%以下)
3. 選択したプロンプトでエージェントを実行
4. 結果を即時スコアリングして `recordUsage` に記録
5. experimental が失敗したら active で自動再試行

これにより、月次の `PromptMutationAgent` で生成された experimental プロンプトが実際に試され、成績が蓄積される。

---

## 1. このフェーズのゴール

完了時点で以下が成立する:

- 4 体のエージェントで experimental プロンプトの実運用が始まる
  - HypothesisGeneratorAgent
  - TrendSpecialist
  - OscillatorSpecialist
  - VolatilityVolumeSpecialist
- experimental プロンプトの使用率が 20% 以下に制御されている
- experimental 失敗時に active で自動フォールバックする
- スコアリング結果が即時記録される
- 最近のスコアリング結果を確認する CLI コマンドが提供される
- 既存テストが全て通る(回帰ゼロ)

---

## 2. 完了条件

- [ ] 上記 4 体のエージェントが variantSelector 経由でプロンプトを選択している
- [ ] experimental 使用率 20% 以下が保証されている
- [ ] experimental 失敗時に active での自動再試行が動作する
- [ ] スコアリング関数が即時呼ばれて recordUsage に結果が記録される
- [ ] スコアリング結果確認用の CLI コマンドが動作する
- [ ] 新規テストケース追加(統合テスト含む)
- [ ] 既存 1136 テスト全通過(回帰ゼロ)
- [ ] Side-A 無変更

---

## 3. 実装仕様

### 3.1 接続対象エージェント

以下の 4 体に variantSelector 接続を実装する:

- `HypothesisGeneratorAgent` (`src/side-b/agents/HypothesisGeneratorAgent.ts`)
- `TrendSpecialist` (`src/side-b/agents/specialists/TrendSpecialist.ts`)
- `OscillatorSpecialist` (`src/side-b/agents/specialists/OscillatorSpecialist.ts`)
- `VolatilityVolumeSpecialist` (`src/side-b/agents/specialists/VolatilityVolumeSpecialist.ts`)

選定理由: Phase 6 で `scoringFunctions.ts` にスコアリング関数を実装した 4 体。それ以外のエージェントへの接続は将来拡張(別フェーズ)。

### 3.2 接続パターン

各エージェントの実行点で以下のパターンを挿入:

```typescript
// 1. プロンプト候補取得
const active = await promptRegistry.getActive(agentName);
const experimentals = await promptRegistry.getExperimental(agentName);

// 2. variant 選択(experimental は 20% 以下)
const selected = variantSelector.selectVariant(active, experimentals);

// 3. 選択したプロンプトで LLM 呼び出し
let result;
let usedVariantId = selected.id;
let succeeded = false;
try {
  result = await this.ai.chat([
    { role: 'system', content: selected.content },
    { role: 'user', content: userPrompt },
  ], { maxTokens: 4096, temperature: ... });
  
  // 4. 即時スコアリング
  const score = scoringFunctions[agentName](result);
  await promptRegistry.recordUsage(usedVariantId, score, true);
  succeeded = true;
} catch (error) {
  // 5. experimental 失敗時の active フォールバック
  if (selected.id !== active.id) {
    await promptRegistry.recordUsage(usedVariantId, 0, false);
    // active で再試行
    result = await this.ai.chat([
      { role: 'system', content: active.content },
      { role: 'user', content: userPrompt },
    ], { maxTokens: 4096, temperature: ... });
    usedVariantId = active.id;
    const score = scoringFunctions[agentName](result);
    await promptRegistry.recordUsage(usedVariantId, score, true);
    succeeded = true;
  } else {
    throw error; // active 自体が失敗したら諦めてエラー伝播
  }
}
```

### 3.3 variantSelector の動作仕様(既存実装の確認)

Phase 6 で実装済みの `variantSelector.selectVariant(active, experimentals)` の挙動:

- `experimentals` が空 → `active` を返す
- `experimentals` がある → 20% の確率で experimental から1つ選択(確率的選択)、80% の確率で active を返す
- 確率は `Math.random()` ベース

この既存実装をそのまま使う。

### 3.4 スコアリング関数(既存実装を使用)

Phase 6 で `scoringFunctions.ts` に実装済みの関数を呼ぶ:

- `hypothesis_generator`: 仮説の数、フォーマット遵守、JSON妥当性等
- `trend_specialist`: TrendAnalysis スキーマ遵守、必須フィールド存在等
- `oscillator_specialist`: OscillatorAnalysis スキーマ遵守
- `volatility_volume_specialist`: VolatilityVolumeAnalysis スキーマ遵守

スコアは 0-1 の範囲。失敗時は score=0, success=false で記録。

既存実装で機能不足な場合は最小限の追加のみ(スコアリング関数の大幅改修はこのフェーズ外)。

### 3.5 フォールバック挙動

**experimental が失敗した場合**:

1. recordUsage に `(experimentalId, score=0, success=false)` を記録
2. active プロンプトで再実行
3. active での結果に対して通常通りスコアリング・recordUsage

**active が失敗した場合**:

1. エラーを上位に伝播(リトライしない)
2. 既存のエラーハンドリングに任せる

「失敗」の定義:
- LLM 呼び出し自体のエラー(API エラー、タイムアウト等)
- パース失敗(Phase 6 hotfix の `extractJson` で例外)
- スコアリング関数が「最低基準未満」と判定(例: 必須フィールド欠落)

### 3.6 スコアリング結果確認用 CLI

新規 CLI コマンドを追加:

`src/side-b/cli/showRecentScoring.ts`(新規)

```typescript
// 使用例
// $ npm run cli:show-scoring -- --agent hypothesis_generator --limit 20
// $ npm run cli:show-scoring -- --all
```

機能:
- 最近の recordUsage 記録を一覧表示
- エージェント別フィルタリング
- 表示項目: timestamp, agentName, promptVersion, score, success, status
- 集計表示: experimental vs active の平均スコア比較

このコマンドにより、ユーザーが「スコアリングが妥当に動いてるか」を目視確認できる。

### 3.7 テスト追加

**ユニットテスト**:
- variantSelector の確率的挙動(20% 制限)
- フォールバック動作(experimental 失敗 → active 成功)
- フォールバック失敗(experimental + active 両方失敗 → エラー伝播)

**統合テスト**(各エージェント別):
- HypothesisGenerator の variantSelector 接続動作
- 3 専門家の variantSelector 接続動作
- 上記での recordUsage 呼び出し確認(モック)

**実 LLM テスト**(可能なら):
- HypothesisGenerator を実 OpenRouter で呼び出し、experimental が選ばれた場合の挙動確認
- スコアリング結果が妥当か手動確認

### 3.8 パフォーマンス考慮

- `getActive` / `getExperimental` の DB アクセスがエージェント呼び出しのたびに発生
- 性能影響を最小化するためにキャッシュを検討(ただし MVP では実装しない)
- 月次更新なので頻繁にキャッシュ無効化は不要

このフェーズでは性能最適化は行わない。動作観察で問題が見えたら別タスクで対応。

---

## 4. 触っていいファイル

### 触っていい(改修)

- `src/side-b/agents/HypothesisGeneratorAgent.ts`: variantSelector 接続パターン挿入
- `src/side-b/agents/specialists/TrendSpecialist.ts`: 同上
- `src/side-b/agents/specialists/OscillatorSpecialist.ts`: 同上
- `src/side-b/agents/specialists/VolatilityVolumeSpecialist.ts`: 同上
- `src/side-b/agents/specialists/specialistCommon.ts`: 共通処理に variantSelector 統合する場合

### 触っていい(新規)

- `src/side-b/cli/showRecentScoring.ts`: 新規 CLI コマンド
- `src/side-b/tests/integrations/variantSelectorIntegration.test.ts`: 統合テスト
- 必要に応じて新規テストファイル

### 触ってはいけない

- Phase 1-5 系の成果物
- Phase 6 で作った PromptRegistry, ABTestRunner, PromptMutationAgent, MetaEvolutionAgent
- Phase 6 で作った scoringFunctions.ts(MVP では使うだけ、改修しない)
- Phase 6 で作った variantSelector.ts(使うだけ、改修しない)
- Phase 6 hotfix で作った llmJsonExtract.ts(使うだけ)
- Side-A 全般
- prisma/schema.prisma(DB スキーマ変更不要のはず)

---

## 5. 設計上の注意

### 5.1 このフェーズでやらないこと

- 接続対象エージェントの拡大(現状 4 体のみ、他は将来拡張)
- スコアリング関数の改修(既存を使う)
- 後追いスコアリング(MVP として即時のみ)
- パフォーマンス最適化(キャッシュ等)
- UI 統合(CLI のみ、Phase 4d UI への組み込みは別フェーズ)

### 5.2 設計の本質

このフェーズの本質は「**プロンプト進化の輪を閉じる**」こと:

- Phase 6 で作った進化基盤を実際に動かす
- experimental プロンプトが実運用される
- 成績データが蓄積される
- 月次の PromptMutationAgent が次の改善案を生成
- このサイクルが回り始める

ただし **効果が劇的に出るかは不明**。プロンプトの 5-10% 改善が confirmed エッジ数の何%増加に繋がるかは実証されてない。実装後の運用観察で評価する。

### 5.3 ユーザー(あなた)の確認フロー

実装直後のフェーズ:

1. 実装完了
2. しばらく実運用(experimental プロンプトが実際に試される)
3. ユーザーが `cli:show-scoring` コマンドでスコアリング結果を確認
4. 「スコアリングが妥当に動いてる」「experimental の効果が見える」と判断できたら継続
5. 判断できなければスコアリング関数の見直し(別タスク)

最初の数週間〜1ヶ月は **観察期間**。完全自動化は焦らない。

### 5.4 既存エージェントの後方互換

variantSelector 接続を追加するが、既存の呼び出しコードが破壊されないこと:

- 各エージェントの公開インターフェースは変更しない
- 内部実装でプロンプト選択ロジックが変わるだけ
- 既存テストが全て通ること

---

## 6. 実装順序(推奨)

### ステップ 1: variantSelector 接続パターンの確立

1. HypothesisGeneratorAgent で接続パターンを実装
2. ユニットテストで動作確認
3. パターンが妥当か検証(コードレビュー観点)

### ステップ 2: 専門家 3 体への展開

1. specialistCommon.ts に共通処理を抽出する場合は実装
2. TrendSpecialist, OscillatorSpecialist, VolatilityVolumeSpecialist に接続
3. ユニットテスト追加

### ステップ 3: フォールバック挙動の実装

1. experimental 失敗時の active 再試行ロジック
2. テストケース追加(失敗パターン3種類)

### ステップ 4: CLI コマンド実装

1. `showRecentScoring.ts` 実装
2. 動作確認

### ステップ 5: 統合テストと動作確認

1. 統合テスト追加
2. 既存全テスト通過確認
3. 可能なら実 OpenRouter での動作確認

各ステップでコミット。

---

## 7. 完了報告に含めること

1. 変更したファイル一覧
2. 新規ファイル一覧
3. 接続したエージェント 4 体それぞれの実装ポイント
4. variantSelector の選択動作確認(20% 制限が動いてるか)
5. フォールバック動作確認
6. スコアリング関数呼び出しの確認
7. CLI コマンドの動作例
8. 全テスト通過確認
9. 実 OpenRouter 動作確認結果(可能なら)
10. 次のフェーズへの引き継ぎメモ

---

## 8. レビュー観点

- variantSelector 接続パターンが 4 体に正しく適用されているか
- experimental 使用率の 20% 制限が機能しているか
- フォールバック挙動が想定通りか
- スコアリング関数の呼び出しタイミングが正しいか
- recordUsage に正しく記録されているか
- CLI コマンドで結果確認できるか
- 既存テストが全て通っているか
- Side-A に変更がないか

---

## 9. 将来拡張(このフェーズの範囲外)

### 9.1 接続対象エージェントの拡大

現状 4 体のみ。将来:

- StrategistAgent, DiscoveryAgent, DevilsAdvocateAgent
- MutationAgent, CrossoverAgent
- PromptMutationAgent 自身(メタ的)
- MetaEvolutionAgent 自身

各エージェントにスコアリング関数を追加してから接続する。

### 9.2 後追いスコアリング

即時スコアリングは「構文・フォーマット」レベル。後追いは「実際の戦略 confirmed 率」等。

実装イメージ:
- HypothesisGenerator が出した仮説 → 検証パイプラインを通って confirmed/rejected
- その結果を仮説生成時のプロンプトバージョンに紐付けて recordUsage を更新
- 因果関係を追える設計が必要(複雑)

### 9.3 自動承認モード

現状: experimental → active への昇格は人間承認必須

将来: 一定期間運用して安定したら自動承認モード追加

### 9.4 パフォーマンス最適化

- プロンプトキャッシュ
- recordUsage のバッチ書き込み
- DB アクセス頻度削減

---

## 10. このフェーズの位置付け(設計書全体の中で)

- Phase 1-5.5: 観察、検証、進化、スキルの土台
- Phase 6: エージェント自身の改善機構の **箱**
- Phase 6.5: モデル選択の整理
- Phase 6 hotfix: パース層の堅牢化
- **Phase 6.6(本フェーズ): 進化基盤を実エージェントに接続、輪を閉じる**

これ以降:
- 運用観察期間
- 効果見えてきたら接続対象拡大、自動承認モード等
- 並行して Phase 7(SMC), Phase 8(Elliott), Phase 9(ファンダメンタルズ)等に進む

---

*Phase 6.6 完了時点で、Phase 6 で作った進化基盤が初めて意味を持つ。「箱だけ」状態から「実際に動く改善ループ」への転換点である。ただし効果の有無は運用観察で評価する。*
