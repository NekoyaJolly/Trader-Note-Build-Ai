/**
 * ブリッジ層の公開型（Phase 4b）
 *
 * Side-B の EdgeHypothesis を Side-A の検証基盤で評価するための
 * 中間データ構造を定義する。
 */

import type { LensFeatureSnapshot } from '../lenses';

/**
 * Materialize 経路
 */
export type MaterializationPath = 'user' | 'legacy';

/**
 * MaterializationService の戻り値
 *
 * EdgeHypothesis から作成された Side-A TradeNote の ID と、
 * Side-A の backtestService に渡す SL/TP（%）を含む。
 */
export interface MaterializationResult {
    /** 作成された Side-A TradeNote の ID */
    tradeNoteId: string;
    /** 紐付け用に作成された Trade の ID */
    tradeId: string;
    /** backtestService.execute の引数として使う stopLoss（%） */
    stopLossPercent: number;
    /** takeProfit（%） */
    takeProfitPercent: number;
    /** 最大保有時間（分、任意） */
    maxHoldingMinutes?: number;
    /** どのパスで materialize したか（trace 用） */
    pathUsed: MaterializationPath;
}

/**
 * materializeForValidation のオプション
 */
export interface MaterializeForValidationOptions {
    /** ATR や latestPrice の取得元 */
    lensSnapshot?: LensFeatureSnapshot;
    /** entry price のヒント（OHLCV 取得元がない場合のフォールバック） */
    entryPriceHint?: number;
}

/**
 * Materialize できないケースで投げる例外
 *
 * EdgeValidator はこれをキャッチして仮説を `not_testable` に設定する。
 */
export class MaterializationError extends Error {
    constructor(public readonly reason: string) {
        super(`MaterializationError: ${reason}`);
        this.name = 'MaterializationError';
    }
}
