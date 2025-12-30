/**
 * インジケーター正規化ユーティリティ
 * 
 * 目的:
 * - 無界インジケーター（OBV, VWAP, ATR, MACD 等）を正規化
 * - 過去データとの比較を可能にする Rolling Z-score を提供
 * - 異常値（±3σ超）を検出し、マッチング時に警告を発する
 * 
 * 背景:
 * - RSI/Stochastic 等の有界インジケーター（0-100）は直接比較可能
 * - OBV/VWAP/ATR/MACD 等は値の範囲が固定されていないため、
 *   Rolling Z-score で正規化しないと意味のある類似度比較ができない
 * 
 * 参考: FreqAI/Pairs Trading の正規化手法
 */

import { IndicatorId } from '../models/indicatorConfig';

/**
 * インジケーターの値域特性
 * - bounded: 値の範囲が固定（例: RSI=0〜100）→ 正規化不要
 * - unbounded: 値の範囲が無限 → Rolling Z-score で正規化
 */
export type IndicatorBoundType = 'bounded' | 'unbounded';

/**
 * インジケーターの値域分類マップ
 * 
 * bounded: 
 *   - RSI (0-100)
 *   - Stochastic %K/%D (0-100)
 *   - Williams %R (-100〜0)
 *   - MFI (0-100)
 *   - CMF (-1〜1)
 *   - Aroon Up/Down (0-100)
 * 
 * unbounded:
 *   - OBV (累積出来高、上限なし)
 *   - VWAP (価格ベース、上限なし)
 *   - ATR (ボラティリティ、上限なし)
 *   - MACD (価格差、正負両方向に無限)
 *   - CCI (理論上±100付近だが実際は無限)
 *   - ROC (変化率、無限)
 *   - SMA/EMA/DEMA/TEMA (価格ベース、上限なし)
 *   - BB/KC (価格ベース、上限なし)
 *   - PSAR (価格ベース、上限なし)
 *   - Ichimoku (価格ベース、上限なし)
 */
export const INDICATOR_BOUND_TYPE: Record<IndicatorId, IndicatorBoundType> = {
  // === Bounded（正規化不要）===
  rsi: 'bounded',           // 0-100
  stochastic: 'bounded',    // 0-100
  williamsR: 'bounded',     // -100〜0
  mfi: 'bounded',           // 0-100
  cmf: 'bounded',           // -1〜1
  aroon: 'bounded',         // 0-100

  // === Unbounded（正規化必要）===
  obv: 'unbounded',         // 累積出来高
  vwap: 'unbounded',        // 出来高加重平均価格
  atr: 'unbounded',         // 平均真幅
  macd: 'unbounded',        // MACD Line / Signal / Histogram
  cci: 'unbounded',         // ±100が目安だが実際は無限
  roc: 'unbounded',         // 変化率（%）
  sma: 'unbounded',         // 価格ベース
  ema: 'unbounded',         // 価格ベース
  dema: 'unbounded',        // 価格ベース
  tema: 'unbounded',        // 価格ベース
  bb: 'unbounded',          // 価格ベース
  kc: 'unbounded',          // 価格ベース
  psar: 'unbounded',        // 価格ベース
  ichimoku: 'unbounded',    // 価格ベース
};

/**
 * インジケーターが有界かどうかを判定
 */
export function isBoundedIndicator(indicatorId: IndicatorId): boolean {
  return INDICATOR_BOUND_TYPE[indicatorId] === 'bounded';
}

/**
 * Z-score 正規化の結果
 */
export interface ZScoreResult {
  // 正規化後の値（Z-score）
  normalizedValue: number;
  // 異常値フラグ（±3σ超の場合 true）
  isAnomaly: boolean;
  // 異常値の場合の詳細
  anomalyDetail?: string;
  // 元の値
  originalValue: number;
  // 計算に使用した平均
  mean: number;
  // 計算に使用した標準偏差
  stdDev: number;
}

/**
 * Rolling Z-score を計算
 * 
 * 公式: Z = (現在値 - 平均) / 標準偏差
 * 
 * @param currentValue - 正規化対象の現在値
 * @param historicalValues - 過去の値の配列（lookback 期間分）
 * @param anomalyThreshold - 異常値判定の閾値（デフォルト: 3σ）
 * @returns Z-score と異常値情報
 */
export function calculateZScore(
  currentValue: number,
  historicalValues: number[],
  anomalyThreshold: number = 3
): ZScoreResult {
  // 過去データが不十分な場合はそのまま返す
  if (historicalValues.length === 0) {
    return {
      normalizedValue: 0,
      isAnomaly: false,
      originalValue: currentValue,
      mean: currentValue,
      stdDev: 0,
    };
  }

  // 平均を計算
  const sum = historicalValues.reduce((acc, val) => acc + val, 0);
  const mean = sum / historicalValues.length;

  // 標準偏差を計算
  const squaredDiffs = historicalValues.map(val => Math.pow(val - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((acc, val) => acc + val, 0) / historicalValues.length;
  const stdDev = Math.sqrt(avgSquaredDiff);

  // 標準偏差が0（全て同じ値）の場合
  if (stdDev === 0) {
    const normalizedValue = currentValue === mean ? 0 : (currentValue > mean ? 1 : -1);
    return {
      normalizedValue,
      isAnomaly: currentValue !== mean,
      anomalyDetail: currentValue !== mean ? '過去データが一定値のため異常値判定不可' : undefined,
      originalValue: currentValue,
      mean,
      stdDev,
    };
  }

  // Z-score を計算
  const zScore = (currentValue - mean) / stdDev;

  // 異常値判定
  const isAnomaly = Math.abs(zScore) > anomalyThreshold;
  let anomalyDetail: string | undefined;

  if (isAnomaly) {
    if (zScore > 0) {
      anomalyDetail = `値が平均から ${zScore.toFixed(2)}σ 上方に乖離（通常より著しく高い）`;
    } else {
      anomalyDetail = `値が平均から ${Math.abs(zScore).toFixed(2)}σ 下方に乖離（通常より著しく低い）`;
    }
  }

  return {
    normalizedValue: zScore,
    isAnomaly,
    anomalyDetail,
    originalValue: currentValue,
    mean,
    stdDev,
  };
}

/**
 * 複数インジケーターの正規化結果
 */
export interface NormalizedIndicators {
  // 正規化後の値（キー: インジケーター名、値: Z-score または元の値）
  values: Record<string, number>;
  // 異常値警告の配列
  warnings: string[];
}

/**
 * インジケーターセットを正規化
 * 
 * - 有界インジケーター（RSI等）: そのまま使用
 * - 無界インジケーター（OBV等）: Z-score で正規化
 * 
 * @param currentIndicators - 現在のインジケーター値
 * @param historicalIndicators - 過去のインジケーター値（配列）
 * @param anomalyThreshold - 異常値判定の閾値（デフォルト: 3σ）
 * @returns 正規化されたインジケーター値と警告
 */
export function normalizeIndicators(
  currentIndicators: Record<string, number | undefined>,
  historicalIndicators: Record<string, number | undefined>[],
  anomalyThreshold: number = 3
): NormalizedIndicators {
  const values: Record<string, number> = {};
  const warnings: string[] = [];

  for (const [key, currentValue] of Object.entries(currentIndicators)) {
    // 値がない場合はスキップ
    if (currentValue === undefined || !isFinite(currentValue)) {
      continue;
    }

    // インジケーターIDを抽出（例: "rsi_14" → "rsi"）
    const indicatorId = key.split('_')[0] as IndicatorId;

    // 有界インジケーターはそのまま使用
    if (isBoundedIndicator(indicatorId)) {
      values[key] = currentValue;
      continue;
    }

    // 無界インジケーターは Z-score で正規化
    const historicalValues = historicalIndicators
      .map(h => h[key])
      .filter((v): v is number => v !== undefined && isFinite(v));

    const zScoreResult = calculateZScore(currentValue, historicalValues, anomalyThreshold);
    values[key] = zScoreResult.normalizedValue;

    // 異常値の場合は警告を追加
    if (zScoreResult.isAnomaly && zScoreResult.anomalyDetail) {
      const displayName = getIndicatorDisplayName(indicatorId);
      warnings.push(`⚠️ ${displayName}: ${zScoreResult.anomalyDetail}`);
    }
  }

  return { values, warnings };
}

/**
 * インジケーターIDから表示名を取得
 * 
 * マッチング警告でユーザーに分かりやすく表示するため
 */
function getIndicatorDisplayName(indicatorId: IndicatorId): string {
  const displayNames: Record<IndicatorId, string> = {
    rsi: 'RSI',
    sma: 'SMA',
    ema: 'EMA',
    macd: 'MACD',
    bb: 'ボリンジャーバンド',
    atr: 'ATR',
    stochastic: 'ストキャスティクス',
    obv: 'OBV',
    vwap: 'VWAP',
    williamsR: 'Williams %R',
    cci: 'CCI',
    aroon: 'Aroon',
    roc: 'ROC',
    mfi: 'MFI',
    cmf: 'CMF',
    dema: 'DEMA',
    tema: 'TEMA',
    kc: 'ケルトナーチャネル',
    psar: 'Parabolic SAR',
    ichimoku: '一目均衡表',
  };

  return displayNames[indicatorId] || indicatorId;
}

/**
 * デフォルトのルックバック期間
 * Z-score計算に使用する過去データの期間
 */
export const DEFAULT_ZSCORE_LOOKBACK = 20;

/**
 * デフォルトの異常値閾値
 * ±3σを超える場合に異常値として警告
 */
export const DEFAULT_ANOMALY_THRESHOLD = 3;
