/**
 * ADK tracing 公開エクスポート (Step 2 Phase 2)
 *
 * `/src/side-b/adk/tracing/` 配下の公開 API を 1 箇所に集約。
 *
 * 設計書:
 * - docs/architecture/STEP_2_KICKOFF.md §4 §5
 * - docs/architecture/STEP_2_ADK_TRACING_SPIKE.md §3
 *
 * 使用例:
 * ```typescript
 * import {
 *   InMemoryTraceSink,
 *   NoopTraceSink,
 *   type AdkTraceEvent,
 *   type TraceSink,
 * } from '../tracing';
 *
 * const sink = new InMemoryTraceSink();
 * // ... adapter に渡す ...
 * ```
 */

// 型
export type {
  AdkTraceEvent,
  AdkTraceEventKind,
  AdkTraceStatus,
  TracePayloadSummary,
} from './traceTypes';

// interface
export type { TraceSink } from './traceSink';

// 実装
export { NoopTraceSink } from './noopTraceSink';
export { InMemoryTraceSink } from './inMemoryTraceSink';

// summary / redaction
export {
  payloadToSummary,
  shortenErrorMessage,
  TOP_LEVEL_KEYS_LIMIT,
  KEY_NAME_LIMIT,
  DEFAULT_ERROR_MESSAGE_MAX,
} from './traceSummaries';

// safe trace recording (P3)
export { safeRecord } from './safeRecord';

// Plan 多段 step trace helper (P3)
export { tracePlanStep, type PlanStepTraceContext } from './planStepTrace';

// PDCA state machine trace helper (P3b)
export { tracePdcaState, type PdcaStateTraceContext } from './pdcaStateTrace';
