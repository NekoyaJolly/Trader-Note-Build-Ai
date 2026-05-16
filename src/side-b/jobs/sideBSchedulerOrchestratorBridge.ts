/**
 * SideBScheduler → ADK Orchestrator Wrapper bridge
 *
 * Scheduler を「起動入口」に限定し、ADK Orchestrator Wrapper (Phase 6) を呼ぶための
 * 薄い helper。Scheduler 内部の cron 経路 / 各 Job インスタンスは一切触らない。
 *
 * 責務:
 *   - feature flag (env `SIDE_B_ADK_ORCHESTRATOR_ENABLED`) を読む
 *   - 必要な Job adapter (cleanup / discovery 等、Phase 3 で実装した分) を組み立てる
 *   - `runSideBOrchestratedCycle()` を呼ぶ
 *
 * 持たない責務:
 *   - Scheduler 内部 state の読み書き (= Scheduler 本体には新規メソッド 1 つ追加のみ)
 *   - 新規 Job 実装 (= Phase 3 で実装した adapter のみ wire、残り adapter は将来追加)
 *   - DB CRUD 直接 (= RunLedgerService / StrategyDraftService 経由のみ)
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §12 (Phase 7)
 */

import {
  runSideBOrchestratedCycle,
  type SideBOrchestratorJobs,
  type SideBOrchestratorOptions,
  type SideBOrchestratorResult,
} from '../adk/agents/sideBOrchestrator';
import {
  createRunLedgerService,
  type RunLedgerService,
} from '../services/runLedgerService';
import {
  createStrategyDraftService,
  type StrategyDraftService,
} from '../services/strategyDraftService';

/** feature flag を読み取る env var 名 */
export const ADK_ORCHESTRATOR_ENV_VAR = 'SIDE_B_ADK_ORCHESTRATOR_ENABLED';

/**
 * ADK orchestrator が有効か判定する。
 * - env が `'true'` / `'1'` / `'yes'` (大小無視) → enabled
 * - それ以外 → disabled (= 旧経路継続)
 *
 * env が未設定 / 'false' / 空文字 → disabled になる。rollback は env 削除 / 'false' 化のみで即時。
 */
export function isAdkOrchestratorEnabled(
  env: Readonly<NodeJS.ProcessEnv> = process.env,
): boolean {
  const raw = env[ADK_ORCHESTRATOR_ENV_VAR];
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/** Bridge の戻り値 */
export type BridgeResult =
  | { kind: 'disabled' }
  | { kind: 'executed'; result: SideBOrchestratorResult };

/**
 * Bridge の起動オプション。
 *
 * 現状の Phase 7 では Scheduler config は Orchestrator に渡していない (将来 Job
 * adapter を wire-up する際に必要なら追加)。yagni 原則で「今使わないものは入れない」。
 */
export interface BridgeOptions {
  /** RunLedgerService (省略時は default Prisma に接続) */
  readonly ledger?: RunLedgerService;
  /** StrategyDraftService (省略時は default Prisma に接続) */
  readonly draftService?: StrategyDraftService;
  /** 強制的に有効化する (test / 手動 trigger 用、env を無視) */
  readonly forceEnabled?: boolean;
  /** Orchestrator に渡す追加オプション (idempotencyKey 等) */
  readonly orchestratorOptions?: Partial<Omit<SideBOrchestratorOptions,
    'ledger' | 'draftService' | 'jobs'
  >>;
  /** test / DI 用に env を差し替える */
  readonly env?: Readonly<NodeJS.ProcessEnv>;
  /** Job adapter (test / wire-up custom 用)。省略時は空 (= 全 step skip) */
  readonly jobs?: SideBOrchestratorJobs;
}

/**
 * Scheduler から呼ばれる ADK Orchestrator 起動 entry point。
 *
 * feature flag が OFF なら何もせず `{ kind: 'disabled' }` を返す (= 旧経路継続)。
 * ON の場合は `runSideBOrchestratedCycle()` を呼び、結果を `{ kind: 'executed' }` で返す。
 *
 * 本 helper では Job adapter の自動 wire-up は行わない (Phase 3 で 2 adapter を実装したが、
 * 残り 6 adapter は将来追加)。Scheduler / 呼び出し側が必要な adapter を `jobs` に渡す。
 * これにより Phase 7 のスコープ (Scheduler 接続のみ) を超える実装を避ける。
 */
export async function runScheduledOrchestratedCycle(
  options: BridgeOptions,
): Promise<BridgeResult> {
  const enabled = options.forceEnabled ?? isAdkOrchestratorEnabled(options.env);
  if (!enabled) {
    return { kind: 'disabled' };
  }

  const ledger = options.ledger ?? createRunLedgerService();
  const draftService = options.draftService ?? createStrategyDraftService();

  const result = await runSideBOrchestratedCycle({
    ledger,
    draftService,
    jobs: options.jobs ?? {},
    ...(options.orchestratorOptions ?? {}),
  });

  return { kind: 'executed', result };
}
