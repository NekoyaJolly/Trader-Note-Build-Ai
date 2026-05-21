/**
 * `TraceSink.record()` を「絶対に throw しない」形で呼ぶための薄いラッパー (P3)。
 *
 * 既存 `skillRegistryToAdkTools.ts` 内に private で存在していた `safeRecord` を
 * `tracing/` 配下に切り出し、Skill adapter と Plan 多段 trace helper の両方から
 * 再利用できるようにしたもの。実装は等価 (= 同期 throw も Promise reject も握り
 * つぶす)。
 *
 * Why: trace 出力で本処理を壊さない契約を共通基盤として確立する。
 * sink 実装 (NoopTraceSink / InMemoryTraceSink / RunLedgerTraceSink) のいずれが
 * 入っても、本関数を経由すれば呼び出し元は例外を意識せずに済む。
 */

import type { AdkTraceEvent } from './traceTypes';
import type { TraceSink } from './traceSink';

export function safeRecord(sink: TraceSink, event: AdkTraceEvent): void {
    try {
        const maybePromise = sink.record(event);
        if (maybePromise instanceof Promise) {
            // 非同期実装の reject も握りつぶす
            maybePromise.catch(() => {
                /* swallow */
            });
        }
    } catch {
        // 同期 throw も握りつぶす
    }
}
