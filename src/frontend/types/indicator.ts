/**
 * インジケーター関連の型定義
 * 
 * 目的:
 * - フロントエンドで使用するインジケーター設定の型
 * - APIレスポンスの型定義
 */

/**
 * インジケーターカテゴリ
 */
export type IndicatorCategory = 'momentum' | 'trend' | 'volatility' | 'volume';

/**
 * インジケーターID
 */
export type IndicatorId =
  | 'rsi' | 'sma' | 'ema' | 'macd' | 'bb' | 'atr' | 'stochastic' | 'obv' | 'vwap'
  | 'williamsR' | 'cci' | 'aroon' | 'roc' | 'mfi' | 'cmf' | 'dema' | 'tema' | 'kc' | 'psar' | 'ichimoku';

/**
 * インジケーターパラメータ
 */
export interface IndicatorParams {
  period?: number;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
  kPeriod?: number;
  dPeriod?: number;
  // stdDevはindicatortsライブラリの制約により2固定のため削除
  step?: number;
  maxStep?: number;
  conversionPeriod?: number;
  basePeriod?: number;
  spanBPeriod?: number;
  displacement?: number;
}

/**
 * パラメータ制約
 */
export interface ParamConstraints {
  minPeriod?: number;
  maxPeriod?: number;
  // stdDevRangeはindicatortsライブラリの制約により不要
}

/**
 * インジケーターメタデータ
 */
export interface IndicatorMetadata {
  id: IndicatorId;
  displayName: string;
  category: IndicatorCategory;
  description: string;
  defaultParams: IndicatorParams;
  paramConstraints: ParamConstraints;
}

/**
 * ユーザーが設定した単一インジケーター設定
 */
export interface IndicatorConfig {
  configId: string;
  indicatorId: IndicatorId;
  label?: string;
  params: IndicatorParams;
  enabled: boolean;
}

/**
 * インジケーターセット
 */
export interface IndicatorSet {
  name: string;
  configs: IndicatorConfig[];
  createdAt: string;
  updatedAt: string;
}

/**
 * ユーザーインジケーター設定
 */
export interface UserIndicatorSettings {
  activeSet: IndicatorSet;
  hasCompletedSetup: boolean;
  updatedAt: string;
}

/**
 * インジケーター設定保存リクエスト
 */
export interface SaveIndicatorConfigRequest {
  indicatorId: IndicatorId;
  params: IndicatorParams;
  enabled?: boolean;
  label?: string;
}

/**
 * カテゴリ表示情報
 */
export const CATEGORY_INFO: Record<IndicatorCategory, { label: string; color: string }> = {
  momentum: { label: 'モメンタム', color: 'text-blue-400' },
  trend: { label: 'トレンド', color: 'text-green-400' },
  volatility: { label: 'ボラティリティ', color: 'text-yellow-400' },
  volume: { label: '出来高', color: 'text-purple-400' },
};
