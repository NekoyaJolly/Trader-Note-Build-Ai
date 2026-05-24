---
document: top-level-orchestrator-design
phase: B+
author: Nekoさん + Claude
created: 2026-05-24
status: APPROVED (Nekoさん 合意済、本セッションで実装)
---

# Top-Level Orchestrator 設計書

## 0. 目的とコンテキスト

### 0.1 目的

Side-B の現状 (= PDCALoop + EvolutionLoop + Cron Scheduler の 3 並列ループ) に
**最上位の薄い判断層 = Top-Level Orchestrator** を追加し、Cron 起動時に
「次にどのループを回すか」を LLM 判断で決める。

これにより:
- 静的 Cron スケジュール一辺倒から、**状況に応じた動的判断** が可能になる
- 旧 AgentLoop (= 1 LLM で PDCA 全部、機能せず PR #231 で撤去) の轍を踏まず、
  **責務を「次に何を呼ぶか」だけに限定** した薄い層にする
- 4 体の専門 LLM (Research / Plan / Reflection / Strategist) は既存のまま
- Cron は最低限保証として残し、手動実行 API は退路として維持

### 0.2 ベストプラクティス参照

`docs/research/agent_orchestration_patterns_2026-05-24.md` § 5「Nekoさん 発想の評価」で、
**LangGraph Supervisor / LlamaIndex Orchestrator / FinRobot Smart Scheduler の交点**
に位置すると確認済。3 ループ統合は外部 OSS より先進的。

### 0.3 過去の教訓 (= 設計上の必須要件)

| 教訓元 | 学び | 本設計での対応 |
|---|---|---|
| 旧 AgentLoop 撤去 (PR #231) | 1 LLM で PDCA 全部は文脈肥大 + 責務不明確で機能しない | 責務を「次に何を呼ぶか」だけに限定 |
| BabyAGI hallucination loop | 連続実行で目的を見失う | 連続 3 サイクル fatal で自動停止 |
| sideBScheduler 責務集中 | 1 module に全部押し込むと判断不能 | Orchestrator は判断のみ、実行は既存 Job に委譲 |
| Cron との二重実装 | 同期/排他制御を間違うと競合 | Cron 起動 → Orchestrator 判断、手動実行 = Orchestrator バイパス |

## 1. アーキテクチャ

### 1.1 全体図

```
GitHub Actions Cron (= 既存、最低限保証)
  ↓ HTTP request (CRON_SECRET 認証)
GCP Cloud Run /api/side-b/cron/* endpoint
  ↓
SideBScheduler.startInternal()
  ↓
  ├─ (新) TopLevelOrchestrator.decideAndExecute()  ← 本設計の中核
  │     ↓ 入力収集
  │     ├ EdgeLedger 集計 (= status 別件数 / 直近 24h 生成数)
  │     ├ EvolutionBacktestRun 集計 (= 直近 24h passed/failed)
  │     ├ ADK trace event (= 直近 100 件のサマリ)
  │     └ 各 Job の lastRun timestamp
  │     ↓ 禁止事項 check (= 7 ルール)
  │     ↓ LLM 判断 (top_level_orchestrator.md prompt)
  │     ↓ 判断結果 (5 種類のいずれか)
  │     ├→ "create_hypothesis"  → planGenerationJob.run()
  │     ├→ "advance_validation" → screeningJob.run() / fullValidationJob.run()
  │     ├→ "run_evolution"      → evolutionJob.runEvolutionNow()
  │     ├→ "run_all"            → 上記 3 つ並列 (budget 制限)
  │     └→ "wait"               → 何もしない (= 次 Cron まで)
  │     ↓ 結果 persist
  │     └ AgentRun + AgentRunStep に判断履歴を記録 (= ADK trace 経由)
  │
  └─ (既存) その他の interval-based Job 起動経路は維持
        (= tradeMonitoringJob 等は cron Job 制御外で 1h ごと等で動く)

手動退路 (= Orchestrator バイパス):
  SideBController.startEvolutionNow / startScreeningNow / 等の既存 API がそのまま使える
```

### 1.2 入力スキーマ

```typescript
interface TopLevelOrchestratorInput {
  /** 起動 trigger (cron / manual / test) */
  trigger: 'cron' | 'manual' | 'test';

  /** EdgeLedger 集計 (= 仮説の現状) */
  edgeLedger: {
    /** status 別件数 */
    byStatus: Record<EdgeStatus, number>;
    /** 直近 24h で生成された仮説数 */
    recentlyCreated24h: number;
    /** 直近 24h で screening_passed に進んだ件数 */
    recentlyScreeningPassed24h: number;
    /** 直近 24h で confirmed になった件数 */
    recentlyConfirmed24h: number;
  };

  /** EvolutionBacktestRun 集計 (= 進化の現状) */
  evolution: {
    /** 直近 24h で formal BT 通った候補数 */
    recentPassed24h: number;
    /** 直近 24h で failed した候補数 */
    recentFailed24h: number;
    /** 最後の evolutionRunId 完了時刻 (= UTC ISO、なければ null) */
    lastRunFinishedAt: string | null;
  };

  /** ADK trace event 集計 (= 観測性) */
  recentTraceEvents: {
    /** 直近 100 件の event 概要 */
    summary: string;
    /** error event 件数 (= 直近 24h) */
    errorCount24h: number;
  };

  /** 各 Job の lastRun timestamp (= UTC ISO、未実行なら null) */
  lastRuns: {
    planGeneration: string | null;
    screening: string | null;
    fullValidation: string | null;
    evolution: string | null;
    discovery: string | null;
  };

  /** Top-Level Orchestrator 自身の直近の判断履歴 (= AgentRunStep 経由、最大 5 件) */
  recentDecisions: Array<{
    decidedAt: string;
    action: TopLevelAction;
    reasoning: string;
  }>;
}

type EdgeStatus =
  | 'unverified'
  | 'screening_passed'
  | 'testing'
  | 'confirmed'
  | 'not_testable'
  | 'insufficient_data'
  | 'rejected'
  | 'stale';
```

### 1.3 出力スキーマ

```typescript
type TopLevelAction =
  | 'create_hypothesis'    // HypothesisGenerator → 新規 EdgeHypothesis 生成
  | 'advance_validation'   // Screening / FullValidation 進める
  | 'run_evolution'        // EvolutionLoop.runOneGeneration
  | 'run_all'              // 上記 3 つ並列 (budget 制限付き)
  | 'wait';                // 次 Cron まで何もしない

interface TopLevelOrchestratorOutput {
  action: TopLevelAction;
  /** LLM 判断の根拠 (= 日本語、2-5 行) */
  reasoning: string;
  /** action='run_all' の場合の budget 上限 (= 並列度や時間) */
  runAllBudget?: {
    maxParallel: number;
    maxLlmTokens: number;
    timeoutMs: number;
  };
  /** action='wait' の場合の次回判断推奨タイミング (= ISO 文字列、Cron に対する hint) */
  waitUntil?: string;
}
```

### 1.4 禁止事項 (= LLM 裁量の外側、7 ルール)

これらは LLM 判断の **前後で機械的に check** され、違反時は強制的に `'wait'` または
人間呼び出しに切替わる。

| # | ルール | 判定タイミング | 違反時の挙動 |
|---|---|---|---|
| 1 | 連続 3 サイクル fatal error | 入力収集時 | 強制 `'wait'` + Slack/メール通知 (= 将来) + AgentRun に `status=blocked` |
| 2 | 1 サイクル LLM トークン > 100k 想定 | LLM 判断結果受領後 | 強制 `'wait'` + 警告 log |
| 3 | 1 時間に 4 回以上起動 | 入力収集時 | 強制 `'wait'` + 連打防止 log |
| 4 | EdgeHypothesis が 1000 件超で滞留 | 入力収集時 | `'create_hypothesis'` を action に含めない (= LLM に既存処理を促す) |
| 5 | 実トレード execute は Orchestrator では行わない | アーキテクチャ制約 | そもそも Orchestrator から出力 action に含まれない (= tradeMonitoringJob のみが担う) |
| 6 | 手動実行が進行中 (= AgentRun に running 状態あり) | 入力収集時 | 強制 `'wait'` + 競合防止 log |
| 7 | 判断結果は ADK trace に必ず記録 | 出力直後 | 記録失敗時は throw (= silent failure 禁止) |

### 1.5 Cron との関係

| 軸 | Cron | Top-Level Orchestrator |
|---|---|---|
| 役割 | 定期発火 (= 最低限保証) | 判断 + 実行 |
| 頻度 | GitHub Actions cron で 1h ごと / daily | Cron 1 回起動 = Orchestrator 1 回判断 |
| 障害時 | Orchestrator が落ちても Cron は次回起動 | LLM 障害時は禁止事項 #1/#2 で `'wait'` にフォールバック |
| 手動退路 | (Cron 経由は手動 trigger 可、`workflow_dispatch`) | SideBController API で **バイパス可** |

### 1.6 既存ループとの関係

- **PDCALoop**: 既存のまま (= state machine、1h interval)。Top-Level の "advance_validation" / "create_hypothesis" は内部的に planGenerationJob を呼ぶが、PDCALoop の cycle は独立して回り続ける。
- **EvolutionLoop**: 既存のまま。Top-Level の "run_evolution" が EvolutionJob (= scheduler 内の既存 Job) を呼ぶ経路で起動。
- **既存 SideBScheduler**: cron entry を「素直に startInternal()」から「TopLevelOrchestrator.decideAndExecute() → startInternal()」に切替。

## 2. 実装範囲 (= 本 PR で実装するもの)

### 2.1 新規ファイル

| パス | 内容 | 行数目安 |
|---|---|---|
| `src/side-b/orchestrator/topLevelOrchestrator.ts` | Orchestrator 本体クラス | 200-300 |
| `src/side-b/prompts/top_level_orchestrator.md` | LLM プロンプト | 100-150 |
| `src/side-b/orchestrator/topLevelOrchestratorRules.ts` | 禁止事項 7 件の純粋関数集 | 100-150 |
| `src/side-b/tests/orchestrator/topLevelOrchestrator.test.ts` | ユニットテスト | 300-400 |

### 2.2 既存ファイル変更

| パス | 変更内容 |
|---|---|
| `src/side-b/jobs/sideBScheduler.ts` | cron entry (`startInternal`) の前に `TopLevelOrchestrator.decideAndExecute()` を呼ぶ。`TOP_LEVEL_ORCHESTRATOR_ENABLED` env で default false (= 既存挙動互換) |
| `src/side-b/orchestrator/index.ts` | 新規 export 追加 |
| `src/side-b/prompts/registry/seed.ts` | top_level_orchestrator prompt の seed 追加 (= PromptRegistry 経由化、既存パターン踏襲) |

### 2.3 環境変数

| Env | Default | 説明 |
|---|---|---|
| `TOP_LEVEL_ORCHESTRATOR_ENABLED` | `false` | Top-Loop 有効化フラグ (default false、既存挙動互換) |
| `AI_MODEL_TOP_LEVEL_ORCHESTRATOR` | `anthropic/claude-haiku-4.5` | 判断用 LLM model (= 軽量、速度優先) |
| `TOP_LEVEL_ORCHESTRATOR_RATE_LIMIT_PER_HOUR` | `3` | 1h 起動上限 (= 禁止事項 #3) |

## 3. プロンプト設計 (= top_level_orchestrator.md の骨子)

```markdown
# Top-Level Orchestrator

あなたは TradeAssist Side-B の最上位判断層です。Side-B の現状を観察して、
「次にどのループを回すべきか」だけを判断します。

## 役割

- 各 PDCA フェーズの結果サマリと EdgeLedger / Evolution の現状を見て、次の action を 1 つ選ぶ
- 実行は専門 Agent に委ねる (あなたは action を返すだけ)
- 「待機」も valid な選択肢 (= 何もしない方が良い時は迷わず wait)

## 判断基準 (= LLM 裁量、最低限のヒント)

- 仮説が少ない → "create_hypothesis"
- screening_passed が溜まっている → "advance_validation"
- 既存仮説の検証が一巡している → "run_evolution"
- すべてが進めるべき状態 → "run_all" (ただし budget 制限あり)
- どれも今やる必要が無い (= 直近で実行済、結果待ち) → "wait"

## 禁止事項 (= 機械的に enforce される、あなたは意識しなくて良い)

(7 件の禁止事項は input に含まれる "blockedActions" で渡される、それ以外を選ぶ)

## 出力形式

JSON で以下のスキーマ:

{
  "action": "create_hypothesis" | "advance_validation" | "run_evolution" | "run_all" | "wait",
  "reasoning": "日本語で 2-5 行の判断根拠",
  "runAllBudget": { ... } (action="run_all" の場合のみ),
  "waitUntil": "ISO 文字列" (action="wait" の場合の hint、optional)
}
```

## 4. 段階的ロールアウト計画

### 4.1 Phase 1 (= 本 PR、MVP)

- `TOP_LEVEL_ORCHESTRATOR_ENABLED=false` で merge
- 本番 / dev とも default OFF (= 既存挙動完全互換)
- ユニットテストで「禁止事項 7 件 + 主要判断分岐」を pin

### 4.2 Phase 2 (= 別 PR、本番有効化前)

- dev 環境で `TOP_LEVEL_ORCHESTRATOR_ENABLED=true` にして 24-48h 観測
- 判断履歴 (AgentRunStep) を見て LLM の判断品質を評価
- 必要なら prompt 調整 / 禁止事項追加

### 4.3 Phase 3 (= 別 PR、本番ロールアウト)

- 本番有効化 (= env で true)
- Phase B 仮説検証 (= `not_testable` 比率改善観測) と並行運用
- Top-Loop の判断履歴と運用結果を 1-2 週間観測

## 5. 開ける懸念 (= 設計時点で気づいた不確実性)

| 懸念 | 対応案 |
|---|---|
| LLM 判断の根拠が不透明 | reasoning 必須 + AgentRunStep に persist |
| 連打 / 競合の制御 | 禁止事項 #3 / #6 で機械防止 |
| run_all の budget 暴発 | runAllBudget で並列度 / token 上限を LLM 自身に決めさせる + 上限 clamp |
| 既存 Cron 経路への影響 | env default false で既存挙動完全互換 |
| 4 体専門 Agent との責務曖昧化 | Top-Level は action 選択のみ、各 Job 内部のロジックは無変更 |
| dev / 本番でのデータ偏り | dev で 24-48h shadow 観察 (= Phase 2)、判断品質を確認してから本番 ON |

## 6. テストプラン

| カテゴリ | テスト内容 |
|---|---|
| 禁止事項 #1 | 連続 3 fatal で `'wait'` に強制される (mocked AgentRun) |
| 禁止事項 #3 | 1h 内 4 回起動目で拒否される |
| 禁止事項 #4 | EdgeHypothesis 1000 件超で `'create_hypothesis'` 不可リスト入り |
| 禁止事項 #6 | 手動実行 running 中は `'wait'` に強制 |
| LLM 判断 dispatcher | 各 action 出力を mock して、正しい Job が呼ばれることを pin |
| run_all budget | runAllBudget の上限 clamp 動作 |
| input 収集 | 各 DB query が正しい条件で呼ばれることを pin |

## 7. スコープ外 (= 本 PR では実装しない)

- 本番有効化 (= env true) → Phase 2/3 で別 PR
- 判断履歴の UI 可視化 → 別 PR (Phase 2 観察データを見てから設計)
- Slack/メール通知 (= 禁止事項 #1 の人間呼び出し) → Phase 2 で必要なら追加
- waitUntil 値を Cron next-fire の hint に流す経路 → Phase 3 で必要なら追加
- 4 体専門 Agent の改修 → 本 PR 範囲外、既存のまま

## 8. 完了 DoD

- [x] 設計書 (本ファイル) の Nekoさん 承認
- [ ] 新規 4 ファイル + 既存 3 ファイル変更
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint:backend` 0 errors
- [ ] ユニットテスト全 pass (= 7 禁止事項 + LLM dispatcher + input 収集)
- [ ] smoke (= scripts/evolution-pdca-smoke.ts) 1 回 OK (TOP_LEVEL_ORCHESTRATOR_ENABLED=false で既存挙動互換)
- [ ] PR 作成 + Copilot レビュー対応 + merge

## 9. 関連ドキュメント

- `docs/research/agent_orchestration_patterns_2026-05-24.md` (= 調査結果、本設計の根拠)
- `docs/diagnostics/2026-05-19_loops_flow_diagram.html` (= 3 ループ並列構造の図示)
- `docs/architecture/ADK_ADOPTION.md` (= ADK との関係、Orchestrator は ADK trace 経由で記録)
- memory `project_orchestration_roadmap.md` (= 旧 P1a/P1b 保留判断、本設計で復活)
- memory `project_phase_b_g2_hypothesis.md` (= 並行する仮説検証)
- PR #231 (= AgentLoop 撤去、撤去メモで「Plan 段に Orchestrator 統合」が示唆されていた)
