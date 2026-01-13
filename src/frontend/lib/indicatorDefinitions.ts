/**
 * インジケーター定義管理
 * 
 * indicators ディレクトリに定義されている23種類のインジケーターの
 * メタ情報と設定を管理する
 */

/**
 * インジケーターカテゴリ
 */
export type IndicatorCategory = 
  | 'momentum' 
  | 'trend' 
  | 'volatility' 
  | 'volume' 
  | 'support/resistance';

/**
 * インジケーターの描画位置
 */
export type IndicatorPane = 'main' | 'sub';

/**
 * インジケーター表示設定
 */
export interface IndicatorDisplaySettings {
  /** 線の色（HEX形式、例: #3b82f6） */
  color: string;
  /** 線の太さ（1-5） */
  lineWidth: number;
  /** 表示ラベル（空の場合はデフォルト名を使用） */
  label?: string;
}

/**
 * インジケーター定義
 */
export interface IndicatorDefinition {
  /** インジケーターID（indicators/*.md の indicator_id と一致） */
  id: string;
  /** 表示名 */
  name: string;
  /** カテゴリ */
  category: IndicatorCategory;
  /** 描画位置（メインチャート or サブチャート） */
  pane: IndicatorPane;
  /** デフォルトパラメータ */
  defaultParams: Record<string, number>;
  /** パラメータの説明 */
  paramDescriptions: Record<string, string>;
  /** 説明 */
  description?: string;
  /** デフォルト表示設定 */
  defaultDisplay: IndicatorDisplaySettings;
}

/**
 * 全インジケーター定義一覧
 * indicators/README.md と各定義ファイルに基づく
 */
export const INDICATOR_DEFINITIONS: IndicatorDefinition[] = [
  // Momentum（モメンタム系）
  {
    id: 'rsi',
    name: 'RSI',
    category: 'momentum',
    pane: 'sub',
    defaultParams: { period: 14 },
    paramDescriptions: { period: '計算期間（標準: 14）' },
    description: '相対力指数。買われすぎ/売られすぎを判定',
    defaultDisplay: {
      color: '#8b5cf6',
      lineWidth: 2,
    },
  },
  {
    id: 'macd',
    name: 'MACD',
    category: 'momentum',
    pane: 'sub',
    defaultParams: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    paramDescriptions: {
      fastPeriod: '短期EMA期間（標準: 12）',
      slowPeriod: '長期EMA期間（標準: 26）',
      signalPeriod: 'シグナルライン期間（標準: 9）',
    },
    description: '移動平均収束拡散法。トレンド変化の兆候検出',
    defaultDisplay: {
      color: '#ec4899',
      lineWidth: 2,
    },
  },
  {
    id: 'stochastic',
    name: 'Stochastic',
    category: 'momentum',
    pane: 'sub',
    defaultParams: { kPeriod: 14, dPeriod: 3 },
    paramDescriptions: {
      kPeriod: '%K期間（標準: 14）',
      dPeriod: '%D期間（標準: 3）',
    },
    description: 'ストキャスティクス。価格の相対位置（過熱判定）',
    defaultDisplay: {
      color: '#f43f5e',
      lineWidth: 2,
    },
  },
  {
    id: 'williamsR',
    name: 'Williams %R',
    category: 'momentum',
    pane: 'sub',
    defaultParams: { period: 14 },
    paramDescriptions: { period: '計算期間（標準: 14）' },
    description: 'ウィリアムズ%R。買われすぎ/売られすぎ（反転型）',
    defaultDisplay: {
      color: '#fb7185',
      lineWidth: 2,
    },
  },
  {
    id: 'cci',
    name: 'CCI',
    category: 'momentum',
    pane: 'sub',
    defaultParams: { period: 20 },
    paramDescriptions: { period: '計算期間（標準: 20）' },
    description: '商品チャネル指数。平均価格からの乖離度',
    defaultDisplay: {
      color: '#a78bfa',
      lineWidth: 2,
    },
  },
  {
    id: 'roc',
    name: 'ROC',
    category: 'momentum',
    pane: 'sub',
    defaultParams: { period: 12 },
    paramDescriptions: { period: '計算期間（標準: 12）' },
    description: '価格変化率。モメンタムの強さを測定',
    defaultDisplay: {
      color: '#fbbf24',
      lineWidth: 2,
    },
  },

  // Trend（トレンド系）
  {
    id: 'sma',
    name: 'SMA',
    category: 'trend',
    pane: 'main',
    defaultParams: { period: 20 },
    paramDescriptions: { period: '移動平均期間（標準: 20）' },
    description: '単純移動平均。トレンド方向の判定（主軸）',
    defaultDisplay: {
      color: '#f59e0b',
      lineWidth: 2,
    },
  },
  {
    id: 'ema',
    name: 'EMA',
    category: 'trend',
    pane: 'main',
    defaultParams: { period: 20 },
    paramDescriptions: { period: '移動平均期間（標準: 20）' },
    description: '指数移動平均。トレンド方向の判定（反応重視）',
    defaultDisplay: {
      color: '#3b82f6',
      lineWidth: 2,
    },
  },
  {
    id: 'dema',
    name: 'DEMA',
    category: 'trend',
    pane: 'main',
    defaultParams: { period: 20 },
    paramDescriptions: { period: '移動平均期間（標準: 20）' },
    description: '二重指数移動平均。高速移動平均（ラグ軽減）',
    defaultDisplay: {
      color: '#10b981',
      lineWidth: 2,
    },
  },
  {
    id: 'tema',
    name: 'TEMA',
    category: 'trend',
    pane: 'main',
    defaultParams: { period: 20 },
    paramDescriptions: { period: '移動平均期間（標準: 20）' },
    description: '三重指数移動平均。超高速移動平均（最小ラグ）',
    defaultDisplay: {
      color: '#06b6d4',
      lineWidth: 2,
    },
  },
  {
    id: 'aroon',
    name: 'Aroon',
    category: 'trend',
    pane: 'sub',
    defaultParams: { period: 14 },
    paramDescriptions: { period: '計算期間（標準: 14）' },
    description: 'アローンポインター。トレンド強度と方向',
    defaultDisplay: {
      color: '#34d399',
      lineWidth: 2,
    },
  },
  {
    id: 'adx',
    name: 'ADX',
    category: 'trend',
    pane: 'sub',
    defaultParams: { period: 14 },
    paramDescriptions: { period: '計算期間（標準: 14）' },
    description: '平均方向性指数。トレンドの強さを測定',
    defaultDisplay: {
      color: '#60a5fa',
      lineWidth: 2,
    },
  },
  {
    id: 'psar',
    name: 'Parabolic SAR',
    category: 'trend',
    pane: 'main',
    defaultParams: { step: 0.02, max: 0.2 },
    paramDescriptions: {
      step: '加速係数（標準: 0.02）',
      max: '最大加速係数（標準: 0.2）',
    },
    description: '放物線SAR。トレンド方向とストップレベル',
    defaultDisplay: {
      color: '#f59e0b',
      lineWidth: 1,
    },
  },
  {
    id: 'supertrend',
    name: 'Supertrend',
    category: 'trend',
    pane: 'main',
    defaultParams: { period: 10, multiplier: 3.0 },
    paramDescriptions: {
      period: 'ATR期間（標準: 10）',
      multiplier: 'ATR倍数（標準: 3.0）',
    },
    description: 'スーパートレンド。ATRベースのトレンドフォロー',
    defaultDisplay: {
      color: '#14b8a6',
      lineWidth: 2,
    },
  },
  {
    id: 'ichimoku',
    name: 'Ichimoku',
    category: 'trend',
    pane: 'main',
    defaultParams: { tenkan: 9, kijun: 26, senkou: 52 },
    paramDescriptions: {
      tenkan: '転換線期間（標準: 9）',
      kijun: '基準線期間（標準: 26）',
      senkou: '先行スパン期間（標準: 52）',
    },
    description: '一目均衡表。総合トレンド分析',
    defaultDisplay: {
      color: '#8b5cf6',
      lineWidth: 2,
    },
  },

  // Volatility（ボラティリティ系）
  {
    id: 'bb',
    name: 'Bollinger Bands',
    category: 'volatility',
    pane: 'main',
    defaultParams: { period: 20, stdDev: 2 },
    paramDescriptions: {
      period: '移動平均期間（標準: 20）',
      stdDev: '標準偏差倍数（標準: 2）',
    },
    description: 'ボリンジャーバンド。ボラティリティと価格位置',
    defaultDisplay: {
      color: '#6366f1',
      lineWidth: 1,
    },
  },
  {
    id: 'atr',
    name: 'ATR',
    category: 'volatility',
    pane: 'sub',
    defaultParams: { period: 14 },
    paramDescriptions: { period: '計算期間（標準: 14）' },
    description: '平均真の値幅。ボラティリティ測定',
    defaultDisplay: {
      color: '#f97316',
      lineWidth: 2,
    },
  },
  {
    id: 'kc',
    name: 'Keltner Channel',
    category: 'volatility',
    pane: 'main',
    defaultParams: { period: 20, multiplier: 2.0 },
    paramDescriptions: {
      period: '移動平均期間（標準: 20）',
      multiplier: 'ATR倍数（標準: 2.0）',
    },
    description: 'ケルトナーチャネル。ATRベースのバンド',
    defaultDisplay: {
      color: '#3b82f6',
      lineWidth: 1,
    },
  },

  // Volume（出来高系）
  {
    id: 'obv',
    name: 'OBV',
    category: 'volume',
    pane: 'sub',
    defaultParams: {},
    paramDescriptions: {},
    description: '出来高バランス。出来高の累積方向',
    defaultDisplay: {
      color: '#22c55e',
      lineWidth: 2,
    },
  },
  {
    id: 'vwap',
    name: 'VWAP',
    category: 'volume',
    pane: 'main',
    defaultParams: {},
    paramDescriptions: {},
    description: '出来高加重平均価格',
    defaultDisplay: {
      color: '#6366f1',
      lineWidth: 2,
    },
  },
  {
    id: 'mfi',
    name: 'MFI',
    category: 'volume',
    pane: 'sub',
    defaultParams: { period: 14 },
    paramDescriptions: { period: '計算期間（標準: 14）' },
    description: '資金流量指数。出来高加重RSI',
    defaultDisplay: {
      color: '#ec4899',
      lineWidth: 2,
    },
  },
  {
    id: 'cmf',
    name: 'CMF',
    category: 'volume',
    pane: 'sub',
    defaultParams: { period: 20 },
    paramDescriptions: { period: '計算期間（標準: 20）' },
    description: 'チャイキン資金流量。資金流入/流出強度',
    defaultDisplay: {
      color: '#8b5cf6',
      lineWidth: 2,
    },
  },

  // Support/Resistance（サポレジ系）
  {
    id: 'pivot',
    name: 'Pivot Points',
    category: 'support/resistance',
    pane: 'main',
    defaultParams: {},
    paramDescriptions: {},
    description: 'ピボットポイント。自動S/Rレベル計算',
    defaultDisplay: {
      color: '#f59e0b',
      lineWidth: 1,
    },
  },
];

/**
 * カテゴリ別にインジケーターを取得
 */
export function getIndicatorsByCategory(
  category: IndicatorCategory
): IndicatorDefinition[] {
  return INDICATOR_DEFINITIONS.filter((ind) => ind.category === category);
}

/**
 * IDでインジケーターを取得
 */
export function getIndicatorById(id: string): IndicatorDefinition | undefined {
  return INDICATOR_DEFINITIONS.find((ind) => ind.id === id);
}

/**
 * 全カテゴリ一覧を取得
 */
export function getAllCategories(): IndicatorCategory[] {
  return ['momentum', 'trend', 'volatility', 'volume', 'support/resistance'];
}

/**
 * カテゴリの日本語名
 */
export const CATEGORY_LABELS: Record<IndicatorCategory, string> = {
  momentum: 'モメンタム',
  trend: 'トレンド',
  volatility: 'ボラティリティ',
  volume: '出来高',
  'support/resistance': 'サポレジ',
};

