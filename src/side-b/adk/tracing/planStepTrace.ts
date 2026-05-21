/**
 * Plan 多段 flow step 単位 trace ヘルパー (P3)
 *
 * 用途:
 *   `AIOrchestrator.generatePlan` の 8 段 (research / specialists / hypothesis_generator
 *   / bull_bear_debate / devils_advocate / plan_ai / persist / pdca_notify) を 1 step
 *   ずつ wrap し、`adk.subagent.*` 系の trace event を emit する。
 *
 * trace kind 選定 (`adk.subagent.*` の流用):
 *   Plan 多段は **論理的に sequential なステップ** で、`traceTypes.ts` の docstring
 *   が `adk.subagent.*` を「step 識別子としての再利用」と明記しているケースに該当
 *   する。新 kind を追加せず既存 enum を流用することで、既存 sink 実装
 *   (Noop / InMemory / RunLedger) を無改修で利用可能。
 *
 * 設計方針:
 *   - 本処理 (= fn 実行) を絶対に壊さない: trace 失敗は `safeRecord` で握りつぶす、
 *     fn の throw はそのまま伝播する (caller の catch を尊重)。
 *   - raw payload を保存しない: args / result は `payloadToSummary` で要約のみ
 *     (`AdkTraceEvent.argsSummary` / `resultSummary` の契約と整合)。
 *
 * @see traceTypes.ts §「Sub-Agent 実行」
 */

import { randomUUID } from 'crypto';

import type { TraceSink } from './traceSink';
import { safeRecord } from './safeRecord';
import { payloadToSummary, shortenErrorMessage } from './traceSummaries';

/**
 * Plan step trace の共通コンテキスト。
 *
 * `tracePlanStep()` の 1 回呼出ごとに変わらない値 (= sink / agentName / invocationId)
 * を 1 つに束ねる。`AIOrchestrator.generatePlan` 内では 1 回構築して 8 step で使い回す。
 */
export interface PlanStepTraceContext {
    /** trace 投入先 (NoopTraceSink を渡すと no-op になり既存挙動と同一)。 */
    readonly sink: TraceSink;
    /** event の `agentName` フィールドに入る値。AIOrchestrator では 'aiOrchestrator' 固定。 */
    readonly agentName: string;
    /** ADK Context.invocationId 相当 (= 1 回の generatePlan 呼出を識別)。任意。 */
    readonly invocationId?: string;
    /** event の `callerReason` フィールドに入る値。AIOrchestrator では 'plan-multi-stage' を想定。 */
    readonly callerReason: string;
}

/**
 * Plan 多段の 1 step を trace で wrap して実行する。
 *
 * `adk.subagent.started` → `fn()` → `adk.subagent.completed | failed` の 3 event を
 * `safeRecord` 経由で emit。`fn` の例外は trace に記録した上でそのまま再 throw する。
 *
 * @param ctx Plan 多段共通の trace context (sink / agentName / invocationId / callerReason)
 * @param stepName step 識別子 (= `event.skillName` に入る、例: 'research')
 * @param args step に渡す引数 (raw は保存されず、`payloadToSummary` で要約のみ記録)
 * @param fn step 本体 (例: `() => researchAIService.generateResearch(input)`)
 *
 * @returns `fn()` の戻り値
 * @throws `fn()` が throw した例外 (trace に failed event を記録した上で再 throw)
 */
export async function tracePlanStep<T>(
    ctx: PlanStepTraceContext,
    stepName: string,
    // args は呼出側 step の input object をそのまま受け取る。本関数は payloadToSummary
    // 経由で要約のみ記録するため、構造は問わない (`unknown` 持ち回り回避のため
    // step 側の input 型をそのまま型推論で流す)。
    args: Parameters<typeof payloadToSummary>[0],
    fn: () => Promise<T>,
): Promise<T> {
    const parentTraceId = randomUUID();
    const startedAt = new Date();

    safeRecord(ctx.sink, {
        kind: 'adk.subagent.started',
        traceId: parentTraceId,
        invocationId: ctx.invocationId,
        agentName: ctx.agentName,
        skillName: stepName,
        callerReason: ctx.callerReason,
        startedAt,
        status: 'started',
        argsSummary: payloadToSummary(args),
    });

    try {
        const result = await fn();
        const endedAt = new Date();
        safeRecord(ctx.sink, {
            kind: 'adk.subagent.completed',
            traceId: randomUUID(),
            parentTraceId,
            invocationId: ctx.invocationId,
            agentName: ctx.agentName,
            skillName: stepName,
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
        // step 内で throw された値は型システム上 unknown だが、本 helper は
        // tracing ディレクトリ内で raw 値を扱わず safeStringify / shortenErrorMessage
        // 経由で文字列化するため、明示的に narrow して error message のみ取り出す。
        const message =
            err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown error';
        safeRecord(ctx.sink, {
            kind: 'adk.subagent.failed',
            traceId: randomUUID(),
            parentTraceId,
            invocationId: ctx.invocationId,
            agentName: ctx.agentName,
            skillName: stepName,
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
