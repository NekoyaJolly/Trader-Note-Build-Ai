# エージェントループ特化レビュー + 実装計画 (2026-05-09)

> 静的レビュー (コード読みのみ) + Filter Evolution M2/M3/M4 マージ直後時点の現状診断。
> Nekoさん の主観: (a) 本番 cron で validationConfirmed が伸びない、(b) smoke で Win Rate Lift が notComputable ばかり、(c) PDCA と進化ループが学ばない感じ。
> 範囲: 「学ぶエージェントループ」まで (= 1 ヶ月規模の実装計画)。

---

## 0. TL;DR

3 症状は **同じ 1 つの根本問題** に紐づく:

> **本番経路で「世代を跨ぐ仕組み」が動いていない**。`tradesByDslId` / `lastRepairHints` / `lastRepairBaselines` / QD-Archive はすべて `EvolutionLoop` インスタンス内 in-memory で、`sideBScheduler.runEvolutionNow` (`src/side-b/jobs/sideBScheduler.ts:847-880`) は cron 起動毎に新しい EvolutionLoop を作って **1 世代だけ実行** している。`multiGenerationRunner` は smoke でしか使われていない。

結果として:
- Filter Evolution M2 (Win Rate Lift) は **本番で永遠に notComputable**。Gen 1 は親 trades が前世代に存在しないのが正常仕様 (`EvolutionLoop.ts:841-843` のコメント) で、本番が常に Gen 1 相当だから。
- M3 で渡される `parentLossTrades` は **本番では常に空 Map**。crossover が「親 A の負けトレードを除去する filter を作る」設計の入力データ自体が来ていない。
- RepairHint / RepairOutcome / QD-Archive も全て同じ理由で本番では空運転。

加えて構造的に:
- PDCALoop が EvolutionLoop の世代結果を知る経路が無い (= notify hook 5 種に Evolution 結果なし)
- AgentMemory の `lessons` (Reflection AI が積む) が mutation/crossover に流れない (= API はあるのに配線なし)

**結論**: コードはほぼ揃っている。**配線が抜けている**。今後 1 ヶ月の Phase A〜E で、現有部品を本番で「学ぶエージェントループ」として動作させる。Setup 側 (= novelty seed / HypothesisGenerator) の質改善は本診断のスコープ外で、Phase A〜E が動いた後に観測ベースで議論する。

---

## 1. 現状診断 (= コード読みで判明した事実)

### 1.1 Filter Evolution M2/M3/M4 は smoke でしか動いていない

最新の本番 scheduler の進化ループ起動箇所 (`src/side-b/jobs/sideBScheduler.ts:826-885`):

```typescript
async runEvolutionNow(): Promise<{ regimeReports: number; errors: string[] }> {
  // ... population / period 構築 ...
  const loop = new EvolutionLoop({
    population, adapter, mutationAgent, crossoverAgent, enforcer,
    defaultPeriod, oosBacktestRunner: defaultOosBacktestRunner,
  });
  for (const regime of regimes) {
    const report = await loop.runOneGeneration(regime);  // ← 1 世代だけ
    // ...
  }
}
```

一方、smoke スクリプト (`scripts/evolution-pdca-smoke.ts:52-55`) は明示的に `multiGenerationRunner` を import し、`--generations 2+` で `runMultiGenerationEvolutionV1` を呼ぶ。本番 scheduler では multi-gen runner が一切使われていない。

### 1.2 in-memory cache の実態

EvolutionLoop には世代を跨ぐ前提の cache が 4 系統あるが、すべてインスタンス内 in-memory:

| Cache | 場所 | 用途 |
|---|---|---|
| `tradesByDslId` | `EvolutionLoop.ts:459` (`private tradesByDslId: Map<...>`) | M2 Win Rate Lift の親 trades 参照、M3 親 loss trades 抽出 |
| `lastRepairHints` | `EvolutionLoop.ts:433` | PR #100 RepairHint の世代継承 |
| `lastRepairBaselines` | `EvolutionLoop.ts:440` | PR #102 RepairOutcome baseline |
| QD-Archive state | (multi-gen runner 内) | PR #108 archive 全体の state |

cron 起動毎に `new EvolutionLoop(...)` で新規作成されるため、**全 cache が初期化される**。本番の Gen 1 は Filter Evolution の観測ログ条件下で:
- `parentLossTrades` = 空 Map (`EvolutionLoop.ts:720-731`、parent が tradesByDslId に未登録)
- Win Rate Lift = 全件 `notComputable: parent has no formal BT result in this evolution run` (`EvolutionLoop.ts:854-858`)
- RepairHint = 渡されない (mutation 側で `repairHintsForMutation.size > 0` 条件、`EvolutionLoop.ts:695`)

これが「smoke で Win Rate Lift が notComputable ばかり」の正体。**Gen 2+ を回さない限り出ない**。

### 1.3 PDCA ↔ Evolution の通知経路は片道のみ

`grep notify` で sideBScheduler の通知 hook を全列挙した結果:

| 行 | 通知方向 | 内容 |
|---|---|---|
| `:663` | scheduler → PDCA | スクリーニングバッチ完了 |
| `:758` | scheduler → PDCA | フル検証バッチ完了 |
| `:1201` | scheduler → PDCA | トレード完了 |
| `:1377` | scheduler → PDCA | Research AI 完了 |
| `:1380` | scheduler → PDCA | Plan AI (戦略立案) 完了 |

EvolutionLoop の世代結果 (`GenerationReport`) を PDCA に流す hook は **存在しない**。`runEvolutionNow` (`:828-885`) はループ内で `this.log(...)` するだけで、PDCA の `addThinkingLog` も `notifyXxx` も呼ばない。

つまり PDCALoop は「進化ループが何世代回って何件 confirmed が出たか」を知らない。AgentMemory も同様。

### 1.4 AgentMemory の lessons は mutation/crossover に流れない

`agentMemory.ts` には既に学習機構がある (確認済):

- `addLesson(lesson, symbol, noteId)` (`:379`) — Reflection AI が呼ぶ
- `getLessonsForStrategy(symbol?)` (`:534`) — 「確信ルール / [symbol] / 他銘柄」の形式で string[] を返す
- `lessonsBySymbol` (`:172`) — symbol 別 + 確信ルール (回数閾値超え)

ところが `MutationAgent.ts` / `CrossoverAgent.ts` のどちらにも `agentMemory` の import はない。**mutation/crossover の prompt に「過去の学び」が入る経路が物理的に切れている**。

CLAUDE.md 原則 5 「人間との共通言語を維持する」/ DESIGN_DOC §1.2 「言語化されたものだけを極端に高速に回すのが AI の戦い方」と整合させるなら、ここは最重要の接続箇所のはず。

### 1.5 世代単位 reflection エージェント不在

現状の Reflection AI (`reflectionAIService`) は **個別トレード単位**で発火 (`pdcaLoop.ts:383-435` の `handleReflecting`)。`GenerationReport` 全体を input にした「世代 reflection」エージェントは存在しない。

Reflexion (Shinn et al. 2023, [arxiv:2303.11366](https://arxiv.org/abs/2303.11366)) の核心は Self-Reflection model が **世代/エピソード単位**で verbal reinforcement cues を生成すること。本実装では世代単位の reflection が空席。

### 1.6 mutation 撤廃判断の保留と本診断の関係

memory `project_filter_evolution_progress.md` (2026-05-09) で「mutation 撤廃は M3 + 本番スモーク後に再判断、撤回・後ろ倒し」と決めている。

**本診断の含意**: 「本番スモーク」が実際には mutation/crossover を「世代を跨ぐ前提」で評価しないと意味のあるデータにならない。Phase A (本番 multi-gen 化) を先にやらないと、mutation 撤廃判断の前提条件 (= filter Evolution が 1 周回った状態) が満たせない。**Phase A は mutation 処遇判断の必要条件**。

---

## 2. 根本原因の構造的説明

### 2.1 Critical-4 PR シーケンスは「multi-gen 前提」

PR #100 以降の各機能は、世代を跨いで意味を成す:

- **PR #100 RepairHint**: 前世代の failed candidate metrics を mutation の入力に
- **PR #102 RepairOutcome**: 前世代 baseline と当世代 child の比較
- **PR #103 OOS Validation**: 各世代で `validation_candidate` を OOS 評価
- **PR #105 OOS-aware Promotion**: OOS 結果を反映した stage 遷移
- **PR #106 Multi-generation Runner**: 世代間引き継ぎオーケストレーター
- **PR #107 Adaptive Repair Budget**: 過去世代の trend から次世代の budget を算出
- **PR #108 QD-Archive**: 世代を跨ぐ behavior cell 保持
- **Filter Evolution M2 (PR #135)**: 親 trades と子 trades の比較 = 世代間差分

**全部、Gen 2+ で初めて意味がある**。Gen 1 では空運転または初期値で済む設計。

ところが本番 scheduler は Gen 1 だけ。**「Critical-4 シリーズ全部が本番で空運転」**という構造になっている。

### 2.2 Reflexion / FunSearch / MAP-Elites も同じ構造

本実装が概念的に取り込んでいる学術パターン (前回レビュー §2.8 参照) は、すべて **世代/トライアルを跨ぐ memory** を必要とする:

| Pattern | 必要な memory |
|---|---|
| Reflexion (Shinn et al. 2023) | episodic memory buffer (= 過去 trial の verbal feedback) |
| FunSearch (Romera-Paredes et al. 2024) | island-based program pool (= 過去最高プログラムを次に注入) |
| MAP-Elites (Mouret & Clune 2015) | behavior archive (= 過去全 cell の elite) |
| Novelty Search (Lehman & Stanley 2008) | archive of past behaviors (= 距離計算の基準) |

すべて in-memory のみ実装で、本番で動かない状態。

### 2.3 PDCA は「実行」、Evolution は「探索」、双方の情報共有なし

PDCALoop は「セッション開始 → 監視 → ポジション管理 → 振り返り」という **実トレード loop**。EvolutionLoop は「seed → 評価 → 選抜 → 変異 → 再評価」という **探索 loop**。両者は理論的には独立で良いが、現実装では:

- 探索 loop の発見 (= confirmed エッジ) が実 loop に流れない
- 実 loop の振り返り (= lessons) が探索 loop に流れない

**双方が学んでも、共有されない**。CLAUDE.md 原則 6 「勝ちを急がない、エッジ台帳の成長速度を最大化する」が意図する「両 loop が共有する台帳」が、運用上は分断されている。

---

## 3. 到達像 = 「学ぶエージェントループ」の定義

### 3.1 構成図

```
┌─────────────────────────────────────────────────────────────┐
│  PDCALoop (実トレード loop)                                  │
│   IDLE → SESSION_OPEN → MONITORING → MANAGING_POSITION       │
│        → REFLECTING → REVISING_STRATEGY → ...                │
│                                                              │
│   notify hook (既存):                                         │
│     - notifyAnalysisComplete                                 │
│     - notifyStrategyComplete                                 │
│     - notifyTradeCompleted                                   │
│     - notifyValidationBatchComplete                          │
│   ★ 追加 ★:                                                   │
│     - notifyEvolutionGenerationComplete (Phase E)            │
└──────────────┬───────────────────────────────────────────────┘
               │ Reflection AI (個別 trade)
               ▼
        ┌─────────────────────┐
        │ AgentMemory          │
        │  - lessonsBySymbol  │  ← Reflection AI が積む (既存)
        │  - 確信ルール        │
        │  ★ generationLessons │ ← 世代 reflection が積む (Phase D)
        └─────────────┬───────┘
                      │ getLessonsForStrategy(symbol)
                      │ ★ getGenerationLessons() (Phase D)
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  EvolutionLoop (探索 loop)                                   │
│   ★ Phase A: 本番でも multiGenerationRunner で Gen N まで回る │
│   ★ Phase B: tradesByDslId / RepairHint / QD-Archive を      │
│                EvolutionBacktestRun + 新規テーブルに永続化    │
│   ★ Phase C: lessons を mutation/crossover prompt に注入      │
│   ★ Phase D: 各世代の GenerationReport を input にした        │
│                GenerationReflectionAgent が走る              │
│                                                              │
│   notify hook (新設、Phase E):                                │
│     - PDCALoop.notifyEvolutionGenerationComplete             │
│     - AgentMemory.recordEvolutionInsight                     │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 各構成要素の責務

| コンポーネント | 責務 | 現状 | 到達像 |
|---|---|---|---|
| PDCALoop | 実トレードの状態機械 | 動作中 (一部空実装あり) | Phase E で Evolution 通知を受ける |
| Reflection AI | 個別 trade からの学び抽出 | 動作中 | (変更なし) |
| **GenerationReflectionAgent** | 世代単位の振り返り | 不在 | Phase D で新設 |
| AgentMemory | lessons の symbol 別蓄積 | 動作中 | Phase D で `generationLessons` 追加 |
| EvolutionLoop | 1 世代の進化計算 | 動作中 | Phase A-C で本番統合 |
| multiGenerationRunner | N 世代オーケストレーション | smoke のみ | Phase A で本番統合 |
| MutationAgent | LLM 変異 | lessons 非接続 | Phase C で lessons 注入 |
| CrossoverAgent | LLM 交配 + filter 追加 (M3) | parentLossTrades が本番空 | Phase B で実データ供給 + Phase C で lessons 注入 |

### 3.3 学習が成立する条件 (= 観測可能な定量基準)

「学ぶ」を主観で判断しないための、コードで観測可能な基準:

1. **Win Rate Lift が notComputable 以外の値を出す比率** が世代を進めるほど上がる
   - Gen 2 で全候補の 50% 以上が Lift を計算できる (= 親 trades が cache に乗っている)
   - Lift の中央値が 1.0 を上回る

2. **promotion top-K に届く child の crossover/mutation 比率** が時間とともに改善
   - Filter Evolution 設計書 §0.1 の表で「世代 4-5 で 0 件」だった validationConfirmed が、Gen 2+ で 1 件以上を維持

3. **同 symbol の Reflection AI lessons が次の mutation 出力に反映**
   - 例: lessons に「金曜日のレンジ騙し」が複数回出ていたら、mutation/crossover の出力 DSL に `time_session.is_friday_close` の filter が高頻度で含まれる

4. **GenerationReflectionAgent の出力が累積**
   - 例: 「Gen 3 で QD-Archive cell が breakthrough した」「Gen 5 で reverse 系戦略が消滅した」のような世代単位 insight が `generationLessons` に積まれる

これらが定量的に確認できれば、「学んでいる」と言える。**Phase A〜E 完了後 1-2 ヶ月の観察フェーズで判定**する。

---

## 4. 実装ロードマップ (5 Phase)

### 4.1 全体感

| Phase | 内容 | 工数 | 依存 |
|---|---|:-:|---|
| **A** | 本番 multi-generation 化 | 3-5 日 | なし |
| **B** | trades / RepairHint / QD-Archive の DB 永続化 | 1 週間 | Phase A 並行可、A の効果は B 不要でも出る |
| **C** | lessons → mutation/crossover 経路 | 1 週間 | Phase A 完了が望ましい (Gen 2+ で効果観測) |
| **D** | GenerationReflectionAgent 追加 | 1 週間 | Phase A + B 完了 (= 観測材料が揃う) |
| **E** | PDCA ↔ Evolution 双方向通知 | 3-5 日 | Phase D 完了 (= 通知する内容が固まる) |

### 4.2 着手順序の推奨

```
Day 1-5:    Phase A      (本番 multi-gen 化)
Day 6-12:   Phase A 観察 + Phase B (永続化)
Day 13-19:  Phase B 完了 + Phase C (lessons 接続)
Day 20-26:  Phase D (世代 reflection)
Day 27-30:  Phase E (PDCA 通知接続)
Day 31-60:  観察フェーズ (= mutation 撤廃判断 + Phase 5B 解除判断)
```

Phase A だけ先に入れて 1-2 週間観察するのも合理的。**Phase A 単独でも本番に Gen 2+ が入るだけで Filter Evolution M2/M3/M4 が初めて動く**ため、最大 ROI がここ。

### 4.3 Phase 5B / Phase 6.8b / Filter Evolution M5 との関係

| 既存計画 | 本ロードマップとの関係 |
|---|---|
| Phase 5B (進化候補 → Phase 4c 接続) | 本ロードマップ完了後に「データが揃ったか」を判定。Phase A〜E 完了 + 1 ヶ月観察で「validationConfirmed が連続して 1 件以上/世代」が確認できれば Phase 5B 解除判断材料。 |
| Phase 6.8b (Python 検証サービス + CPCV) | 直交。Phase A〜E と並行で進めて良い。CPCV は本診断のスコープ外。 |
| Filter Evolution M5 (Optuna 数値最適化) | Phase A 完了後に着手可。M5 単独で意味を成すが、Phase A がないと数値最適化の効果も世代を跨いで観測できない。**Phase A を最優先**。 |
| mutation 撤廃判断 (memory `project_filter_evolution_progress.md`) | Phase A + 観察 1-2 週間後に判断材料が揃う。それまでは「現状維持」(memory の "How to apply" に従う)。 |

---

## 5. 各 Phase の詳細

### 5.A. Phase A: 本番 multi-generation 化

#### 5.A.1 変更対象

`src/side-b/jobs/sideBScheduler.ts:826-885` の `runEvolutionNow` を、smoke スクリプト (`scripts/evolution-pdca-smoke.ts`) の `--generations 2+` 経路と同等にする。

具体的には:

```typescript
// Before (現状、`sideBScheduler.ts:847-880`)
const loop = new EvolutionLoop({...});
for (const regime of regimes) {
  const report = await loop.runOneGeneration(regime);
  // ...
}

// After (Phase A 完成後)
import { runMultiGenerationEvolutionV1, MULTI_GENERATION_DEFAULTS } from '../evolution/multiGenerationRunner';
const loop = new EvolutionLoop({...});
const generations = this.config.evolutionGenerations ?? MULTI_GENERATION_DEFAULTS.generations;
for (const regime of regimes) {
  const result = await runMultiGenerationEvolutionV1(loop, regime, {
    generations,
    // 既存の Critical-4 機能を全部使う
    adaptiveRepairBudget: this.config.evolutionAdaptiveBudget ?? false,
    qualityDiversityArchive: this.config.evolutionQDArchive ?? false,
    // 失敗時の早期停止条件
    stopOnGenerationError: true,
  });
  // result.generationReports を 1 つずつログに出す
  for (const report of result.generationReports) {
    this.log(`[Evolution] regime=${regime} gen=${report.generationIndex} ...`);
  }
  // multi-gen 全体の trend summary
  this.log(`[Evolution] regime=${regime} trend: ...`);
}
```

#### 5.A.2 設定の追加

`SideBSchedulerConfig` (= `src/side-b/jobs/sideBScheduler.ts` 上部の interface) に以下を追加:

```typescript
export interface SideBSchedulerConfig {
  // ... 既存 ...
  /** Phase A: 1 cron 実行あたりの世代数 (default 1 = 単世代経路、後方互換) */
  evolutionGenerations?: number;
  /** Phase A: Adaptive Repair Budget v1 を有効化 (default false) */
  evolutionAdaptiveBudget?: boolean;
  /** Phase A: Quality-Diversity Archive Lite v1 を有効化 (default false) */
  evolutionQDArchive?: boolean;
  /** Phase A: QD-Archive parent injection 上限 (default 2) */
  evolutionQDParentLimit?: number;
}
```

`.env` 経由で `EVOLUTION_GENERATIONS=3 EVOLUTION_ADAPTIVE_BUDGET=true ...` のような切り替えも追加。

#### 5.A.3 後方互換性

- `evolutionGenerations` 未指定 / `=1` で従来挙動 (= 単世代)
- `>= 2` で multi-gen runner 経路
- 既存テスト (`sideBScheduler.fullValidation.test.ts` 等) は単世代モードで通る

#### 5.A.4 失敗時のロールバック

multi-gen runner の `stopOnGenerationError: true` で 1 世代失敗時に即停止。既存の 30 秒スリープ間隔も維持する (regime 間)。runner 内部で例外が出ても、世代 0 の report までは保存される (= 部分成功保証)。

#### 5.A.5 完了条件 (DoD)

- [ ] `runEvolutionNow` が `runMultiGenerationEvolutionV1` を使う
- [ ] `EVOLUTION_GENERATIONS` 環境変数で 1〜5 の範囲で切り替え可能 (default 1 = 後方互換)
- [ ] 既存テスト全 pass
- [ ] 本番 cron で `EVOLUTION_GENERATIONS=2` を 24h 走らせ、Cloud Logging で `gen=2` のログが確認できる
- [ ] Win Rate Lift が `notComputable` 以外の値を出す候補が 1 件以上観測される (= Gen 2 親 trades が cache に乗った証拠)

### 5.B. Phase B: 永続化 (trades / RepairHint / QD-Archive)

Phase A 単独では「同一プロセス内で multi-gen が回る」だけで、cron の起動を跨いだ学習にはならない。Phase B で in-memory cache を DB に逃がす。

#### 5.B.1 Prisma schema 追加 (3 テーブル)

```prisma
/// Phase B: EvolutionBacktestRun に trade list を保存 (M2 Win Rate Lift の永続化)
/// 既存 EvolutionBacktestRun (schema.prisma:740) に列追加 (= migration ベース)
// ALTER TABLE "EvolutionBacktestRun" ADD COLUMN "trades" Json;
//   - 各要素 { entryTime, side, pnl, outcome } の配列
//   - tradeCount > 0 の候補のみ非空、 N=0 (= insufficient_trades) は空配列

/// Phase B: 進化ループ世代間で引き継ぐ短命 state
/// cron 起動 N 回ごとに古いデータは TRUNCATE する運用前提 (retention 1-2 週間)
model EvolutionInstanceCarry {
  id              String   @id @default(uuid()) @db.Uuid
  evolutionRunId  String   @db.Uuid
  regime          String
  /// repairHints, repairBaselines, qdArchiveState を 1 行に詰める
  payload         Json
  generation      Int
  recordedAt      DateTime @default(now()) @db.Timestamptz(6)
  @@index([evolutionRunId, regime, generation], map: "idx_evolution_carry_run_regime_gen")
  @@index([recordedAt(sort: Desc)], map: "idx_evolution_carry_recorded")
}

/// Phase D 用: 世代単位の reflection lessons (= GenerationReflectionAgent が積む)
model GenerationLesson {
  id              String   @id @default(uuid()) @db.Uuid
  evolutionRunId  String   @db.Uuid
  regime          String
  generation      Int
  /// 'breakthrough' / 'stagnation' / 'mutation_decay' / 'novelty_emerged' 等のカテゴリ
  category        String
  /// 人間語の lesson (DESIGN_DOC §1.1 原則 5)
  lesson          String
  /// supporting metrics (= dsr / lift 等の数値根拠)
  metrics         Json?
  recordedAt      DateTime @default(now()) @db.Timestamptz(6)
  @@index([evolutionRunId, regime, generation], map: "idx_gen_lesson_run_regime_gen")
  @@index([category, recordedAt(sort: Desc)], map: "idx_gen_lesson_category_recorded")
}
```

migration 命名: `20260510000000_phase_b_evolution_carry`。

#### 5.B.2 EvolutionLoop の変更

`tradesByDslId` の参照経路を 2 段階にする:

```typescript
// 1. インスタンス内 in-memory (既存)
private tradesByDslId: Map<string, ...> = new Map();

// 2. Phase B 追加: cron 起動を跨ぐ DB 永続化 (optional 注入)
private evolutionInstanceCarryRepo?: EvolutionInstanceCarryRepo;

private async loadCarryState(evolutionRunId: string, regime: string): Promise<void> {
  if (!this.evolutionInstanceCarryRepo) return;
  const recent = await this.evolutionInstanceCarryRepo.findLatestByRunRegime(evolutionRunId, regime);
  if (!recent) return;
  // payload から tradesByDslId / lastRepairHints / lastRepairBaselines を復元
}

private async saveCarryState(generation: number): Promise<void> {
  // 当世代の cache を 1 行にまとめて DB 書き込み
}
```

`EvolutionLoopDeps` に `evolutionInstanceCarryRepo?: EvolutionInstanceCarryRepo | null` を追加。`null` で永続化スキップ (= テスト互換)。

#### 5.B.3 EvolutionBacktestRun.trades の persist 化

`verifyCandidatesWithFormalBacktest` の出力で trades は既に取得している (`r.trades`)。`persistFormalBtHistory` (`EvolutionLoop.ts:1346-1371`) で `trades` 列に書く 1 行追加するだけ。

```typescript
const rows = verifyResults.map((r) => ({
  // ... 既存 ...
  trades: r.trades ? r.trades.map(t => ({
    entryTime: t.entryTime,
    side: t.side,
    pnl: t.pnl,
    outcome: t.outcome,
  })) : [],  // ← 追加
}));
```

#### 5.B.4 完了条件

- [ ] 3 テーブル migration 投入
- [ ] `EvolutionLoop` で `evolutionInstanceCarryRepo` 経由の load/save が動作
- [ ] cron 起動 1 → cron 起動 2 で `tradesByDslId` が復元される (= integration test で検証)
- [ ] retention policy: 古い `EvolutionInstanceCarry` を 14 日で TRUNCATE する cron job 追加
- [ ] 本番で cron を 2 回起動 (1h 間隔) → 2 回目に Win Rate Lift が `notComputable` 以外の値を出す候補が観測される

### 5.C. Phase C: lessons → mutation/crossover 経路

#### 5.C.1 mutation/crossover prompt に lessons を注入

CrossoverAgent (`src/side-b/agents/CrossoverAgent.ts:148-162`) の `resolveSystemPrompt` 周辺を拡張:

```typescript
private async buildUserPromptWithLessons(
  baseUser: string,
  symbol: string | undefined,
): Promise<string> {
  if (!symbol) return baseUser;
  // PDCA / Reflection AI が積んだ lessons を取得
  const lessons = agentMemory.getLessonsForStrategy(symbol);
  if (lessons.length === 0) return baseUser;
  const lessonsBlock = `\n\n過去の学び (= 直近の Reflection AI / 確信ルールから抽出、symbol=${symbol}):\n` +
    lessons.slice(0, 10).join('\n');  // 上位 10 件に絞る (token 抑制)
  return baseUser + lessonsBlock;
}
```

`generateCrossovers` の各ペアループ内で `lossTradesBlock + moduleParentBlock + lessonsBlock` の順で連結。

`MutationAgent.ts` も同様に lessons block 追加。

#### 5.C.2 prompt md の更新

`src/side-b/prompts/crossover.md` / `mutation.md` の冒頭に:

```markdown
## 過去の学び (lessons) の使い方

ユーザープロンプトに `過去の学び:` ブロックがある場合:
- 確信ルール (📌 マーク) は最優先で考慮
- [symbol] / 他銘柄の lessons は filter 設計のヒントとして使う
- lessons の内容を child の `rationale` (M3 wrapper の場合) に明示的に引用すること
```

#### 5.C.3 観測ログ

CrossoverAgent / MutationAgent に観測ログを追加:

```typescript
console.info(
  `[CrossoverAgent] M3 lessons injected symbol=${symbol} count=${lessons.length}`
);
```

これで Cloud Logging で「lessons がいくつ流れたか」「lessons なしの世代もあるか」を確認できる。

#### 5.C.4 完了条件

- [ ] mutation/crossover prompt が lessons を含むパターンの単体テスト
- [ ] lessons 注入の観測ログが本番で出力される
- [ ] `agentMemory.addLesson` が直前 24h で 3 件以上ある regime で、その lessons が次の mutation/crossover prompt に含まれる integration test
- [ ] crossover の `rationale` フィールド (M3 wrapper) で lessons を引用した child が観測される

### 5.D. Phase D: GenerationReflectionAgent

#### 5.D.1 新規エージェントの責務

`src/side-b/agents/GenerationReflectionAgent.ts` (新規 ~250 行):

入力:
- 当世代の `GenerationReport` (= EvolutionLoop / multi-gen runner 出力)
- 直前 N 世代の `GenerationReport` (= memory 経由)
- 当世代の `tradesByDslId`

LLM への要求:
- promotion 候補 / formalBtVerified の数値変化を観察
- Win Rate Lift / DSR / RepairOutcome の trend
- 「当世代で何が起きたか」を 1-3 件の verbal lesson に変換
- categories: `breakthrough` / `stagnation` / `mutation_decay` / `novelty_emerged` / `regime_shift_detected` / `filter_efficacy_increased`

出力:
```json
{
  "lessons": [
    {
      "category": "filter_efficacy_increased",
      "lesson": "Gen 3 で time_session.overlap_london_ny を含む crossover child が 2 件 promotion top-K に届いた。london/ny オーバーラップ filter は breakout 戦略との相性が高い可能性。",
      "metrics": { "winRateLiftMedian": 1.42, "filterCategory": "time_session" }
    }
  ],
  "summary": "Gen 3 は time_session filter で breakthrough が観測された世代",
  "confidence": 0.7
}
```

CLAUDE.md 原則 5 「人間語に翻訳して記録」と整合。

#### 5.D.2 prompt 設計

新規ファイル `src/side-b/prompts/generation_reflection.md`:

```markdown
あなたは進化的探索の「世代単位の振り返り」を行う反省エージェントです。

入力として GenerationReport の数値要約と直前世代との差分を受け取ります。
出力として「当世代で何が起きたか」を verbal lesson として返します。

(以下、上記 categories と JSON schema)
```

global prompt + 個別 prompt の 3 階層合成 (`loadPromptWithGlobal` / Registry) は既存パターンに従う。

#### 5.D.3 統合点

`multiGenerationRunner` の各世代終了直後に呼び出す:

```typescript
// multiGenerationRunner.ts 内
for (let g = 0; g < generations; g++) {
  const report = await loop.runOneGeneration(regime, options);
  // ... 既存の summary 集計 ...

  // Phase D: 世代 reflection
  if (deps.generationReflectionAgent) {
    const reflection = await deps.generationReflectionAgent.reflect({
      currentReport: report,
      priorReports: priorReports.slice(-3),
      tradesByDslId: loop.getTradesByDslId(),  // getter 追加
    });
    if (reflection) {
      for (const lesson of reflection.lessons) {
        await generationLessonRepo.create({...lesson, evolutionRunId, regime, generation: g});
      }
    }
  }
  priorReports.push(report);
}
```

#### 5.D.4 完了条件

- [ ] `GenerationReflectionAgent.ts` 実装 + 単体テスト (mock LLM)
- [ ] `prompts/generation_reflection.md` + Registry seed エントリ
- [ ] `GenerationLesson` テーブルに lesson が記録される integration test
- [ ] 本番 multi-gen run で `generation_lessons` 行が世代ごとに 1-3 件積まれる
- [ ] Phase 6.7 の A/B test 経路で `generation_reflection` agent も variant 切り替え可能

### 5.E. Phase E: PDCA ↔ Evolution 双方向通知

#### 5.E.1 Evolution → PDCA 通知

`PDCALoop` に新規 hook 追加 (`src/side-b/agent/pdcaLoop.ts`):

```typescript
notifyEvolutionGenerationComplete(
  regime: string,
  report: GenerationReport,
  reflectionLessons: GenerationLesson[],
): void {
  this.addThinkingLog(this.memory.getState(),
    `進化ループ世代完了: regime=${regime} promo=${report.promotionCandidates.length} ` +
    `validationConfirmed=${report.oosAwarePromotionSummary.validationConfirmed}`,
    reflectionLessons.map(l => `[${l.category}] ${l.lesson}`).join(' | '),
  );
}
```

`sideBScheduler.runEvolutionNow` の各世代終了時に呼ぶ。

#### 5.E.2 lessons の symbol 横断共有

GenerationReflectionAgent が出した lessons は **regime 別** だが、`agentMemory.lessonsBySymbol` は symbol 別。両者を結ぶ:

- regime → symbol マッピングは現状なし
- 当面は `generationLessons` を **全 symbol 共通** として `agentMemory.getGenerationLessons()` で返す
- mutation/crossover prompt では `getLessonsForStrategy(symbol) + getGenerationLessons()` を両方注入

#### 5.E.3 PDCA → Evolution 通知 (= 逆方向)

PDCALoop の `handleReflecting` で Reflection AI が走った直後、その lessons を進化ループに渡す経路:

- 既に Phase C で `agentMemory.getLessonsForStrategy(symbol)` から取れるため、新規通知 hook は **不要**
- agentMemory が共有メモリ層として機能

#### 5.E.4 完了条件

- [ ] `notifyEvolutionGenerationComplete` 実装 + PDCA thinkingLog に世代経過が出る
- [ ] mutation/crossover prompt に `getGenerationLessons()` の出力が注入される
- [ ] 本番で 1 cron run の前後で `agentMemory` を確認、`generationLessons` が前 cron で積まれた値を後 cron で読めている

---

## 6. M5 (Python Optuna) との関係

memory `project_filter_evolution_progress.md` に「M5 は M3 観測完了後に着手判断」とある。本ロードマップとの関係:

| Phase | M5 着手可否 | 理由 |
|---|:-:|---|
| Phase A 完了前 | × | Gen 1 のみで Optuna も意味を成さない |
| Phase A 完了後 | ◯ | Gen 2+ で Optuna 効果が観測可能 |
| Phase B 完了後 | ◎ | trades 永続化で Optuna の trial 結果を世代間共有可能 |

**推奨**: Phase A + B 完了後に M5 着手。Phase C-E は M5 と並行可能 (= 直交)。

---

## 7. mutation 撤廃判断との関係

memory `project_filter_evolution_progress.md` の「mutation 撤廃 = M3 + 本番スモーク後に再判断」と整合させる:

- 「本番スモーク」が **multi-gen 化された本番** で 1-2 週間動かしたデータを意味する
- → Phase A 完了後の観察フェーズが「本番スモーク」に相当
- → mutation 撤廃判断は **Phase A 完了 + 1-2 週間後** に移動

判断材料 (= 本ロードマップの「学習が成立する条件」§3.3):
- mutation 由来 child の Win Rate Lift 中央値が 1.0 から動かない → 撤廃 or repair 専用に縮退 (案 A or B)
- mutation 由来 child が時々 Lift > 1.0 を出すが crossover ほどではない → repair 専用 (案 B)
- mutation が新規 operator 追加で固有貢献 → 構造変異専用 (案 C)
- 観測してもノイズに見えない → 現状維持 (案 D)

Phase D の GenerationReflectionAgent が `mutation_decay` カテゴリを継続的に出すなら、撤廃の強い根拠になる。

---

## 8. リスク / トレードオフ

### 8.1 Phase A: multi-gen 化のリスク

- **LLM コスト**: 世代を増やすと mutation/crossover の LLM コール回数が世代倍になる。EVOLUTION_GENERATIONS=3 で約 3 倍。AI_API_KEY のレート制限と月額に注意
- **cron 実行時間**: 1 世代 5-10 分 × 5 regime × N 世代。N=3 なら 75-150 分。Cloud Run の `--timeout` (= default 60 分) に引っかかる可能性
- **対策**: `evolutionGenerations: 2` で開始、観測後に増やす。`--timeout=900` (= 15 分)、`--cpu=2` 等で底上げ

### 8.2 Phase B: 永続化のリスク

- **DB 容量**: `EvolutionInstanceCarry` の payload が大きい (trades + repairHints + qdArchive)。1 行 100KB 想定 × 5 regime × 24h = 約 12MB/日。retention 14 日で 168MB
- **trades 永続化**: `EvolutionBacktestRun.trades` 列追加で既存行 (= 現在は trades なし) は NULL になる。Win Rate Lift 計算は NULL 対応済 (`notComputable` で逃げる)
- **対策**: `recordedAt` インデックス + 日次 TRUNCATE で運用、容量監視は Cloud Logging で

### 8.3 Phase C: lessons 注入のリスク

- **prompt 肥大化**: lessons が 50 件溜まると prompt が肥大、LLM の attention が分散。上位 10 件に絞るのは妥当だが「重要な lesson が落ちる」リスク
- **lessons の質**: Reflection AI が悪い lessons を積むと mutation/crossover が悪化する方向に学ぶ
- **対策**: 上位 10 件選別ロジックを `lessonSimilarityService` (既存) ベースで類似度高いものを優先、`addLesson` の confidence 閾値強化

### 8.4 Phase D: GenerationReflectionAgent のリスク

- **LLM hallucination**: GenerationReport の数値解釈で LLM が嘘の trend を語る可能性
- **対策**: prompt に「数値の根拠 (metrics 引用) を必ず含めること」を明示、`metrics` フィールドが空の lesson は schema 拒否
- **コスト**: 1 世代 1 コール × 5 regime × N 世代。Adaptive 制御 (= 重要世代のみ発火) は将来検討

### 8.5 Phase E: 双方向通知のリスク

- **lessons の cross-symbol 汚染**: `getGenerationLessons()` を全 symbol 共通にすると、特定 symbol で発見した特性が他 symbol の進化に流れる
- **対策**: regime ベースで分離、symbol ベースの lessons は `getLessonsForStrategy(symbol)` のまま分離維持

### 8.6 全体リスク: 「学習が機能しない」場合のデバッグ

すべてが配線されても、観測指標 (§3.3) が改善しない可能性はある。原因候補:

- Setup 側 (= novelty seed / HypothesisGenerator) の質が天井になっている
- Win Rate Lift の safety guard が厳しすぎて常に弾かれる
- LLM が lessons を読まない (prompt 構造が悪い)

**対策**: Phase A〜E 完了後 1-2 ヶ月の観察フェーズで、上記の指標 1-4 を Cloud Logging から週次集計。Setup 側強化 (= 別フェーズ) や閾値調整を観測ベースで判断する。

---

## 9. 完了条件 (DoD)

### 9.1 個別 Phase の DoD

各 Phase の §5.X.5 / §5.X.4 に記載。

### 9.2 全体の DoD (= 「学ぶエージェントループ」が成立した)

Phase A〜E 完了 + 1-2 ヶ月観察後、以下の **3 条件全てを満たす**:

1. **Win Rate Lift が観測される**: 直近 7 日の cron run のうち、`notComputable` 以外の Lift 値を出す候補が日平均 5 件以上
2. **Lift 中央値が 1.0 を上回る**: 直近 7 日の `notComputable` 以外の Lift 値の中央値 > 1.0
3. **`generationLessons` が累積する**: 直近 7 日で `category=breakthrough` または `category=filter_efficacy_increased` の lesson が累計 3 件以上

これが達成できれば:
- mutation 撤廃判断の材料が揃う (= Phase D の generation lessons から判定)
- Phase 5B 解除判断の材料が揃う (= validationConfirmed が連続して出るか)
- Setup 側強化フェーズに進む判断ができる

達成できなければ:
- §8.6 のデバッグサイクルに入る
- Setup 側の問題に絞り込む

---

## 10. 参考

### 10.1 関連設計書

- `docs/design/phase_filter_evolution_specification.md` (= Filter Evolution、本ロードマップの直接の前提)
- `docs/design/phase_5a_specification.md` (= Phase 5A 進化ループ基盤)
- `docs/design/phase_5b_specification.md` (= 凍結中、本ロードマップ完了後に解除判断)
- `docs/design/phase_6_specification.md` (= プロンプト進化、Phase D の GenerationReflectionAgent も Phase 6 進化対象になり得る)
- `docs/design/critical_4_bt_unification.md §13` (= surrogate / 正式 BT の役割分離)
- `docs/review/2026-05-08_comprehensive_review.md` (= 前回レビュー、§2.8.2 で世代単位 reflection 不在を指摘済)

### 10.2 関連 memory

- `project_filter_evolution_progress.md` (= M2/M3/M4 完了 + mutation 撤廃判断の保留)
- `project_critical_4_progress.md` (= PR #95-#137 履歴、機構面の積み残し)
- `project_phase_5b_hold.md` (= Phase 5B 凍結方針)
- `project_phase_6_completed.md` (= Phase 6 部分完了状況)

### 10.3 関連学術論文

- Reflexion (Shinn et al. 2023, [arxiv:2303.11366](https://arxiv.org/abs/2303.11366)) — Phase D の根拠
- FunSearch (Romera-Paredes et al. 2024, Nature) — Phase A multi-gen の必要性
- MAP-Elites (Mouret & Clune 2015, [arxiv:1504.04909](https://arxiv.org/abs/1504.04909)) — Phase B QD-Archive 永続化の根拠
- Lift (Provost & Fawcett 2013) — M2 評価指標の出典 (Filter Evolution 既存)

---

## 11. おわりに

「いまいちエージェントのループがうまくいってない」の正体は、**コード上は揃っている部品が本番で配線されていない** という構造問題でした。Critical-4 PR シーケンス (#95-#137) は学術的に筋の通った設計を順序立てて積んできた一方で、各 PR が前提とする「世代を跨ぐ memory」がインフラ層 (本番 scheduler / DB 永続化) に届いていません。

幸い:
- `multiGenerationRunner` は smoke で完全動作
- `agentMemory.lessons` は Reflection AI が積んでいる
- Filter Evolution M3 で `parentLossTrades` を受け取る経路は CrossoverAgent 側に既存
- 永続化の DB schema は最小 3 テーブルで足りる

→ **本ロードマップは「新規開発」ではなく「既存資産の本番統合」** が大半を占めます。1 ヶ月で実現可能。

最も ROI の高い Phase A (本番 multi-gen 化) を優先し、観測しながら順序を調整するのが安全です。

> 本実装計画は Claude Opus 4.7 (1M context) によって 2026-05-09 に作成されました。
> 静的レビュー / コード読みのみ / 部品の本番統合に焦点 / Setup 側 (仮説生成・seed 強化) は本計画のスコープ外。
