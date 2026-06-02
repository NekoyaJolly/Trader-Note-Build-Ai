/**
 * JobPort / JobResultEnvelope
 *
 * ADK Orchestrator Wrapper (Phase 6) が既存 8 Job を「Job ごとの詳細を知らずに」
 * 同じ形で呼ぶための共通 interface。
 *
 * 設計方針:
 *   - 既存 Job (src/side-b/jobs/*Job.ts) は **改変しない** (WBS §17)
 *   - adapter で wrap して JobPort interface に揃える
 *   - JobResultEnvelope.dataRef は ID 等の参照だけ、raw payload は持たない (WBS §17)
 *   - ADK SDK には依存しない (JobPort は ADK 非依存の純粋 interface)
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §8 (Phase 3)
 */

import type {
  AgentRunStepStatus,
  AgentRunStepNextAction,
} from '@prisma/client';
import type { RunLedgerService } from '../services/runLedgerService';

/**
 * JobPort: ADK Orchestrator Wrapper が Job 全種を一律に呼ぶための interface。
 */
export interface JobPort {
  /** RunLedger 上で記録される step 名 (readiness / plan / monitor / evolution / draft / validation など) */
  readonly stepName: string;
  /** Job を実行し、結果を JobResultEnvelope として返す。raw payload は返さない */
  execute(context: JobPortContext): Promise<JobResultEnvelope>;
}

/**
 * Job 実行コンテキスト。
 *
 * runId と ledger を渡せば、adapter が自身で startStep / succeedStep / failStep / skipStep を呼ぶ。
 */
export interface JobPortContext {
  /** 現在の AgentRun の id (RunLedger.startRun で取得した値) */
  readonly runId: string;
  /** RunLedgerService (Phase 2) のインスタンス */
  readonly ledger: RunLedgerService;
  /** API / scheduler / Job / analysis-engine 境界を横断して追跡する相関ID */
  readonly correlationId?: string;
}

/**
 * Job 実行結果の共通 envelope (WBS §3.2)。
 *
 * raw payload は持たない (`dataRef` で生成物 ID だけ保持)。
 * errorCode / errorMessage は redaction 済みであることを呼び出し側が保証する。
 */
export interface JobResultEnvelope {
  /** 実行成功か (succeeded を ok=true、failed / skipped を ok=false にすると分かりやすい) */
  readonly ok: boolean;
  /** RunLedger に記録する step status (succeeded / failed / skipped のいずれか) */
  readonly status: Exclude<AgentRunStepStatus, 'pending' | 'running'>;
  /** RunLedger step 名 (JobPort.stepName と同じ値) */
  readonly stepName: string;
  /** redaction 済み step 要約 */
  readonly summary: string | null;
  /** 生成物への参照 ID (DB row id 等)。raw data は持たない */
  readonly dataRef?: string | null;
  /** 失敗時の短縮エラーコード (redaction 済み) */
  readonly errorCode?: string | null;
  /** 失敗時の短縮エラーメッセージ (redaction 済み) */
  readonly errorMessage?: string | null;
  /** 次アクション (ADK Orchestrator が分岐に使う) */
  readonly nextAction: AgentRunStepNextAction;
}
