/**
 * MaterializationService（Phase 4b）
 *
 * EdgeHypothesis を Side-A の TradeNote に変換し、Side-A 検証基盤で
 * 評価可能にするブリッジ層の中核。
 *
 * 設計原則:
 * - **ハイブリッド変換（Q1 採用）**: User パス（indicatorConfig）優先 / Legacy パス
 *   （featureVector 投影）フォールバック / 全部不能なら MaterializationError
 * - **Side-A コードを一切変更しない**: TradeNoteRepository / Trade テーブルへの
 *   書き込みのみ
 * - **best-effort**: 失敗は呼び出し側に投げ、ジョブ全体は止めない
 *
 * @see docs/design/phase_4b_specification.md セクション4.3
 */

import type { Prisma, TradeSide } from '@prisma/client';
import { prisma } from '../../backend/db/client';
import type {
    EdgeHypothesis,
    DefaultRiskManagement,
    StopLossSpec,
    TakeProfitSpec,
} from '../models/edgeHypothesis';
import { DEFAULT_RISK_MANAGEMENT } from '../models/edgeHypothesis';
import type { LensFeatureSnapshot } from '../lenses';
import {
    MaterializationError,
    type MaterializationResult,
    type MaterializationPath,
    type MaterializeForValidationOptions,
} from './types';
import { normalizeCTraderSymbol } from '../../utils/symbolNormalization';

// ===========================================
// 型
// ===========================================

/**
 * VirtualTrade 完了時に TradeNote として記録するための入力
 */
export interface MaterializeFromVirtualTradeInput {
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    enteredAt: Date;
    timeframe?: string;
    /** AITradeNote 側に既に保存された featureVector (なければ仮値で埋める) */
    featureVector?: number[];
}

// ===========================================
// MaterializationService 本体
// ===========================================

export class MaterializationService {
    /**
     * 検証用 TradeNote を生成する。
     *
     * Side-A の backtestService.execute({ noteId, takeProfit, stopLoss, ... }) で
     * 呼べる形まで構築する。entryPrice は実際のバックテスト時に OHLCV から動的に
     * 決まるため、ここでは記録上の仮値で埋める。
     *
     * @throws MaterializationError 変換不能（featureVector 全0 かつ User パス不能）
     */
    async materializeForValidation(
        hypothesis: EdgeHypothesis,
        opts: MaterializeForValidationOptions = {},
    ): Promise<MaterializationResult> {
        const lensSnapshot = opts.lensSnapshot;

        // 1. リスク管理設定（欠落時はデフォルト補完）
        const riskManagement: DefaultRiskManagement =
            hypothesis.defaultRiskManagement ?? DEFAULT_RISK_MANAGEMENT;

        // 2. ATR / entryPrice の取得（lensSnapshot 由来）
        const atr = this.getAtrFromSnapshot(lensSnapshot);
        const entryPrice =
            opts.entryPriceHint ?? this.getLatestPriceFromSnapshot(lensSnapshot) ?? 1.0;

        if (entryPrice <= 0) {
            throw new MaterializationError(`不正な entryPrice: ${entryPrice}`);
        }

        // 3. SL/TP の % 換算（仕様書 4.1: ATR系 と RR比 のみ Phase 4b 対応）
        const stopLossPercent = this.calculateStopLossPercent(
            riskManagement.stopLoss,
            atr,
            entryPrice,
        );
        const takeProfitPercent = this.calculateTakeProfitPercent(
            riskManagement.takeProfit,
            stopLossPercent,
            atr,
            entryPrice,
        );

        // 4. featureVector 投影（Legacy パス用、12次元）
        const featureVector = this.projectFeatureVector(hypothesis, lensSnapshot);

        // 5. User パスの試行（indicatorConfig 構築）
        const indicatorConfig = this.tryBuildIndicatorConfig(hypothesis);
        const pathUsed: MaterializationPath = indicatorConfig ? 'user' : 'legacy';

        // 6. 変換不能チェック: featureVector が全 0 で User パスも不能なら MaterializationError
        if (!indicatorConfig && featureVector.every((v) => v === 0)) {
            throw new MaterializationError(
                '変換不能: featureVector に意味ある投影なし、かつ User パス不能',
            );
        }

        // 7. 対象シンボル（仮説の symbols から取得、複数なら最初）
        const symbolRaw = hypothesis.symbols[0];
        if (!symbolRaw) {
            throw new MaterializationError('仮説に symbols が設定されていない');
        }
        const symbol = normalizeCTraderSymbol(symbolRaw);
        const timeframe = hypothesis.timeframes[0];

        // 8. side（expectedDirection 'either' は 'long' を仮置き）
        const side: TradeSide = hypothesis.expectedDirection === 'short' ? 'sell' : 'buy';

        // 9. Trade + TradeNote をトランザクションで作成
        const { tradeId, tradeNoteId } = await this.createTradeAndNote({
            symbol,
            side,
            entryPrice,
            timeframe,
            featureVector,
            indicatorConfig,
            hypothesisId: hypothesis.id,
        });

        return {
            tradeNoteId,
            tradeId,
            stopLossPercent,
            takeProfitPercent,
            maxHoldingMinutes: this.calculateMaxHoldingMinutes(riskManagement, timeframe),
            pathUsed,
        };
    }

    /**
     * VirtualTrade 完了時に AITradeNote と並行して TradeNote を作成する。
     *
     * **best-effort**: 失敗しても呼び出し側の AITradeNote 作成は継続させる。
     * 例外を投げるのは呼び出し側の判断に任せる。
     *
     * @returns 作成された TradeNote ID
     */
    async materializeFromVirtualTrade(
        input: MaterializeFromVirtualTradeInput,
    ): Promise<string> {
        const side: TradeSide = input.side === 'short' ? 'sell' : 'buy';
        const featureVector = input.featureVector ?? Array<number>(12).fill(0.5);

        const { tradeNoteId } = await this.createTradeAndNote({
            symbol: input.symbol,
            side,
            entryPrice: input.entryPrice,
            timeframe: input.timeframe,
            featureVector,
            tradedAt: input.enteredAt,
        });

        return tradeNoteId;
    }

    // ===========================================
    // 内部ヘルパー
    // ===========================================

    private getAtrFromSnapshot(snapshot?: LensFeatureSnapshot): number | undefined {
        const vol = snapshot?.features.get('volatility_regime');
        const atr = vol?.features.atr;
        if (typeof atr === 'number' && atr > 0) return atr;
        // VolatilityRegime が unknown(insufficient_data)を返したケースは
        // features に atr 自体が含まれない。呼び出し側が原因を判別しやすいよう
        // ここでは undefined を返すだけにとどめ、エラーメッセージの拡充は
        // calculateStopLossPercent / calculateTakeProfitPercent 側で行う。
        return undefined;
    }

    private getLatestPriceFromSnapshot(snapshot?: LensFeatureSnapshot): number | undefined {
        // current_analysis レンズが latest_price を持つ場合は採用（拡張余地）
        const ca = snapshot?.features.get('current_analysis');
        const p = ca?.features.latest_price;
        return typeof p === 'number' && p > 0 ? p : undefined;
    }

    /**
     * SL の % 換算
     * - atr_multiple: (ATR × value) / entryPrice × 100
     * - fixed_pips: 仕様書 5.6 により Phase 4b 非対応 → エラー
     * - swing_point: 仕様書 5.6 により Phase 4b 非対応 → エラー
     */
    private calculateStopLossPercent(
        spec: StopLossSpec,
        atr: number | undefined,
        entryPrice: number,
    ): number {
        if (spec.type === 'atr_multiple') {
            if (atr === undefined) {
                throw new MaterializationError(
                    'atr_multiple SL を要求されたが ATR が取得できない (volatility_regime レンズが unknown または lensSnapshot 未提供)',
                );
            }
            return ((atr * spec.value) / entryPrice) * 100;
        }
        if (spec.type === 'fixed_pips' || spec.type === 'swing_point') {
            throw new MaterializationError(
                `Phase 4b では SL.${spec.type} は未対応（4c 以降）`,
            );
        }
        throw new MaterializationError(`不明な SL.type`);
    }

    /**
     * TP の % 換算
     * - rr_ratio: stopLossPercent × value
     * - atr_multiple: (ATR × value) / entryPrice × 100
     * - fixed_pips: Phase 4b 非対応
     */
    private calculateTakeProfitPercent(
        spec: TakeProfitSpec,
        stopLossPercent: number,
        atr: number | undefined,
        entryPrice: number,
    ): number {
        if (spec.type === 'rr_ratio') {
            return stopLossPercent * spec.value;
        }
        if (spec.type === 'atr_multiple') {
            if (atr === undefined) {
                throw new MaterializationError(
                    'atr_multiple TP を要求されたが ATR が取得できない (volatility_regime レンズが unknown または lensSnapshot 未提供)',
                );
            }
            return ((atr * spec.value) / entryPrice) * 100;
        }
        if (spec.type === 'fixed_pips') {
            throw new MaterializationError('Phase 4b では TP.fixed_pips は未対応');
        }
        throw new MaterializationError(`不明な TP.type`);
    }

    private calculateMaxHoldingMinutes(
        rm: DefaultRiskManagement,
        timeframe?: string,
    ): number | undefined {
        if (rm.maxHoldingBars === undefined) return undefined;
        const minutesPerBar = this.timeframeToMinutes(timeframe);
        if (minutesPerBar === undefined) return undefined;
        return rm.maxHoldingBars * minutesPerBar;
    }

    private timeframeToMinutes(tf?: string): number | undefined {
        if (!tf) return undefined;
        const m = tf.match(/^(\d+)([mhdwM])$/);
        if (!m) return undefined;
        const n = parseInt(m[1], 10);
        switch (m[2]) {
            case 'm':
                return n;
            case 'h':
                return n * 60;
            case 'd':
                return n * 60 * 24;
            case 'w':
                return n * 60 * 24 * 7;
            case 'M':
                return n * 60 * 24 * 30;
            default:
                return undefined;
        }
    }

    /**
     * 仮説から 12次元 featureVector を投影する（Legacy パス用）。
     *
     * 戦略: lensSnapshot があれば、Side-B の代表的な12次元スロットに数値特徴量を
     * 集約する。なければ仮説の lensRelevance ベースで重みを与える。
     *
     * 12次元スロット（Side-B FeatureVector12D 互換）:
     *   [trendStrength, trendDirection, maAlignment, pricePosition,
     *    rsiLevel, macdMomentum, momentumDivergence,
     *    volatilityLevel, bbWidth, volatilityTrend,
     *    supportProximity, resistanceProximity]
     */
    private projectFeatureVector(
        hypothesis: EdgeHypothesis,
        snapshot?: LensFeatureSnapshot,
    ): number[] {
        const v = new Array<number>(12).fill(0);

        if (snapshot) {
            const ca = snapshot.features.get('current_analysis');
            if (ca) {
                v[0] = this.numOrZero(ca.features.trend_strength);
                v[1] = this.numOrZero(ca.features.direction === 'long' ? 100 : ca.features.direction === 'short' ? 0 : 50);
                v[2] = this.numOrZero(ca.features.regime_confidence ?? 50);
                v[4] = this.numOrZero(ca.features.momentum);
                v[7] = this.numOrZero(ca.features.volatility_score);
                v[10] = this.numOrZero(ca.features.support_proximity);
                v[11] = this.numOrZero(ca.features.resistance_proximity);
            }
            const dow = snapshot.features.get('dow_theory');
            if (dow) {
                const trendState = dow.features.trend_state;
                v[1] = trendState === 'uptrend' ? 100 : trendState === 'downtrend' ? 0 : 50;
                v[6] = this.numOrZero(dow.features.pullback_depth_pct ?? 0);
            }
            const vol = snapshot.features.get('volatility_regime');
            if (vol) {
                v[8] = this.numOrZero(vol.features.bb_width_percentile);
                v[9] = vol.features.is_expanding === true ? 100 : vol.features.is_squeeze === true ? 0 : 50;
            }
        }

        // lensRelevance を 12次元の重みとして散布
        const rel = hypothesis.lensRelevance ?? {};
        const totalRelevance = Object.values(rel).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
        if (totalRelevance > 0) {
            // 関連性の高いレンズに対応する次元を 0.5 倍重みでブースト（中和的）
            // 単純化: 全次元に小さなバイアスをかける
            for (let i = 0; i < 12; i++) {
                v[i] = v[i] * 0.5 + 50 * 0.5;
            }
        }

        return v;
    }

    private numOrZero<T>(x: T): number {
        return typeof x === 'number' && Number.isFinite(x) ? x : 0;
    }

    /**
     * User パス（indicatorConfig）の構築を試みる。
     *
     * 仮説の条件を Side-A の標準インジケーター条件で表現できるかをチェック。
     * Side-B レンズ特徴量は標準指標と直接対応しないものが多いため、Phase 4b 時点では
     * **多くの仮説で null（不能）が返り、Legacy フォールバックされる** ことを想定。
     *
     * 将来 Phase 5 で「レンズ特徴量 → 標準指標条件」のマッピングテーブルが
     * 充実したらここを拡張する。
     */
    private tryBuildIndicatorConfig(_hypothesis: EdgeHypothesis): null {
        // Phase 4b: 全仮説で null を返す（Legacy フォールバック前提）
        // Phase 5 で実装拡張予定
        return null;
    }

    /**
     * Trade + TradeNote をトランザクションで作成する。
     */
    private async createTradeAndNote(args: {
        symbol: string;
        side: TradeSide;
        entryPrice: number;
        timeframe?: string;
        featureVector: number[];
        indicatorConfig?: Prisma.InputJsonValue | null;
        hypothesisId?: string;
        tradedAt?: Date;
    }): Promise<{ tradeId: string; tradeNoteId: string }> {
        return await prisma.$transaction(async (tx) => {
            const trade = await tx.trade.create({
                data: {
                    timestamp: args.tradedAt ?? new Date(),
                    symbol: args.symbol,
                    side: args.side,
                    price: args.entryPrice,
                    quantity: 1, // 検証用は数量1で固定
                },
            });

            const note = await tx.tradeNote.create({
                data: {
                    tradeId: trade.id,
                    symbol: args.symbol,
                    side: args.side,
                    entryPrice: args.entryPrice,
                    featureVector: args.featureVector,
                    timeframe: args.timeframe,
                    indicators: {},
                    indicatorConfig:
                        args.indicatorConfig === undefined || args.indicatorConfig === null
                            ? undefined
                            : args.indicatorConfig,
                    status: 'archived', // Side-A の UI に表示しない（汚染防止）
                    tags: args.hypothesisId
                        ? ['edge_hypothesis_temp', `hyp:${args.hypothesisId}`]
                        : ['side_b_materialized'],
                },
            });

            return { tradeId: trade.id, tradeNoteId: note.id };
        });
    }
}

export const materializationService = new MaterializationService();
