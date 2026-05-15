/**
 * DiscoveryAgent の統計エンジン（Phase 4a）
 *
 * 設計思想（CLAUDE.md 原則3）:
 * - 数値最適化・統計処理は TypeScript の決定論的コードで実装する
 * - LLM には「何がエッジになりそうか」の解釈だけを任せる
 *
 * 計算内容:
 * - 各 (lensName, featureKey) について、勝ちトレードと負けトレードで
 *   特徴量分布を比較し、分離度スコアを算出する
 * - 数値 feature: Cohen's d（効果量）
 * - カテゴリ feature: 条件付き勝率とベース勝率の乖離
 */

import type { AITradeNote } from '../models/aiTradeNote';

export interface WinLossSplit {
    wins: Array<number | string | boolean>;
    losses: Array<number | string | boolean>;
}

export interface FeatureSeparation {
    lensName: string;
    featureKey: string;
    /** 0.0〜 の値（大きいほど勝敗で分離している） */
    separationScore: number;
    /** 計算に使った勝ちトレード数 */
    winSampleCount: number;
    /** 計算に使った負けトレード数 */
    lossSampleCount: number;
    /** 数値特徴量のサマリー（カテゴリ特徴量の場合は null） */
    numericSummary?: {
        winMean: number;
        lossMean: number;
        winStd: number;
        lossStd: number;
    };
    /** カテゴリ特徴量のサマリー（数値の場合は null） */
    categoricalSummary?: {
        /** 値 → その値の時の勝率 */
        conditionalWinRate: Record<string, number>;
        /** ベース勝率（全体） */
        baseWinRate: number;
    };
}

// ===========================================
// 集計
// ===========================================

/**
 * AITradeNote 配列から lens feature ごとに勝敗分布を集計する。
 */
export function aggregateFeatureValues(
    notes: readonly AITradeNote[],
): Map<string, WinLossSplit> {
    const out = new Map<string, WinLossSplit>();

    for (const note of notes) {
        const snapshot = note.lensSnapshot;
        if (!snapshot || !snapshot.features) continue;
        const outcome = note.result.outcome;
        if (outcome !== 'win' && outcome !== 'loss') continue;

        for (const [lensName, features] of Object.entries(snapshot.features)) {
            if (!features || typeof features !== 'object') continue;
            for (const [featureKey, value] of Object.entries(features)) {
                if (value === undefined || value === null) continue;
                const key = `${lensName}::${featureKey}`;
                let split = out.get(key);
                if (!split) {
                    split = { wins: [], losses: [] };
                    out.set(key, split);
                }
                if (outcome === 'win') split.wins.push(value);
                else split.losses.push(value);
            }
        }
    }

    return out;
}

// ===========================================
// 分離度計算
// ===========================================

export function computeFeatureSeparations(
    splits: Map<string, WinLossSplit>,
    options?: { minSamplesPerGroup?: number },
): FeatureSeparation[] {
    const minSamples = options?.minSamplesPerGroup ?? 3;
    const results: FeatureSeparation[] = [];

    for (const [key, split] of splits.entries()) {
        if (split.wins.length < minSamples || split.losses.length < minSamples) continue;

        const [lensName, featureKey] = key.split('::');
        const numeric = isAllNumeric(split.wins) && isAllNumeric(split.losses);

        if (numeric) {
            const winNums = split.wins as number[];
            const lossNums = split.losses as number[];
            const summary = computeNumericSummary(winNums, lossNums);
            const score = cohensD(winNums, lossNums);
            results.push({
                lensName,
                featureKey,
                separationScore: Math.abs(score),
                winSampleCount: winNums.length,
                lossSampleCount: lossNums.length,
                numericSummary: summary,
            });
        } else {
            const summary = computeCategoricalSummary(split);
            const score = categoricalSeparation(summary);
            results.push({
                lensName,
                featureKey,
                separationScore: score,
                winSampleCount: split.wins.length,
                lossSampleCount: split.losses.length,
                categoricalSummary: summary,
            });
        }
    }

    // 分離度の降順でソート
    results.sort((a, b) => b.separationScore - a.separationScore);
    return results;
}

// ===========================================
// 内部ユーティリティ
// ===========================================

function isAllNumeric(values: readonly (number | string | boolean)[]): boolean {
    return values.every((v) => typeof v === 'number' && Number.isFinite(v));
}

function mean(values: readonly number[]): number {
    if (values.length === 0) return 0;
    let sum = 0;
    for (const v of values) sum += v;
    return sum / values.length;
}

function stdDev(values: readonly number[], m: number): number {
    if (values.length === 0) return 0;
    let sq = 0;
    for (const v of values) sq += (v - m) ** 2;
    return Math.sqrt(sq / values.length);
}

function computeNumericSummary(
    wins: readonly number[],
    losses: readonly number[],
): NonNullable<FeatureSeparation['numericSummary']> {
    const winMean = mean(wins);
    const lossMean = mean(losses);
    return {
        winMean,
        lossMean,
        winStd: stdDev(wins, winMean),
        lossStd: stdDev(losses, lossMean),
    };
}

/**
 * Cohen's d 効果量。
 * |d| > 0.2 が small, > 0.5 が medium, > 0.8 が large の目安。
 */
export function cohensD(winNums: readonly number[], lossNums: readonly number[]): number {
    if (winNums.length === 0 || lossNums.length === 0) return 0;
    const winMean = mean(winNums);
    const lossMean = mean(lossNums);
    const winVar = stdDev(winNums, winMean) ** 2;
    const lossVar = stdDev(lossNums, lossMean) ** 2;
    const pooledSd = Math.sqrt((winVar + lossVar) / 2);
    if (pooledSd === 0) return 0;
    return (winMean - lossMean) / pooledSd;
}

function computeCategoricalSummary(
    split: WinLossSplit,
): NonNullable<FeatureSeparation['categoricalSummary']> {
    const totals = new Map<string, { win: number; loss: number }>();
    for (const v of split.wins) {
        const k = String(v);
        if (!totals.has(k)) totals.set(k, { win: 0, loss: 0 });
        totals.get(k)!.win++;
    }
    for (const v of split.losses) {
        const k = String(v);
        if (!totals.has(k)) totals.set(k, { win: 0, loss: 0 });
        totals.get(k)!.loss++;
    }

    const totalWins = split.wins.length;
    const totalLosses = split.losses.length;
    const baseWinRate = totalWins + totalLosses === 0 ? 0 : totalWins / (totalWins + totalLosses);

    const conditionalWinRate: Record<string, number> = {};
    for (const [k, c] of totals.entries()) {
        const n = c.win + c.loss;
        if (n < 3) continue; // サンプル不足のカテゴリは除外
        conditionalWinRate[k] = c.win / n;
    }

    return { conditionalWinRate, baseWinRate };
}

/**
 * カテゴリ特徴量の分離度: max |p_c - baseRate|
 */
export function categoricalSeparation(
    summary: NonNullable<FeatureSeparation['categoricalSummary']>,
): number {
    let maxDiff = 0;
    for (const rate of Object.values(summary.conditionalWinRate)) {
        const diff = Math.abs(rate - summary.baseWinRate);
        if (diff > maxDiff) maxDiff = diff;
    }
    return maxDiff;
}
