/**
 * ポジションサイズ（ロットサイズ）計算ユーティリティ
 * 
 * 目的:
 * - リスクベースのロットサイズ自動計算
 * - 通貨ペア別の pip value 管理
 * - 証拠金制約を考慮した最終ロットサイズ算出
 * 
 * 計算式:
 *   riskAmount = capital × riskPercent / 100
 *   lotSize    = riskAmount / (slPips × pipValue)
 *   finalLot   = min(lotSize, maxLotByMargin)
 */

// ============================================
// 型定義
// ============================================

/** ロットサイズ計算の入力 */
export interface LotSizeInput {
    /** 現在の資金残高 */
    capital: number;
    /** リスク割合 (%) — riskAmount と排他 */
    riskPercent?: number;
    /** リスク固定金額 (JPY) — riskPercent と排他 */
    riskAmount?: number;
    /** ストップロス幅 (pips) */
    slPips: number;
    /** 通貨ペア名 */
    symbol: string;
    /** レバレッジ */
    leverage: number;
    /** エントリー価格 */
    entryPrice: number;
}

/** ロットサイズ計算結果 */
export interface LotSizeResult {
    /** 最終ロットサイズ（通貨量） */
    lotSize: number;
    /** リスク計算によるロットサイズ（制約前） */
    calculatedLotSize: number;
    /** 証拠金制約によるロットサイズ上限 */
    maxLotByMargin: number;
    /** リスク金額 */
    riskAmount: number;
    /** 使用した pip value */
    pipValue: number;
    /** 証拠金制約で切り詰められたか */
    isMarginConstrained: boolean;
}

// ============================================
// Pip Value テーブル
// ============================================

/**
 * 通貨ペアに対応する pip value を取得
 * 
 * 標準的な pip 定義:
 * - JPYペア: 1 pip = 0.01  (例: USDJPY 150.123 → 小数第2位)
 * - USDペア: 1 pip = 0.0001 (例: EURUSD 1.08765 → 小数第4位)
 * - XAUUSD:  1 pip = 0.1    (例: 2345.12 → 小数第1位)
 * - XAGUSD:  1 pip = 0.01   (例: 28.123 → 小数第2位)
 * 
 * @param symbol - 通貨ペア名
 * @returns pip value
 */
export function getPipValue(symbol: string): number {
    const s = symbol.toUpperCase();

    // 貴金属
    if (s === 'XAUUSD' || s === 'GOLD') return 0.1;
    if (s === 'XAGUSD' || s === 'SILVER') return 0.01;

    // JPYペア (引用通貨がJPYの場合)
    if (s.endsWith('JPY')) return 0.01;

    // その他（EURUSD, GBPUSD, AUDUSD, etc.）
    return 0.0001;
}

// ============================================
// メイン計算関数
// ============================================

/**
 * リスクベースでロットサイズを計算
 * 
 * 計算フロー:
 * 1. リスク金額を決定（% or 固定金額）
 * 2. 基本ロットサイズ = リスク金額 / (SL pips × pip value)
 * 3. 証拠金上限 = (資金 × レバレッジ) / エントリー価格
 * 4. 最終ロット = min(基本ロット, 証拠金上限)
 * 5. 1000通貨単位に丸める（micro lot）
 * 
 * @param input - 計算パラメータ
 * @returns 計算結果
 */
export function calculateLotSize(input: LotSizeInput): LotSizeResult {
    const { capital, riskPercent, riskAmount: riskAmountInput, slPips, symbol, leverage, entryPrice } = input;

    // バリデーション
    if (capital <= 0) {
        return createZeroResult(symbol);
    }
    if (slPips <= 0) {
        return createZeroResult(symbol);
    }
    if (entryPrice <= 0) {
        return createZeroResult(symbol);
    }

    // 1. リスク金額を決定
    let riskAmount: number;
    if (riskAmountInput !== undefined && riskAmountInput > 0) {
        riskAmount = riskAmountInput;
    } else if (riskPercent !== undefined && riskPercent > 0) {
        riskAmount = capital * riskPercent / 100;
    } else {
        // デフォルト: 資金の2%
        riskAmount = capital * 2 / 100;
    }

    // リスク金額は資金を超えない
    riskAmount = Math.min(riskAmount, capital);

    // 2. pip value を取得
    const pipValue = getPipValue(symbol);

    // 3. 基本ロットサイズ = リスク金額 / (SL pips × pip value)
    //    これは「SLにヒットした場合の損失がちょうどリスク金額になるロット」
    const calculatedLotSize = riskAmount / (slPips * pipValue);

    // 4. 証拠金上限 = (資金 × レバレッジ) / エントリー価格
    const maxLotByMargin = (capital * leverage) / entryPrice;

    // 5. 最終ロットを決定し、1000通貨単位に切り捨て
    const rawLot = Math.min(calculatedLotSize, maxLotByMargin);
    const lotSize = Math.floor(rawLot / 1000) * 1000;

    return {
        lotSize: Math.max(lotSize, 0), // 負数を防止
        calculatedLotSize: Math.floor(calculatedLotSize / 1000) * 1000,
        maxLotByMargin: Math.floor(maxLotByMargin / 1000) * 1000,
        riskAmount,
        pipValue,
        isMarginConstrained: calculatedLotSize > maxLotByMargin,
    };
}

/**
 * SL値を pips に変換
 * 
 * @param slValue - SL 値
 * @param slUnit - 単位 ('percent' | 'pips')
 * @param entryPrice - エントリー価格
 * @param symbol - 通貨ペア名
 * @returns SL幅（pips）
 */
export function slValueToPips(
    slValue: number,
    slUnit: 'percent' | 'pips',
    entryPrice: number,
    symbol: string
): number {
    if (slUnit === 'pips') {
        return slValue;
    }

    // percent → pips 変換
    // SL幅（価格差）= エントリー価格 × SL% / 100
    // SL（pips）= SL幅 / pip value
    const pipValue = getPipValue(symbol);
    const slPriceDiff = entryPrice * slValue / 100;
    return slPriceDiff / pipValue;
}

/**
 * 使用中の証拠金を計算
 * 
 * @param openPositions - 保有中のポジション情報
 * @param leverage - レバレッジ
 * @returns 使用中の証拠金合計
 */
export function calculateUsedMargin(
    openPositions: Map<string, { entryPrice: number; lotSize: number }>,
    leverage: number
): number {
    let usedMargin = 0;
    for (const [, pos] of openPositions) {
        usedMargin += (pos.lotSize * pos.entryPrice) / leverage;
    }
    return usedMargin;
}

// ============================================
// ヘルパー関数
// ============================================

/** ゼロ結果を生成 */
function createZeroResult(symbol: string): LotSizeResult {
    return {
        lotSize: 0,
        calculatedLotSize: 0,
        maxLotByMargin: 0,
        riskAmount: 0,
        pipValue: getPipValue(symbol),
        isMarginConstrained: false,
    };
}
