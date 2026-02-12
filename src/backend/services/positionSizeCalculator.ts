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
    /** cTrader から取得した digits（優先使用、なければ getPipValue フォールバック） */
    digits?: number;
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
// Pip Value
// ============================================

/**
 * cTrader の digits（小数桁数）から pip value を導出
 * 
 * FX の慣習: pip = 小数桁の「1つ手前」の最小単位
 *   digits=5 (EURUSD 1.08765) → pipValue = 10^-(5-1) = 0.0001
 *   digits=3 (USDJPY 150.123)  → pipValue = 10^-(3-1) = 0.01
 *   digits=2 (XAUUSD 2345.12)  → pipValue = 10^-(2-1) = 0.1
 * 
 * @param digits - cTrader から取得した小数桁数
 * @returns pip value
 */
export function pipValueFromDigits(digits: number): number {
    return Math.pow(10, -(digits - 1));
}

/**
 * 通貨ペアに対応する pip value を取得（フォールバック用ハードコード）
 * 
 * cTrader から digits が取得できない場合に使用
 * 
 * @param symbol - 通貨ペア名
 * @param digits - cTrader digits（あれば優先使用）
 * @returns pip value
 */
export function getPipValue(symbol: string, digits?: number): number {
    // digits が渡された場合は動的計算（cTrader API 由来）
    if (digits !== undefined && digits > 0) {
        return pipValueFromDigits(digits);
    }

    // フォールバック: ハードコードテーブル
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
        return createZeroResult(symbol, input.digits);
    }
    if (slPips <= 0) {
        return createZeroResult(symbol, input.digits);
    }
    if (entryPrice <= 0) {
        return createZeroResult(symbol, input.digits);
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

    // 2. pip value を取得（digits が渡されていれば動的計算）
    const pipValue = getPipValue(symbol, input.digits);

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
    symbol: string,
    digits?: number
): number {
    if (slUnit === 'pips') {
        return slValue;
    }

    // percent → pips 変換
    // SL幅（価格差）= エントリー価格 × SL% / 100
    // SL（pips）= SL幅 / pip value
    const pipValue = getPipValue(symbol, digits);
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
function createZeroResult(symbol: string, digits?: number): LotSizeResult {
    return {
        lotSize: 0,
        calculatedLotSize: 0,
        maxLotByMargin: 0,
        riskAmount: 0,
        pipValue: getPipValue(symbol, digits),
        isMarginConstrained: false,
    };
}
