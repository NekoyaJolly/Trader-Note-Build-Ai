/**
 * TraceSink interface (Step 2 Phase 2)
 *
 * AdkTraceEvent の出力先を抽象化する interface。adapter は `TraceSink` に対して
 * `record()` を呼ぶだけで、実装側で必要な処理 (ログ出力 / 配列保持 / OTel exporter 等)
 * を行う。
 *
 * 設計書: docs/architecture/STEP_2_ADK_TRACING_SPIKE.md §3.2
 *
 * 実装方針:
 * - `NoopTraceSink` (production default): 何もしない
 * - `InMemoryTraceSink` (test / local): 配列に push
 * - 将来追加候補: `OtelTraceSink` (Step 3 以降の判断材料)
 *
 * **重要**: adapter は `traceSink.record()` の失敗で Skill 実行を壊さない。
 * 実装側で throw する可能性がある場合は、adapter で try/catch して握りつぶす。
 *
 * 依存方向: adk → 標準ライブラリ + 同 dir の traceTypes のみ。
 */

import type { AdkTraceEvent } from './traceTypes';

/**
 * ADK trace event の出力先。
 *
 * `record` は同期でも非同期でもよい。adapter 側は戻り値を await しても良いが、
 * adapter は `record` の throw / reject で Skill 実行を壊さない責務がある。
 */
export interface TraceSink {
  record(event: AdkTraceEvent): void | Promise<void>;
}
