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
    ScreeningBacktestConditionGroup,
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
    const dslGroup = extractDslConditionGroup(dsl.entry);
    return {
        direction: dsl.entry.direction,
        // PR #112 後方互換: flatten 配列も従来通り運ぶ (旧 Python / 旧 client の fallback 用)。
        conditions: collectFromGroup(dslGroup).map((c) =>
            dslConditionToBacktest(c, resolvedParams),
        ),
        // PR #112: AND/OR 構造を保ったまま運ぶ。Python 側はこちらを優先評価する。
        triggerGroup: dslConditionGroupToBacktest(dslGroup, resolvedParams),
        stopLoss: resolveStopLoss(dsl.stopLoss, resolvedParams),
        takeProfit: resolveTakeProfit(dsl.takeProfit, resolvedParams),
        indicators: [],
    };
}

function extractDslConditionGroup(entry: StrategyDSL['entry']): ConditionGroup {
    return 'type' in entry && entry.type === 'wait_for_trigger'
        ? entry.triggerConditions
        : (entry as { trigger: ConditionGroup }).trigger;
}

/**
 * DSL の ConditionGroup を ScreeningBacktestConditionGroup に再帰変換する。
 * AND/OR 構造を保ったまま、各 leaf の `Condition` を BT 用 leaf
 * (`{ lensName, featureKey, op, value }`) に正規化する。
 */
function dslConditionGroupToBacktest(
    group: ConditionGroup,
    resolvedParams: Record<string, number>,
): ScreeningBacktestConditionGroup {
    return {
        logic: group.logic,
        conditions: group.conditions.map((c) =>
            'logic' in c
                ? dslConditionGroupToBacktest(c, resolvedParams)
                : dslConditionToBacktest(c, resolvedParams),
        ),
    };
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

/**
 * PR #116a: `compareTarget` を持つ condition (= value 未指定) は old payload 形式
 * では表現できない。analysis-engine 側で compareTarget を解釈する PR #116c までは
 * sentinel string を value に詰めて Python 側で確実に false 評価させる
 * (`number op string` は false に倒れる)。
 *
 * PR #116c で payload schema を拡張したらこの sentinel 経路は撤去する。
 */
const UNSUPPORTED_COMPARE_TARGET_SENTINEL = '__pr116a_unsupported_compareTarget__';

function dslConditionToBacktest(
    c: DSLCondition,
    resolvedParams: Record<string, number>,
): BacktestCondition {
    return {
        lensName: c.lens,
        featureKey: c.feature,
        op: c.op,
        value:
            c.value !== undefined
                ? resolveValueLike(c.value, resolvedParams)
                : UNSUPPORTED_COMPARE_TARGET_SENTINEL,
    };
}

function resolveValueLike(
    // PR #116a: DSLCondition['value'] は optional 化されたが、本関数は呼び出し側
    // (`dslConditionToBacktest`) で undefined を弾いてから渡される前提。
    raw: NonNullable<DSLCondition['value']>,
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
        // tuple [number, number] (between 演算子用): 両方 number ならそのまま
        if (raw.length === 2 && raw.every((x) => typeof x === 'number')) {
            return raw as [number, number];
        }
        // それ以外 (string[] / 混在 / number[] not 2-tuple) は in 演算子用として string[] に正規化
        // analysis-engine の Zod schema は string[] のみ受け入れる前提、number 要素も String() で文字列化する
        return raw.map((x) => String(x));
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

/**
 * SL/TP の Zod schema は全 spec で `value: positive()` が必須。
 * - ParamRef が解決できない / raw が 0 や負数のケースでも positive を満たすよう
 *   下限 (`MIN_POSITIVE`) で clamp する
 * - fallback もそれぞれ正の値 (atr_multiple→1.5, fixed_pips→1.0, rr_ratio→2.0)
 *
 * 段階 1 では fixed_pips / swing_point は engine 側で未対応のため、これらが渡っても
 * runner.py の `detect_unsupported_specs` で early-return される。本ファイルは
 * Zod parse をまず通すために clamp + 正の fallback を必ず保証するのが責務。
 */
const MIN_POSITIVE = 0.001;

function clampPositive(value: number, fallback: number): number {
    if (Number.isFinite(value) && value > 0) return value;
    return fallback;
}

function resolveStopLoss(
    spec: StrategyDSL['stopLoss'],
    resolvedParams: Record<string, number>,
): BacktestStopLoss {
    if (spec.type === 'atr_multiple') {
        const raw = resolveNumericValue(spec.value, resolvedParams, 1.5);
        return { type: 'atr_multiple', value: Math.max(MIN_POSITIVE, clampPositive(raw, 1.5)) };
    }
    if (spec.type === 'fixed_pips') {
        const raw = resolveNumericValue(spec.value, resolvedParams, 1.0);
        return { type: 'fixed_pips', value: Math.max(MIN_POSITIVE, clampPositive(raw, 1.0)) };
    }
    // swing_point: lookbackBars は int positive
    const rawLb = resolveNumericValue(spec.lookbackBars, resolvedParams, 20);
    return {
        type: 'swing_point',
        lookbackBars: Math.max(1, Math.round(clampPositive(rawLb, 20))),
    };
}

function resolveTakeProfit(
    spec: StrategyDSL['takeProfit'],
    resolvedParams: Record<string, number>,
): BacktestTakeProfit {
    if (spec.type === 'rr_ratio') {
        const raw = resolveNumericValue(spec.value, resolvedParams, 2.0);
        return { type: 'rr_ratio', value: Math.max(MIN_POSITIVE, clampPositive(raw, 2.0)) };
    }
    if (spec.type === 'atr_multiple') {
        const raw = resolveNumericValue(spec.value, resolvedParams, 2.0);
        return { type: 'atr_multiple', value: Math.max(MIN_POSITIVE, clampPositive(raw, 2.0)) };
    }
    // fixed_pips
    const raw = resolveNumericValue(spec.value, resolvedParams, 1.0);
    return { type: 'fixed_pips', value: Math.max(MIN_POSITIVE, clampPositive(raw, 1.0)) };
}
