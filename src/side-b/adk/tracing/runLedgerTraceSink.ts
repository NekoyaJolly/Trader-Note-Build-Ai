/**
 * RunLedgerTraceSink
 *
 * ADK trace event (`AdkTraceEvent`) を `RunLedgerService` に橋渡しする TraceSink 実装。
 * adapter は `adk/` 配下に置き、依存方向 (`adk/` → `services/` のみ、逆禁止) を保つ。
 *
 * 設計方針:
 *   - raw payload は保存しない (= AdkTraceEvent 側で既に TracePayloadSummary 化済み、
 *     RunLedger の summary / errorMessage も Service 内 redaction を経由)
 *   - TraceSink.record() は throw / reject しない (failure isolation):
 *     内部で全例外を握りつぶし、ADK / Job 本体実行を壊さない
 *   - 1 run に 1 つの sink を bind する設計 (factory が runId を受ける)
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §10 (Phase 5)
 */

import type { TraceSink } from './traceSink';
import type { AdkTraceEvent } from './traceTypes';
import type { RunLedgerService } from '../../services/runLedgerService';

/**
 * RunLedger 連携 TraceSink を作る factory。
 *
 * 動作:
 *   - `*.started` event: startStep を呼ぶ (stepName = event.skillName)。
 *     既に同名 step が開始済み (= ADK 内で既に startStep が呼ばれた) なら no-op。
 *   - `*.completed` event: succeedStep を呼ぶ (summary は event.skillName + duration)。
 *   - `*.failed` event: failStep を呼ぶ (errorCode / errorMessage を伝播)。
 *
 * 失敗 isolation:
 *   - record() 自体は **絶対に throw / reject しない**。
 *   - 内部例外 (ledger 呼び出しの DB エラー、状態遷移違反等) は console.warn でログだけ残し、握りつぶす。
 *   - これにより ADK / Job 本体実行は trace sink 不調で停止しない (WBS §5.4)。
 *
 * @param ledger 既存 RunLedgerService instance
 * @param runId trace を紐付ける AgentRun.id (sink 作成時に bind)
 * @param logger optional warn logger (default: console.warn)
 */
export function createRunLedgerTraceSink(
  ledger: RunLedgerService,
  runId: string,
  logger: { warn(message: string): void } = console,
): TraceSink {
  return {
    async record(event: AdkTraceEvent): Promise<void> {
      try {
        await routeEvent(ledger, runId, event);
      } catch (err) {
        // failure isolation: trace sink の例外は本体実行を壊さない。
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(
          `[RunLedgerTraceSink] record failed (kind=${event.kind} step=${event.skillName} runId=${runId}): ${message}`,
        );
      }
    },
  };
}

/**
 * event.kind に応じて RunLedgerService の対応 API を呼ぶ。
 */
async function routeEvent(
  ledger: RunLedgerService,
  runId: string,
  event: AdkTraceEvent,
): Promise<void> {
  const stepName = event.skillName;
  const traceKind = inferTraceKind(event.kind);

  if (isStartedKind(event.kind)) {
    await ledger.startStep(runId, { stepName, traceKind });
    return;
  }

  if (isCompletedKind(event.kind)) {
    await ledger.succeedStep(runId, stepName, {
      summary: composeSummary(event),
      nextAction: 'proceed',
    });
    return;
  }

  if (isFailedKind(event.kind)) {
    await ledger.failStep(runId, stepName, {
      errorCode: event.errorCode ?? 'ADK_TRACE_FAILED',
      errorMessage: event.errorMessage ?? null,
      summary: composeSummary(event),
      nextAction: 'stop',
    });
    return;
  }
}

function isStartedKind(kind: AdkTraceEvent['kind']): boolean {
  return kind === 'adk.skill.started' || kind === 'adk.subagent.started';
}

function isCompletedKind(kind: AdkTraceEvent['kind']): boolean {
  return kind === 'adk.skill.completed' || kind === 'adk.subagent.completed';
}

function isFailedKind(kind: AdkTraceEvent['kind']): boolean {
  return kind === 'adk.skill.failed' || kind === 'adk.subagent.failed';
}

/**
 * traceKind を AdkTraceEvent.kind から推論する (RunLedger.startStep に渡す値)。
 */
function inferTraceKind(kind: AdkTraceEvent['kind']): string {
  if (kind === 'adk.skill.started' || kind === 'adk.skill.completed' || kind === 'adk.skill.failed') {
    return 'adk-skill';
  }
  return 'adk-subagent';
}

/**
 * Summary 文字列を組み立てる (raw payload は乗せず、メタ情報のみ)。
 */
function composeSummary(event: AdkTraceEvent): string {
  const parts: string[] = [];
  parts.push(`kind=${event.kind}`);
  if (event.durationMs !== undefined) parts.push(`durationMs=${event.durationMs}`);
  if (event.argsSummary?.fieldCount !== undefined) {
    parts.push(`args.fieldCount=${event.argsSummary.fieldCount}`);
  }
  if (event.resultSummary?.fieldCount !== undefined) {
    parts.push(`result.fieldCount=${event.resultSummary.fieldCount}`);
  }
  return parts.join(', ');
}
