/**
 * StrategyDSL → ScreeningBacktestNotePayload 変換アダプタ (Critical-4 段階 2)
 *
 * StrategyBacktesterAgent が DSL を analysis-engine の `/v1/screening-backtest` に投げる際、
 * ノート schema (`ScreeningBacktestNotePayload`) に変換する。
 *
 * 設計方針 (§13):
 * - DSL → ノート変換は TS 側のクライアント責務 (engine 抽象には触れない)
 * - DSL の trigger / triggerConditions (ConditionGroup) は flatten して
 *   conditions[] に展開、Python 側で unsupportedConditions として扱われる
 *   (段階 1 同様、レンズ feature 評価は段階 4 範囲)
 * - パラメータ参照 (`$p1` 等) は呼び出し側で解決済みの `resolvedParams` から差し戻す
 */

import type {
    Condition as DSLCondition,
    ConditionGroup,
    StrategyDSL,
} from './schema';
import type {
    ScreeningBacktestNotePayload,
} from '../../schemas/external/analysisEngine';

type BacktestCondition = ScreeningBacktestNotePayload['conditions'][number];
type BacktestStopLoss = ScreeningBacktestNotePayload['stopLoss'];
type BacktestTakeProfit = ScreeningBacktestNotePayload['takeProfit'];

/**
 * DSL を `ScreeningBacktestNotePayload` に変換する。
 *
 * @param dsl 戦略 DSL
 * @param resolvedParams DSL.parameters のデフォルト値解決済みマップ (defaultParameterValues 由来)
 */
export function dslToBacktestNotePayload(
    dsl: StrategyDSL,
    resolvedParams: Record<string, number>,
): ScreeningBacktestNotePayload {
    return {
        direction: dsl.entry.direction,
        conditions: flattenEntryConditions(dsl.entry).map((c) =>
            dslConditionToBacktest(c, resolvedParams),
        ),
        stopLoss: resolveStopLoss(dsl.stopLoss, resolvedParams),
        takeProfit: resolveTakeProfit(dsl.takeProfit, resolvedParams),
        indicators: [],
    };
}

function flattenEntryConditions(entry: StrategyDSL['entry']): DSLCondition[] {
    const root: ConditionGroup =
        'type' in entry && entry.type === 'wait_for_trigger'
            ? entry.triggerConditions
            : (entry as { trigger: ConditionGroup }).trigger;
    return collectFromGroup(root);
}

function collectFromGroup(group: ConditionGroup): DSLCondition[] {
    const out: DSLCondition[] = [];
    for (const c of group.conditions) {
        if ('logic' in c) {
            out.push(...collectFromGroup(c));
        } else {
            out.push(c);
        }
    }
    return out;
}

function dslConditionToBacktest(
    c: DSLCondition,
    resolvedParams: Record<string, number>,
): BacktestCondition {
    return {
        lensName: c.lens,
        featureKey: c.feature,
        op: c.op,
        value: resolveValueLike(c.value, resolvedParams),
    };
}

function resolveValueLike(
    raw: DSLCondition['value'],
    resolvedParams: Record<string, number>,
): BacktestCondition['value'] {
    if (typeof raw === 'string' && raw.startsWith('$')) {
        const key = raw.substring(1);
        const v = resolvedParams[key];
        if (typeof v === 'number') return v;
        // 解決できない ParamRef は文字列のまま流す (Python 側 unsupportedConditions として扱われる)
        return raw;
    }
    if (Array.isArray(raw)) {
        // tuple [number, number] or string[] のいずれか。tuple の数値は ParamRef でないのでそのまま
        // string[] も Pydantic で受け入れる側が in 演算子用としてそのまま使う
        if (raw.length === 2 && raw.every((x) => typeof x === 'number')) {
            return raw as [number, number];
        }
        return raw as string[];
    }
    return raw;
}

function resolveNumericValue(
    raw: number | string,
    resolvedParams: Record<string, number>,
    fallback: number,
): number {
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string' && raw.startsWith('$')) {
        const key = raw.substring(1);
        const v = resolvedParams[key];
        if (typeof v === 'number') return v;
    }
    return fallback;
}

function resolveStopLoss(
    spec: StrategyDSL['stopLoss'],
    resolvedParams: Record<string, number>,
): BacktestStopLoss {
    if (spec.type === 'atr_multiple') {
        return { type: 'atr_multiple', value: resolveNumericValue(spec.value, resolvedParams, 1.5) };
    }
    if (spec.type === 'fixed_pips') {
        return { type: 'fixed_pips', value: resolveNumericValue(spec.value, resolvedParams, 0) };
    }
    // swing_point
    return {
        type: 'swing_point',
        lookbackBars: Math.max(1, Math.round(resolveNumericValue(spec.lookbackBars, resolvedParams, 20))),
    };
}

function resolveTakeProfit(
    spec: StrategyDSL['takeProfit'],
    resolvedParams: Record<string, number>,
): BacktestTakeProfit {
    const v = resolveNumericValue(spec.value, resolvedParams, 2.0);
    if (spec.type === 'rr_ratio') {
        return { type: 'rr_ratio', value: v };
    }
    if (spec.type === 'atr_multiple') {
        return { type: 'atr_multiple', value: v };
    }
    return { type: 'fixed_pips', value: v };
}
