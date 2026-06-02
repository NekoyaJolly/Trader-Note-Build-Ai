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

import { normalizeTimeframe } from '../../shared/timeframes';
import type {
    Condition as DSLCondition,
    ConditionGroup,
    StrategyDSL,
} from './schema';
import type {
    ScreeningBacktestConditionGroup,
    ScreeningBacktestNotePayload,
} from '../../schemas/external/analysisEngine';
import { resolveIndicatorFeature } from './indicatorFeatureAlias';

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
        // PR #116c: DSL condition の params / compareTarget を walk して、Python 側で
        // pre-compute すべき indicator series 一覧を自動 populate する。
        indicators: collectIndicatorSpecsFromDslGroup(dslGroup),
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
 * PR #116a で導入し、PR #116c で **経路撤去済み** の sentinel 文字列。
 *
 * PR #116c で `ScreeningBacktestCondition` schema が `params` / `compareTarget` を
 * 受けるようになったため、compareTarget 付き condition は新 schema で素直に表現される。
 * 本 sentinel は **下流テスト互換のために値だけ export を維持** する (= 過去 PR で
 * sentinel value をリテラル pin していたテストを壊さないため)。
 * `dslConditionToBacktest` からは出力されない。
 *
 * PR #120 Copilot review #6: 「PR #116c で撤去予定」の表記を「撤去済み」に更新。
 *
 * @deprecated PR #116c で role 完了。新コードは `compareTarget` を直接使うこと。
 */
export const UNSUPPORTED_COMPARE_TARGET_SENTINEL = '__pr116a_unsupported_compareTarget__';

/**
 * DSL condition を BT condition に変換する。
 *
 * PR #116c: compareTarget 付き condition も新 schema (`compareTarget` フィールド) で
 * そのまま渡せるようになったため、PR #116a の sentinel 経路は撤去。
 */
function dslConditionToBacktest(
    c: DSLCondition,
    resolvedParams: Record<string, number>,
): BacktestCondition {
    // PR ⑤B (MTF) + PR #130 Copilot review #3-4: condition.timeframe を canonical
    // 化してから payload に載せる。analysis-engine は canonical のみ対応するため、
    // alias / 大小文字違い (`'60m'` / `'1H'`) で送ると判定が崩れる。未知 timeframe
    // は **payload に含めない** (= 主 timeframe 扱いで送る)。compareTarget も同様。
    const cTf = c.timeframe ? normalizeTimeframe(c.timeframe) : undefined;
    const base = {
        lensName: c.lens,
        featureKey: c.feature,
        op: c.op,
        ...(c.params && Object.keys(c.params).length > 0 ? { params: { ...c.params } } : {}),
        ...(cTf ? { timeframe: cTf } : {}),
    };
    if (c.compareTarget) {
        const targetTfRaw = c.compareTarget.timeframe;
        const targetTf = targetTfRaw ? normalizeTimeframe(targetTfRaw) : undefined;
        return {
            ...base,
            compareTarget: {
                lensName: c.compareTarget.lens,
                featureKey: c.compareTarget.feature,
                ...(c.compareTarget.params && Object.keys(c.compareTarget.params).length > 0
                    ? { params: { ...c.compareTarget.params } }
                    : {}),
                ...(targetTf ? { timeframe: targetTf } : {}),
            },
        };
    }
    if (c.value !== undefined) {
        return {
            ...base,
            value: resolveValueLike(c.value, resolvedParams),
        };
    }
    // PR ①-B: is_true / is_false は左辺の Boolean 評価のみで RHS 不要 (= 設計上の妥当ケース)。
    // value / compareTarget なしでも analysis-engine 側 _evaluate_leaf が left のみ参照する。
    if (c.op === 'is_true' || c.op === 'is_false') {
        return base;
    }
    // PR #118 Copilot review #2: ConditionSchema の superRefine が
    // value / compareTarget の片方を必須としているためここには到達しないが、
    // 型破壊経路 (例: `as` キャストで強制) で素通りすると不完全な condition を
    // Python 側に送ってしまい、原因不明の false 評価になる。明示 throw で
    // 早期に気付けるようにする。
    throw new Error(
        `dslConditionToBacktest: condition に value / compareTarget が両方欠落 ` +
            `(lens=${c.lens}, feature=${c.feature}, op=${c.op})`,
    );
}

/**
 * PR #116c: DSL ConditionGroup を walk して必要な indicator series spec 一覧を抽出する。
 *
 * - `lens === 'ohlcv'` で動的パラメータ付き feature (例: ema(20)) → spec 化
 * - `compareTarget` の operand も同様に spec 化
 * - 同じ (indicatorId, params) は重複排除
 *
 * Python 側 (`runner_backtesting_py.py`) は notePayload.indicators[] を pre-compute して、
 * `lens.feature(stable_params)` 形式の snapshot key で series を保持する。
 */
function collectIndicatorSpecsFromDslGroup(
    group: ConditionGroup,
): ScreeningBacktestNotePayload['indicators'] {
    const map = new Map<string, ScreeningBacktestNotePayload['indicators'][number]>();
    const visit = (lens: string, feature: string, params?: Record<string, number>) => {
        if (lens !== 'ohlcv') return;
        // params 無しは static feature (open/high/low/close/volume/rsi/atr) として扱い、
        // notePayload.indicators[] に積む必要は無い (= snapshot 構築側で常時計算済み)
        if (!params || Object.keys(params).length === 0) return;
        const resolved = resolveIndicatorFeature(feature);
        if (!resolved) return;
        const stableKey = `${feature}|${JSON.stringify(params, Object.keys(params).sort())}`;
        if (!map.has(stableKey)) {
            map.set(stableKey, {
                indicatorId: resolved.indicatorId,
                params: { ...params },
                field: resolved.field,
            });
        }
    };
    const walk = (g: ConditionGroup) => {
        for (const c of g.conditions) {
            if ('logic' in c) {
                walk(c);
            } else {
                visit(c.lens, c.feature, c.params);
                if (c.compareTarget) {
                    visit(c.compareTarget.lens, c.compareTarget.feature, c.compareTarget.params);
                }
            }
        }
    };
    walk(group);
    return Array.from(map.values());
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
