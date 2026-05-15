/**
 * VolatilityRegimeLens - ボラティリティ状態の統計的判定レンズ（Phase 3）
 *
 * ボリンジャーバンド幅とATRのパーセンタイル、変化率、状態ラベルを出力する。
 *
 * 設計原則:
 * - 副作用なし・他レンズ非依存・決定性あり
 * - BB/ATR は決定論的計算（標準偏差とTrueRange）
 * - データ不足時は regime_label='unknown' を返す
 *
 * @see docs/design/phase_3_specification.md セクション4.3
 */

import type { Lens, LensFeature, LensInput } from './types';
import type { OHLCVBar } from './utils/pivotDetection';

export interface VolatilityRegimeLensConfig {
    /** BB/ATR の計算窓 */
    indicatorWindow: number;
    /** パーセンタイル計算用の参照期間 */
    percentileLookback: number;
    /** ATR変化率を計算する際の直近差分バー数 */
    atrChangeWindow: number;
    /** 拡大中と判定する ATR 変化率のしきい値（小数, e.g. 0.1 = 10%） */
    expandingThreshold: number;
}

const DEFAULT_CONFIG: VolatilityRegimeLensConfig = {
    indicatorWindow: 20,
    percentileLookback: 100,
    atrChangeWindow: 5,
    expandingThreshold: 0.1,
};

type RegimeLabel =
    | 'contracting'
    | 'low'
    | 'normal'
    | 'elevated'
    | 'expanding'
    | 'unknown';

export class VolatilityRegimeLens implements Lens {
    readonly name = 'volatility_regime';
    readonly version = '1.0.0';
    readonly dependencies = ['symbol', 'ohlcvBars'] as const;
    private readonly config: VolatilityRegimeLensConfig;

    constructor(config?: Partial<VolatilityRegimeLensConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...(config ?? {}) };
    }

    compute(input: LensInput): Promise<LensFeature> {
        const start = Date.now();
        const computedAt = new Date();
        const bars = input.ohlcvBars;

        const minBars = this.config.indicatorWindow + this.config.atrChangeWindow + 1;
        if (!bars || bars.length < minBars) {
            return Promise.resolve({
                lensName: this.name,
                lensVersion: this.version,
                features: {
                    regime_label: 'unknown',
                    reason: 'insufficient_data',
                    bars_available: bars?.length ?? 0,
                    bars_required: minBars,
                },
                computedAt,
                computeDurationMs: Date.now() - start,
                confidence: 0,
            });
        }

        // --- BB幅の時系列計算 ---
        const bbWidthSeries = this.computeBBWidthSeries(bars);
        // --- ATRの時系列計算 ---
        const atrSeries = this.computeATRSeries(bars);

        const currentBBWidth = bbWidthSeries[bbWidthSeries.length - 1];
        const currentATR = atrSeries[atrSeries.length - 1];

        // パーセンタイル計算（直近 percentileLookback 本の BB幅/ATR に対する現在値の位置）
        const bbLookback = bbWidthSeries.slice(-this.config.percentileLookback);
        const atrLookback = atrSeries.slice(-this.config.percentileLookback);

        const bbWidthPercentile = percentile(bbLookback, currentBBWidth);
        const atrPercentile = percentile(atrLookback, currentATR);

        // ATR変化率（atrChangeWindow 本前との比）
        const atrWindowAgo = atrSeries[atrSeries.length - 1 - this.config.atrChangeWindow] ?? currentATR;
        const atrChangeRate = atrWindowAgo > 0 ? (currentATR - atrWindowAgo) / atrWindowAgo : 0;

        // regime_label の判定
        const regimeLabel = this.classifyRegime(bbWidthPercentile);

        // squeeze / expanding
        const isSqueeze = bbWidthPercentile < 20;
        const isExpanding = atrChangeRate > this.config.expandingThreshold;

        // regime 継続バー数
        const barsInCurrentRegime = this.countBarsInRegime(bbWidthSeries, regimeLabel);

        const features: Record<string, number | string | boolean> = {
            bb_width: Number(currentBBWidth.toFixed(6)),
            bb_width_percentile: Number(bbWidthPercentile.toFixed(2)),
            atr: Number(currentATR.toFixed(6)),
            atr_change_rate: Number(atrChangeRate.toFixed(4)),
            atr_percentile: Number(atrPercentile.toFixed(2)),
            regime_label: regimeLabel,
            is_squeeze: isSqueeze,
            is_expanding: isExpanding,
            bars_in_current_regime: barsInCurrentRegime,
        };

        return Promise.resolve({
            lensName: this.name,
            lensVersion: this.version,
            features,
            computedAt,
            computeDurationMs: Date.now() - start,
            confidence: 0.9,
        });
    }

    // --- 内部計算 ---

    private computeBBWidthSeries(bars: readonly OHLCVBar[]): number[] {
        const w = this.config.indicatorWindow;
        const out: number[] = [];

        for (let i = 0; i < bars.length; i++) {
            if (i < w - 1) continue;
            const slice = bars.slice(i - w + 1, i + 1);
            const mean = slice.reduce((s, b) => s + b.close, 0) / w;
            const variance = slice.reduce((s, b) => s + (b.close - mean) ** 2, 0) / w;
            const std = Math.sqrt(variance);
            // BB幅 = 2 * std * 2 (上帯-下帯)
            out.push(4 * std);
        }
        return out;
    }

    private computeATRSeries(bars: readonly OHLCVBar[]): number[] {
        const w = this.config.indicatorWindow;
        const trs: number[] = [];
        for (let i = 0; i < bars.length; i++) {
            const cur = bars[i];
            if (i === 0) {
                trs.push(cur.high - cur.low);
                continue;
            }
            const prev = bars[i - 1];
            const tr = Math.max(
                cur.high - cur.low,
                Math.abs(cur.high - prev.close),
                Math.abs(cur.low - prev.close),
            );
            trs.push(tr);
        }

        const out: number[] = [];
        for (let i = 0; i < trs.length; i++) {
            if (i < w - 1) continue;
            const slice = trs.slice(i - w + 1, i + 1);
            out.push(slice.reduce((a, b) => a + b, 0) / w);
        }
        return out;
    }

    private classifyRegime(bbPercentile: number): RegimeLabel {
        if (bbPercentile < 20) return 'contracting';
        if (bbPercentile < 40) return 'low';
        if (bbPercentile < 60) return 'normal';
        if (bbPercentile < 80) return 'elevated';
        return 'expanding';
    }

    private countBarsInRegime(bbWidthSeries: number[], currentLabel: RegimeLabel): number {
        if (currentLabel === 'unknown') return 0;
        const lookback = Math.min(bbWidthSeries.length, this.config.percentileLookback);
        if (lookback < 2) return 0;

        const recent = bbWidthSeries.slice(-lookback);
        let count = 0;
        for (let i = recent.length - 1; i >= 0; i--) {
            const p = percentile(recent, recent[i]);
            const label = this.classifyRegime(p);
            if (label === currentLabel) count++;
            else break;
        }
        return count;
    }
}

/**
 * value が values 内で占めるパーセンタイル（0-100）を返す。
 * 同値複数の場合は "value 以下" の割合を返す。
 */
function percentile(values: readonly number[], value: number): number {
    if (values.length === 0) return 0;
    let below = 0;
    for (const v of values) {
        if (v <= value) below++;
    }
    return (below / values.length) * 100;
}
