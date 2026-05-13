/**
 * NoopTraceSink (Step 2 Phase 2)
 *
 * 何もしない TraceSink 実装。production default として使う。
 *
 * 用途:
 * - `skillRegistryToAdkTools(registry)` (= options 未指定) で内部的に使う
 * - trace を実際には集めたくないが、adapter のコードパスを統一したい場合
 *
 * 設計書: docs/architecture/STEP_2_ADK_TRACING_SPIKE.md §3.2
 */

import type { AdkTraceEvent } from './traceTypes';
import type { TraceSink } from './traceSink';

/**
 * 何もしない TraceSink。
 *
 * `record(event)` は即座に void を返し、event は捨てられる。例外も投げない。
 *
 * @example
 * ```typescript
 * const tools = skillRegistryToAdkTools(registry, { traceSink: new NoopTraceSink() });
 * // 上記は { traceSink を渡さない } と等価
 * ```
 */
export class NoopTraceSink implements TraceSink {
  // _event prefix で未使用を明示 (TraceSink interface 整合のため引数を受ける)
  record(_event: AdkTraceEvent): void {
    // 意図的に何もしない
  }
}
