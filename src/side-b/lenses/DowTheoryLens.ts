/**
 * DowTheoryLens - ダウ理論ベースのトレンド判定レンズ（Phase 3）
 *
 * 客観的に判定可能なダウ理論の要素を抽出する:
 * - スイングハイ/ローの切り上げ・切り下げ
 * - トレンド状態（uptrend / downtrend / range / unclear）
 * - トレンド段階（early / middle / late）
 * - 押し目・戻り目の形成状況
 *
 * 設計原則:
 * - 副作用なし・他レンズ非依存・決定性あり
 * - データ不足時は "unclear" / "unknown" を誠実に返す
 * - 数値最適化や AI 推論は含まない（決定論的ヒューリスティック）
 *
 * @see docs/design/phase_3_specification.md セクション4.2
 */

import type { Lens, LensFeature, LensInput } from './types';
import {
    detectPivots,
    type Pivot,
    type OHLCVBar,
    type PivotDetectionConfig,
} from './utils/pivotDetection';

export interface DowTheoryLensConfig {
    pivot: PivotDetectionConfig;
    /** 押し目判定で参照する直近バー数 */
    pullbackLookback: number;
}

const DEFAULT_CONFIG: DowTheoryLensConfig = {
    pivot: { leftBars: 5, rightBars: 5 },
    pullbackLookback: 10,
};

type TrendState = 'uptrend' | 'downtrend' | 'range' | 'unclear';
type TrendPhase = 'early' | 'middle' | 'late' | 'unknown';

export class DowTheoryLens implements Lens {
    readonly name = 'dow_theory';
    readonly version = '1.0.0';
    readonly dependencies = ['symbol', 'ohlcvBars'] as const;
    private readonly config: DowTheoryLensConfig;

    constructor(config?: Partial<DowTheoryLensConfig>) {
        this.config = {
            pivot: { ...DEFAULT_CONFIG.pivot, ...(config?.pivot ?? {}) },
            pullbackLookback: config?.pullbackLookback ?? DEFAULT_CONFIG.pullbackLookback,
        };
    }

    async compute(input: LensInput): Promise<LensFeature> {
        const start = Date.now();
        const computedAt = new Date();
        const bars = input.ohlcvBars;

        const minBars = this.config.pivot.leftBars + this.config.pivot.rightBars + 1;
        if (!bars || bars.length < minBars) {
            return {
                lensName: this.name,
                lensVersion: this.version,
                features: {
                    trend_state: 'unclear',
                    trend_phase: 'unknown',
                    pullback_active: false,
                    reason: 'insufficient_data',
                    bars_available: bars?.length ?? 0,
                    bars_required: minBars,
                },
                computedAt,
                computeDurationMs: Date.now() - start,
                confidence: 0,
            };
        }

        const pivots = detectPivots(bars, this.config.pivot);

        // 直近2つずつの高値/安値ピボット
        const lastTwoHighs = this.lastN(pivots, 'high', 2);
        const lastTwoLows = this.lastN(pivots, 'low', 2);

        const higherHigh = lastTwoHighs.length === 2 && lastTwoHighs[1].price > lastTwoHighs[0].price;
        const higherLow = lastTwoLows.length === 2 && lastTwoLows[1].price > lastTwoLows[0].price;
        const lowerHigh = lastTwoHighs.length === 2 && lastTwoHighs[1].price < lastTwoHighs[0].price;
        const lowerLow = lastTwoLows.length === 2 && lastTwoLows[1].price < lastTwoLows[0].price;

        let trendState: TrendState;
        if (higherHigh && higherLow) {
            trendState = 'uptrend';
        } else if (lowerHigh && lowerLow) {
            trendState = 'downtrend';
        } else if (lastTwoHighs.length === 2 && lastTwoLows.length === 2) {
            trendState = 'range';
        } else {
            trendState = 'unclear';
        }

        const lastHigh = lastTwoHighs[lastTwoHighs.length - 1];
        const lastLow = lastTwoLows[lastTwoLows.length - 1];
        const currentBarIndex = bars.length - 1;

        const barsSinceLastHigh = lastHigh ? currentBarIndex - lastHigh.barIndex : -1;
        const barsSinceLastLow = lastLow ? currentBarIndex - lastLow.barIndex : -1;

        // トレンド継続バー数: トレンド開始点からの経過
        const trendDurationBars = this.estimateTrendDurationBars(pivots, trendState, currentBarIndex);

        // トレンド段階の判定（直近60本の平均トレンド長との比較）
        const trendPhase = this.classifyTrendPhase(trendState, trendDurationBars, pivots);

        // 押し目/戻り目の判定
        const { pullbackActive, pullbackDepthPct } = this.assessPullback(
            bars,
            trendState,
            lastHigh,
            lastLow,
        );

        const features: Record<string, number | string | boolean> = {
            trend_state: trendState,
            trend_phase: trendPhase,
            recent_higher_high: higherHigh,
            recent_higher_low: higherLow,
            recent_lower_high: lowerHigh,
            recent_lower_low: lowerLow,
            last_high_price: lastHigh?.price ?? -1,
            last_low_price: lastLow?.price ?? -1,
            bars_since_last_high: barsSinceLastHigh,
            bars_since_last_low: barsSinceLastLow,
            trend_duration_bars: trendDurationBars,
            pullback_active: pullbackActive,
            pullback_depth_pct: pullbackDepthPct,
            pivot_count: pivots.length,
        };

        return {
            lensName: this.name,
            lensVersion: this.version,
            features,
            computedAt,
            computeDurationMs: Date.now() - start,
            confidence: trendState === 'unclear' ? 0.3 : 0.8,
        };
    }

    // --- 内部ヘルパー ---

    private lastN(pivots: readonly Pivot[], type: 'high' | 'low', n: number): Pivot[] {
        const result: Pivot[] = [];
        for (let i = pivots.length - 1; i >= 0 && result.length < n; i--) {
            if (pivots[i].type === type) result.unshift(pivots[i]);
        }
        return result;
    }

    /**
     * トレンド継続バー数の推定。
     * uptrend なら直近の lower_high が出る前の低値を開始点とする、等の
     * 簡易ロジック。厳密ではないが "unclear" を誠実に返す方針。
     */
    private estimateTrendDurationBars(
        pivots: readonly Pivot[],
        state: TrendState,
        currentBarIndex: number,
    ): number {
        if (state === 'unclear' || state === 'range' || pivots.length === 0) return 0;

        // 反転点（反対サインのピボット）を探す
        // uptrend: 直近のピボット低の前にある "安値切り下げ" 点から遡る
        // downtrend: 直近のピボット高の前にある "高値切り上げ" 点から遡る
        // 簡易実装: 一番古いピボットまでの距離を返す（上限 60 バー）
        const oldest = pivots[0];
        return Math.min(currentBarIndex - oldest.barIndex, 60);
    }

    private classifyTrendPhase(
        state: TrendState,
        durationBars: number,
        pivots: readonly Pivot[],
    ): TrendPhase {
        if (state === 'unclear' || state === 'range') return 'unknown';
        if (pivots.length < 2) return 'unknown';

        // 平均トレンド長: 直近ピボット間隔の平均
        let totalSpan = 0;
        let count = 0;
        for (let i = 1; i < pivots.length; i++) {
            totalSpan += pivots[i].barIndex - pivots[i - 1].barIndex;
            count++;
        }
        const avgSpan = count > 0 ? totalSpan / count : 0;

        if (avgSpan <= 0) return 'unknown';

        const ratio = durationBars / avgSpan;
        if (ratio < 1) return 'early';
        if (ratio < 2) return 'middle';
        return 'late';
    }

    private assessPullback(
        bars: readonly OHLCVBar[],
        state: TrendState,
        lastHigh: Pivot | undefined,
        lastLow: Pivot | undefined,
    ): { pullbackActive: boolean; pullbackDepthPct: number } {
        if (state === 'unclear' || state === 'range') {
            return { pullbackActive: false, pullbackDepthPct: 0 };
        }

        const recentStart = Math.max(0, bars.length - this.config.pullbackLookback);
        const recentBars = bars.slice(recentStart);
        if (recentBars.length === 0) return { pullbackActive: false, pullbackDepthPct: 0 };

        const latest = recentBars[recentBars.length - 1];

        if (state === 'uptrend' && lastHigh && lastLow) {
            const trendWidth = lastHigh.price - lastLow.price;
            if (trendWidth <= 0) return { pullbackActive: false, pullbackDepthPct: 0 };
            const pullbackDepth = lastHigh.price - latest.close;
            const pullbackActive = pullbackDepth > trendWidth * 0.1;
            return {
                pullbackActive,
                pullbackDepthPct: Math.max(0, (pullbackDepth / trendWidth) * 100),
            };
        }

        if (state === 'downtrend' && lastHigh && lastLow) {
            const trendWidth = lastHigh.price - lastLow.price;
            if (trendWidth <= 0) return { pullbackActive: false, pullbackDepthPct: 0 };
            const rebound = latest.close - lastLow.price;
            const pullbackActive = rebound > trendWidth * 0.1;
            return {
                pullbackActive,
                pullbackDepthPct: Math.max(0, (rebound / trendWidth) * 100),
            };
        }

        return { pullbackActive: false, pullbackDepthPct: 0 };
    }
}
