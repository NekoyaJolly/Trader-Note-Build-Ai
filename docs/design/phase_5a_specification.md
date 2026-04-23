# フェーズ5A 発注仕様書: 戦略 JSON DSL と進化的探索(候補生成まで)

> **ステータス**: 実装完了
> **期間**: 実装2-3週間(完了済み)
> **目的**: 戦略を機械可読な JSON DSL で表現し、LLM を "変異オペレーター" として世代交代ループを動かす。ただし **candidate 生成までに留め、自動 confirmed 昇格は行わない**
> **前提**: フェーズ1-4(4a/4b縮小/4c/4d)完了
> **前提読み物**:
> - `docs/design/DESIGN_DOC_autonomous_trading_architecture.md` の セクション6(進化的探索ループ)
> - `docs/design/phase_5_specification_DEPRECATED.md`(旧版、参考のみ)

---

## 0. このフェーズの位置付け

### 0.1 「5A」への縮小の経緯

元々 Phase 5 仕様書では「進化ループ内で自動 confirmed まで昇格させる」設計だった。しかし実装過程で以下の設計上の問題が判明した:

**問題**: 進化ループ内の TS シミュレーションだけで confirmed に昇格すると、Phase 4c の Python 精密検証(WF/MC/BH)を通っていないため、`confirmed` の意味論がソース依存になる。

- 人間/Discovery 由来の仮説: Phase 4c のフル検証を通って confirmed
- 進化ループ由来の戦略: TS シミュレーションだけで confirmed

同じ `confirmed` ステータスなのに検証の厳格さが違う。これはエッジ台帳の信頼性を損なう。

### 0.2 採った方針: Phase 5A / 5B への分割

- **Phase 5A(このフェーズ)**: 進化ループの **candidate 生成まで** を実装。自動 confirmed 昇格は行わない
- **Phase 5B(未実装)**: 進化ループ由来 candidate を Phase 4c 精密検証に接続する仕組みを設計・実装

この分割により:
- Phase 5A で進化ループの計算機能(DSL、変異、交配、世代交代)は成立する
- `confirmed` の意味論が壊れない(全 confirmed が Phase 4c を通っている)
- Phase 5B での接続設計は落ち着いて行える

### 0.3 Phase 5A の本質

Phase 5A の本質的な成果物は **DSL と進化ループそのもの** であり、自動昇格は副次的機能だった。この整理により Phase 5A は Phase 5 の「本質」を保ったまま完結できる。

---

## 1. このフェーズのゴール

LLM の「構造の発見」能力を進化計算として活用する。単一の LLM 呼び出しでは到達しない戦略組み合わせに、**世代交代を繰り返すことで到達する** 仕組みを作る。

成果物は4つ:

1. **戦略 JSON DSL** ― 戦略を機械可読・機械実行可能な形式で表現
2. **DSLEvaluator + DSLBacktestAdapter** ― DSL に基づく条件評価とシンプルなバックテスト実行
3. **StrategyPopulation + DiversityEnforcer** ― レジーム別戦略集団管理と多様性維持
4. **EvolutionLoop(候補生成まで)** ― 選抜・変異・交配・淘汰のループ、および **昇格候補の抽出のみ**

**このフェーズで意図的にやらないこと**:
- 昇格候補の自動 confirmed 化(Phase 5B の課題)
- Phase 4c への自動接続(Phase 5B の課題)
- 複雑レンズ(エリオット、SMC)の追加(Phase 6)
- プロンプト自体の進化(Phase 6)

---

## 2. 完了条件

以下の全てを満たす:

- [x] 戦略 JSON DSL のスキーマが定義され、zod バリデーションが存在する
- [x] `DSLEvaluator` が実装され、LensFeatureSnapshot 上で AND/OR・between・in・$param を評価できる
- [x] `DSLBacktestAdapter` が実装され、OHLCV 上のシンプルな約定シミュレーションを実行できる
- [x] `StrategyPopulation` が実装され、レジーム別に戦略集団を管理できる
- [x] `DiversityEnforcer` が実装され、類似戦略を淘汰できる
- [x] LLM を使った変異オペレーター(`MutationAgent`)が実装されている
- [x] LLM を使った交配オペレーター(`CrossoverAgent`)が実装されている
- [x] `EvolutionLoop.runOneGeneration()` が実行可能で、`promotionCandidates` を返す
- [x] 自動 confirmed 昇格ロジックは含まれない
- [x] 既存テストが全て通る
- [x] 新ロジックのユニットテストがある

---

## 3. 実装ファイル構成

### 3.1 新規作成
- `src/side-b/strategy_dsl/schema.ts` — Zod スキーマ(条件グループは `z.lazy`)
- `src/side-b/strategy_dsl/DSLEvaluator.ts` — LensFeatureSnapshot 上で条件評価
- `src/side-b/strategy_dsl/dslBacktestSimulation.ts` — OHLCV 上の約定シミュレーション(`ohlcv` レンズ + 事前計算 RSI/ATR)
- `src/side-b/strategy_dsl/DSLBacktestAdapter.ts` — `fetchHistoricalData` 後にシミュレーション、学習70%/検証30%、`runWithParameterSweep`
- `src/side-b/strategy_dsl/dslParameterUtils.ts` — 既定パラメータ展開
- `src/side-b/strategy_dsl/index.ts`
- `src/side-b/evolution/StrategyPopulation.ts` — レジーム別集団、`removeWorst`、`save`/`load`
- `src/side-b/evolution/DiversityEnforcer.ts` — 類似度・`filterDiverse`
- `src/side-b/evolution/EvolutionLoop.ts` — 1世代実行(評価→エリート/淘汰→変異/交配→多様性→**昇格候補抽出**)
- `src/side-b/evolution/evolutionScore.ts` / `evolutionPromotionThresholds.ts`
- `src/side-b/evolution/dslEdgeMapper.ts` — DSL → MachineReadableCondition(Phase 5B 復活用に残置)
- `src/side-b/evolution/index.ts`
- `src/side-b/agents/MutationAgent.ts`
- `src/side-b/agents/CrossoverAgent.ts`
- `src/side-b/prompts/mutation.md`
- `src/side-b/prompts/crossover.md`

### 3.2 改修
- `src/side-b/jobs/sideBScheduler.ts` — `autoEvolution: false` 既定、`evolutionRegimes`、`startEvolutionJob` / `runEvolutionNow`

### 3.3 テスト
- `src/side-b/tests/strategy_dsl/dslEvaluator.test.ts`
- `src/side-b/tests/strategy_dsl/dslBacktestAdapter.test.ts`
- `src/side-b/tests/evolution/diversityEnforcer.test.ts`
- `src/side-b/tests/evolution/evolutionLoop.test.ts`(バックテスト・LLM はモック)

---

## 4. 設計仕様

### 4.1 戦略 JSON DSL

戦略を機械可読な形式で表現する。zod でスキーマバリデーション。

主要構造:
- `id`: 戦略の一意 ID
- `metadata`: 説明、由来、作成時刻等
- `regimeTarget`: 対象とする市場レジーム
- `entryConditions`: エントリー条件(ConditionGroup 構造、AND/OR 入れ子可能)
- `exitConditions`: 決済条件
- `riskManagement`: SL/TP/最大保有時間
- `parameters`: 可変パラメータ(進化でチューニング対象)

条件式は以下を評価可能:
- 数値比較(`>`, `<`, `>=`, `<=`, `==`)
- 範囲(`between`)
- 集合(`in`)
- パラメータ参照(`$param`)
- 論理演算(AND/OR の入れ子)

### 4.2 DSLEvaluator

LensFeatureSnapshot を入力として DSL の条件群を評価する決定論的コンポーネント。

### 4.3 DSLBacktestAdapter

専用のバックテスト経路。理由:

- 既存の Side-A backtestService(noteId 依存)や strategyBacktestService(ConditionGroup 依存)には DSL を直接渡せない
- Phase 4c の Python ツール群(vectorbt)は精密検証用で、進化ループの高頻度実行には不向き
- 進化ループは毎世代数十戦略を評価するため、軽量な TS シミュレーションが必要

実装方針:
- `fetchHistoricalData` で OHLCV 取得
- 学習 70% / 検証 30% で分割
- 学習期間でパラメータスイープ(`runWithParameterSweep`)
- `PF=Infinity` 時は `safeProfitFactor` で過学習スコアが壊れないよう調整

### 4.4 EvolutionLoop

1世代の実行フロー:

1. 現集団をバックテストで評価(TS シミュレーション)
2. エリート保存 + 淘汰
3. LLM による変異(MutationAgent)
4. LLM による交配(CrossoverAgent)
5. DiversityEnforcer で多様性維持
6. **昇格候補の抽出(厳格 3 条件)**
7. GenerationReport を生成

**昇格基準**(Phase 4c と数値整合):
- 学習 PF > 1.5
- 検証 PF > 1.3
- 過学習スコア < 0.3

**重要**: この条件を満たした戦略は `promotionCandidates` 配列に積まれる。**自動で EdgeLedger に登録・confirmed 化はしない**。将来の Phase 5B 接続用に以下のメタ情報を保持:

```typescript
interface EvolutionPromotionCandidate {
  dslId: string;                  // 戦略 DSL の一意 ID
  source: 'evolution';            // Phase 5B で source として使用
  regime: string;
  symbol: string;
  timeframe: string;
  trainPf: number;
  validationPf: number;
  overfitScore: number;
  validationTradeCount: number;
  description?: string;
}
```

### 4.5 GenerationReport

各世代の実行結果を `data/evolution/strategy-population.json` に保存:

- 実行時刻、レジーム、世代番号
- 評価されたすべての戦略スコア
- `promotionCandidates`: 昇格候補の配列
- エリート、淘汰、変異・交配の記録

**注**: 旧仕様の `promotedToLedger: number` フィールドは廃止された(Phase 5A で自動昇格を行わないため)。

### 4.6 LLM オペレーター

MutationAgent と CrossoverAgent はともに:
- `loadPrompt()` + `AIProvider`
- JSON パース(3回リトライ)
- モック LLM での動作確認可能

プロンプトファイル: `src/side-b/prompts/mutation.md`, `crossover.md`(日本語)

### 4.7 スケジューラー

`sideBScheduler.ts` に以下を追加:
- `autoEvolution: false`(既定値)
- `evolutionRegimes`(対象レジームリスト)
- `startEvolutionJob()`: 自動ジョブ起動(autoEvolution=true 時のみ)
- `runEvolutionNow()`: 手動トリガー(デバッグ・運用用)
- レジーム間のスリープ 30秒(LLM コスト配慮)

### 4.8 Phase 5A で扱わないもの

実装意図的に含めない機能:

- `EdgeLedger.create()` + `markConfirmed()` の自動呼び出し(Phase 5B 課題)
- スケジューラーから EdgeLedger への自動登録(Phase 5B 課題)
- `EdgeValidatorAgent` の統合(Phase 4c の StrategistAgent がその役割)
- `promotedToLedger` カウンタ(廃止、`promotionCandidates` 配列に置換)

---

## 5. 実装上の制約事項

### 5.1 守った制約

- **Phase 4c の検証基盤に手を入れない**: Python ツール、StrategistAgent 等は変更なし
- **EdgeLedger の DB スキーマに変更を加えない**: candidate は JSON レポートに留める
- **既存テストが壊れない**: 513 passed 維持

### 5.2 将来の拡張余地(Phase 5B で扱う)

- 進化ループ由来 candidate を Phase 4c 精密検証に接続する仕組み
- `screening_passed` に相当する新ステータスの要否検討
- 進化由来 confirmed と人間由来 confirmed の区別方法
- candidate の EdgeLedger 登録タイミング(登録するなら unverified、しないなら JSON のみ)

---

## 6. 運用上の注意

### 6.1 進化ループ起動

デフォルトでは自動起動しない。起動するには:

```typescript
const scheduler = new SideBScheduler({ 
  autoEvolution: true,
  evolutionRegimes: ['trending', 'ranging', ...],
});
```

または手動トリガー:

```typescript
await scheduler.runEvolutionNow();
```

### 6.2 コスト配慮

進化ループは LLM 呼び出しが多い(変異 + 交配 × 集団サイズ)。autoEvolution を有効化する際は:

- 本番 LLM API のコスト見積もりを事前に確認
- レジーム数と集団サイズを調整
- スリープ(30秒)が入っているが、必要に応じて延長

### 6.3 UI 表示の注意

進化ループ由来の戦略が仮に EdgeLedger に入った場合(現状は入らない設計):

- `statement` に `[DSL:uuid] 説明文` 形式で DSL ID を埋め込むパターンがある
- UI 側で `parseEvolutionStatement()` ヘルパーを使い、表示時にプレフィックスを除去
- 詳細は Phase 4d の UI 改修履歴を参照

---

## 7. Phase 5B への引き継ぎ

Phase 5B で検討・設計すべき事項:

### 7.1 設計課題

1. **candidate の EdgeLedger 登録方針**
   - a) unverified として登録 → Phase 4b スクリーニング経由で検証
   - b) screening_passed 相当の新ステータス → Phase 4c 直接投入
   - c) 専用ステータス(例: `evolution_candidate`)の新設
   - d) 登録せず JSON レポートのまま、UI で別表示

2. **EdgeSource 型への 'evolution' 追加**
   - 現状は 'backtest' で代用されている
   - マイグレーション影響の評価

3. **Phase 4c との接続実装**
   - StrategistAgent.validate() を直接呼ぶか
   - MaterializationService でまず TradeNote 化するか
   - Python ツール群に直接 DSL を渡せるか

### 7.2 参考資料

- `src/side-b/evolution/dslEdgeMapper.ts`(DSL → MachineReadableCondition、Phase 5B 復活用に残置済み)
- `EvolutionPromotionCandidate` 型(Phase 5B で使用する想定で設計済み)

### 7.3 実装タイミング

- Phase 6 と並行 or Phase 6 完了後
- 運用観察で「進化ループ候補が何件出るか」「品質はどうか」を見てから設計
- 急がない(現状 autoEvolution=false で実害なし)

---

## 8. このフェーズで得られた知見

### 8.1 「縮小」の価値

当初仕様の「自動 confirmed」を切り離したことで:

- confirmed の意味論を保てた
- Phase 4b/4c への影響を回避できた
- Phase 5A の本質(DSL と進化ループ)は損なわれなかった

**急いで作ろうとすると意味論が壊れる**。この経験は Phase 6 以降の設計でも活きる。

### 8.2 仕様書の盲点

Phase 5 旧仕様では DSL → EdgeHypothesis のデータ構造境界が暗黙化されていた。これが `[DSL:uuid]` プレフィックス問題を生んだ。

**教訓**: データ構造の境界を跨ぐ箇所は、必ず詳細仕様を書く。

### 8.3 他 AI との壁打ちの価値

Phase 5A への縮小判断は、他 AI との壁打ちで得られた指摘(「数値閾値が近いことと同じ検証経路を通ったことは別」)が決め手となった。設計者の盲点を外部視点で補う手法として有効。
