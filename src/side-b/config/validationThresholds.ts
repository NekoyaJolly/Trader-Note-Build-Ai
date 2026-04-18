/**
 * Phase 4c 検証ツール群の判定閾値
 *
 * 仕様書 §5.6 に基づき、運用後に調整しやすいよう環境変数で外部化する。
 * 既定値は仕様書記載の暫定値。
 *
 * @see docs/design/phase_4c_specification.md §5.6
 */

function parseNumber(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid number env ${name}=${raw}`);
    }
    return parsed;
}

function parseInteger(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid integer env ${name}=${raw}`);
    }
    return parsed;
}

export const VALIDATION_THRESHOLDS = Object.freeze({
    walkForward: Object.freeze({
        /** 過学習スコアの上限（これを超えたら rejected） */
        maxOverfitScore: parseNumber('WF_MAX_OVERFIT', 0.3),
    }),
    buyAndHold: Object.freeze({
        /** BH リターンを何ポイント（比率）上回れば passed とみなすか（0.005 = 0.5%） */
        minOutperformance: parseNumber('BH_MIN_OUTPERFORMANCE', 0.005),
    }),
    monteCarlo: Object.freeze({
        /** 信頼区間下側 5% の最終 PnL が 0 以上なら passed */
        p5MinFinalPnl: parseNumber('MC_P5_MIN_PNL', 0),
        /** リサンプリング回数 */
        simulationCount: parseInteger('MC_SIM_COUNT', 1000),
    }),
    common: Object.freeze({
        /** 有効トレード数の最低ライン（統計的有意性の最低限） */
        minTradeCount: parseInteger('MIN_TRADE_COUNT', 20),
    }),
});

export type ValidationThresholds = typeof VALIDATION_THRESHOLDS;
