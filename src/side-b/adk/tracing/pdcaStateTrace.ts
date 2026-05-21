/**
 * PDCALoop state handler 単位 trace ヘルパー (P3b)
 *
 * 用途:
 *   `PDCALoop.tick()` の switch case 7 種 (IDLE / SESSION_OPEN / MONITORING /
 *   EVALUATING_ENTRY / MANAGING_POSITION / REFLECTING / REVISING_STRATEGY) を
 *   1 state ずつ wrap し、`pdca.state.*` 系の trace event を emit する。
 *
 * trace kind 選定 (新規 `pdca.state.*`):
 *   P3a の Plan 多段 trace は `adk.subagent.*` を流用したが、PDCA state は
 *   **state machine 遷移** で意味論が違うため、Issue #239 で確認の上 案 A
 *   (新 kind 追加) を採用。`kind` の prefix だけで Plan / PDCA を識別できる。
 *
 * 設計方針 (planStepTrace.ts と同パターン):
 *   - 本処理 (= fn 実行) を絶対に壊さない: trace 失敗は `safeRecord` で握りつぶす、
 *     fn の throw はそのまま伝播する (caller の catch を尊重)。
 *   - 同期ハンドラ / 非同期ハンドラ両方を受ける: `fn: () => TResult | Promise<TResult>`。
 *     handleReflecting だけが async で他は sync、tick() 自身が async なので await 1 段で吸収。
 *   - raw payload を保存しない: args (= 状態識別のための context) は `payloadToSummary` で要約。
 *
 * @see traceTypes.ts §「PDCA state 遷移」
 * @see planStepTrace.ts (姉妹実装、Plan 多段 sequential step 用)
 */

import { randomUUID } from 'crypto';

import type { TraceSink } from './traceSink';
import { safeRecord } from './safeRecord';
import { payloadToSummary, shortenErrorMessage } from './traceSummaries';

/**
 * PDCA state trace の共通コンテキスト。
 *
 * `PDCALoop.tick()` の 1 回呼出ごとに 1 つ構築し、その tick 内のすべての
 * `tracePdcaState` 呼出に渡す。`invocationId` は cycle ごとに新しい UUID を割り当てる
 * ことを想定 (= Observer MVP から「同じ tick のイベント群」を識別可能)。
 */
export interface PdcaStateTraceContext {
    /** trace 投入先 (NoopTraceSink を渡すと no-op になり既存挙動と同一)。 */
    readonly sink: TraceSink;
    /** event の `agentName` フィールドに入る値。PDCALoop では 'pdcaLoop' 固定。 */
    readonly agentName: string;
    /** ADK Context.invocationId 相当 (= 1 回の tick 呼出を識別)。任意。 */
    readonly invocationId?: string;
    /** event の `callerReason` フィールドに入る値。PDCALoop では 'pdca-state-machine' を想定。 */
    readonly callerReason: string;
}

/**
 * PDCA state handler 1 回分を trace で wrap して実行する。
 *
 * `pdca.state.started` → `fn()` → `pdca.state.completed | failed` の 2 event を
 * `safeRecord` 経由で emit する (成功なら started + completed、失敗なら started + failed)。
 * `fn` が同期 / 非同期どちらでも受けられる (= await で吸収)。
 *
 * 型パラメータ (`TArgs` / `TResult`):
 *   呼出側の args / fn 戻り値型をそのまま受け取り、本ファイル内で `unknown` を
 *   持ち回らないようにする (planStepTrace と同方針)。
 *
 * @param ctx PDCA tick 共通の trace context
 * @param stateName state 識別子 (= `event.skillName` に入る、例: 'IDLE')
 * @param args state context (cycle / marketOpen / 等のスカラ snapshot、raw 値は保存されない)
 * @param fn state handler 本体 (sync / async どちらでも可)
 *
 * @returns `fn()` の戻り値 (await で吸収済み)
 * @throws `fn()` が throw した例外 (trace に failed event を記録した上で再 throw)
 */
export async function tracePdcaState<TArgs, TResult>(
    ctx: PdcaStateTraceContext,
    stateName: string,
    args: TArgs,
    fn: () => TResult | Promise<TResult>,
): Promise<TResult> {
    const parentTraceId = randomUUID();
    const startedAt = new Date();

    safeRecord(ctx.sink, {
        kind: 'pdca.state.started',
        traceId: parentTraceId,
        invocationId: ctx.invocationId,
        agentName: ctx.agentName,
        skillName: stateName,
        callerReason: ctx.callerReason,
        startedAt,
        status: 'started',
        argsSummary: payloadToSummary(args),
    });

    try {
        const result = await fn();
        const endedAt = new Date();
        safeRecord(ctx.sink, {
            kind: 'pdca.state.completed',
            traceId: randomUUID(),
            parentTraceId,
            invocationId: ctx.invocationId,
            agentName: ctx.agentName,
            skillName: stateName,
            callerReason: ctx.callerReason,
            startedAt,
            endedAt,
            durationMs: endedAt.getTime() - startedAt.getTime(),
            status: 'ok',
            argsSummary: payloadToSummary(args),
            resultSummary: payloadToSummary(result),
        });
        return result;
    } catch (err) {
        const endedAt = new Date();
        // step 内で throw された値は型システム上 unknown。本 helper では raw を持ち回らず
        // Error / string にのみ narrow し、それ以外は固定文字列にフォールバックする
        // (planStepTrace.ts と同方針)。
        const message =
            err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown error';
        safeRecord(ctx.sink, {
            kind: 'pdca.state.failed',
            traceId: randomUUID(),
            parentTraceId,
            invocationId: ctx.invocationId,
            agentName: ctx.agentName,
            skillName: stateName,
            callerReason: ctx.callerReason,
            startedAt,
            endedAt,
            durationMs: endedAt.getTime() - startedAt.getTime(),
            status: 'thrown',
            errorMessage: shortenErrorMessage(message),
            argsSummary: payloadToSummary(args),
        });
        throw err;
    }
}
