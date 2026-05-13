/**
 * InMemoryTraceSink (Step 2 Phase 2)
 *
 * 配列に event を保持する TraceSink 実装。テスト / ローカル開発で使う。
 *
 * 用途:
 * - Phase 3 で adapter が trace を正しく出すかをテスト
 * - ローカル開発で adapter の挙動を観察
 *
 * 設計書: docs/architecture/STEP_2_ADK_TRACING_SPIKE.md §3.2
 *
 * **注意**:
 * - production で使うと無限にメモリを食う。テスト / 短期 spike 専用
 * - thread-safety は不要 (Node.js single-threaded前提)
 * - `record()` は同期。event の保存に失敗するケースは型上は存在しない
 */

import type { AdkTraceEvent } from './traceTypes';
import type { TraceSink } from './traceSink';

/**
 * 配列に event を蓄積する TraceSink。テスト / 短期 spike 用。
 *
 * @example
 * ```typescript
 * const sink = new InMemoryTraceSink();
 * const tools = skillRegistryToAdkTools(registry, { traceSink: sink });
 * // ... tool を実行 ...
 * console.log(sink.events.length);  // 記録された event 数
 * sink.clear();
 * ```
 */
export class InMemoryTraceSink implements TraceSink {
  private readonly _events: AdkTraceEvent[] = [];

  /**
   * 記録済み event の **readonly snapshot** を返す。
   *
   * 配列自体は内部参照と同じだが、`readonly` 型で返すことで呼び出し側からの
   * 破壊的変更を型レベルで防ぐ。
   */
  get events(): readonly AdkTraceEvent[] {
    return this._events;
  }

  /** event を記録する。同期、throw しない。 */
  record(event: AdkTraceEvent): void {
    this._events.push(event);
  }

  /** 記録済み event を全て破棄する。 */
  clear(): void {
    this._events.length = 0;
  }
}
