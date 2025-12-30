/**
 * インジケーター設定型定義
 * 
 * 目的:
 * - ユーザーが選択可能な20種類のインジケーターを定義
 * - 同一インジケーターの複数期間選択をサポート
 * - TradeDefinition生成時の特徴量計算に使用
 * 
 * 設計方針:
 * - 各インジケーターは固有のIDと表示名を持つ
 * - パラメータは型安全に定義
 * - バリデーションルールを明示
 */

/**
 * 利用可能なインジケーター種別
 * 
 * indicatorts ライブラリの分類に基づく:
 * - momentum: モメンタム系（RSI, Stochastic, WilliamsR 等）
 * - trend: トレンド系（SMA, EMA, MACD, Aroon 等）
 * - volatility: ボラティリティ系（ATR, BB, KC 等）
 * - volume: 出来高系（OBV, VWAP, CMF 等）
 */
export type IndicatorCategory = 'momentum' | 'trend' | 'volatility' | 'volume';

/**
 * サポートするインジケーター ID
 * 
 * Phase 1 では 20 種類をサポート:
 * 既存 9 種 + 新規 11 種 = 20 種
 */
export type IndicatorId =
  // 既存（9種）
  | 'rsi'           // Relative Strength Index
  | 'sma'           // Simple Moving Average
  | 'ema'           // Exponential Moving Average
  | 'macd'          // Moving Average Convergence Divergence
  | 'bb'            // Bollinger Bands
  | 'atr'           // Average True Range
  | 'stochastic'    // Stochastic Oscillator
  | 'obv'           // On Balance Volume
  | 'vwap'          // Volume Weighted Average Price
  // 新規追加（11種）
  | 'williamsR'     // Williams %R
  | 'cci'           // Community Channel Index (CCI)
  | 'aroon'         // Aroon Indicator
  | 'roc'           // Rate of Change (Price Rate of Change)
  | 'mfi'           // Money Flow Index
  | 'cmf'           // Chaikin Money Flow
  | 'dema'          // Double Exponential Moving Average
  | 'tema'          // Triple Exponential Moving Average
  | 'kc'            // Keltner Channel
  | 'psar'          // Parabolic SAR
  | 'ichimoku';     // Ichimoku Cloud

/**
 * インジケーターメタデータ
 * 
 * UI表示用およびバリデーション用の情報
 */
export interface IndicatorMetadata {
  // インジケーター識別子
  id: IndicatorId;
  // 日本語表示名
  displayName: string;
  // カテゴリ
  category: IndicatorCategory;
  // 説明文
  description: string;
  // デフォルトパラメータ
  defaultParams: IndicatorParams;
  // パラメータの制約
  paramConstraints: ParamConstraints;
}

/**
 * パラメータ制約定義
 */
export interface ParamConstraints {
  // 期間パラメータの最小値
  minPeriod?: number;
  // 期間パラメータの最大値
  maxPeriod?: number;
  // 標準偏差倍率の範囲（BB, KC用）
  stdDevRange?: { min: number; max: number };
}

/**
 * 各インジケーターのパラメータ型
 * 
 * 同一インジケーターを複数期間で使用する場合、
 * 各設定は個別の IndicatorConfig として管理される
 */
export interface IndicatorParams {
  // 基本期間（RSI, SMA, EMA, ATR, CCI 等）
  period?: number;
  // MACD用: 短期EMA期間
  fastPeriod?: number;
  // MACD用: 長期EMA期間
  slowPeriod?: number;
  // MACD/Stochastic用: シグナル期間
  signalPeriod?: number;
  // Stochastic用: %K期間、%D期間
  kPeriod?: number;
  dPeriod?: number;
  // BB/KC用: 標準偏差の倍率
  stdDev?: number;
  // Parabolic SAR用
  step?: number;
  maxStep?: number;
  // Ichimoku用
  conversionPeriod?: number;  // 転換線期間
  basePeriod?: number;        // 基準線期間
  spanBPeriod?: number;       // 先行スパンB期間
  displacement?: number;      // 遅行スパン
}

/**
 * ユーザーが設定する単一インジケーター設定
 * 
 * 例: RSI(14) と RSI(7) を両方使う場合、
 * 2つの IndicatorConfig を作成する
 */
export interface IndicatorConfig {
  // 設定ID（ユニーク、UIでの識別用）
  configId: string;
  // インジケーター種別
  indicatorId: IndicatorId;
  // カスタムラベル（例: "RSI-短期", "RSI-中期"）
  label?: string;
  // パラメータ設定
  params: IndicatorParams;
  // 有効/無効フラグ
  enabled: boolean;
}

/**
 * インジケーターセット
 * 
 * ユーザーが選択した複数のインジケーター設定をまとめる
 */
export interface IndicatorSet {
  // セット名（例: "短期トレード用", "スイング用"）
  name: string;
  // 設定リスト（最大20個程度を推奨）
  configs: IndicatorConfig[];
  // 作成日時
  createdAt: Date;
  // 更新日時
  updatedAt: Date;
}

/**
 * 利用可能なインジケーターのメタデータ一覧
 * 
 * UI でのインジケーター選択やバリデーションに使用
 */
export const INDICATOR_METADATA: readonly IndicatorMetadata[] = [
  // === Momentum 系 ===
  {
    id: 'rsi',
    displayName: 'RSI（相対力指数）',
    category: 'momentum',
    description: '買われ過ぎ・売られ過ぎを判断する指標。0-100の範囲で表示',
    defaultParams: { period: 14 },
    paramConstraints: { minPeriod: 2, maxPeriod: 100 },
  },
  {
    id: 'stochastic',
    displayName: 'ストキャスティクス',
    category: 'momentum',
    description: '一定期間の最高値・最安値に対する現在値の位置を示す',
    defaultParams: { kPeriod: 14, dPeriod: 3 },
    paramConstraints: { minPeriod: 1, maxPeriod: 100 },
  },
  {
    id: 'williamsR',
    displayName: 'Williams %R',
    category: 'momentum',
    description: 'ストキャスティクスと類似のオシレーター。-100〜0で表示',
    defaultParams: { period: 14 },
    paramConstraints: { minPeriod: 1, maxPeriod: 100 },
  },
  {
    id: 'roc',
    displayName: 'ROC（変化率）',
    category: 'momentum',
    description: '指定期間前との価格変化率を表示',
    defaultParams: { period: 10 },
    paramConstraints: { minPeriod: 1, maxPeriod: 100 },
  },
  {
    id: 'mfi',
    displayName: 'MFI（マネーフローインデックス）',
    category: 'momentum',
    description: '出来高を加味したRSI。0-100の範囲で表示',
    defaultParams: { period: 14 },
    paramConstraints: { minPeriod: 2, maxPeriod: 100 },
  },
  // === Trend 系 ===
  {
    id: 'sma',
    displayName: 'SMA（単純移動平均）',
    category: 'trend',
    description: '指定期間の終値平均。トレンドの方向性を判断',
    defaultParams: { period: 20 },
    paramConstraints: { minPeriod: 1, maxPeriod: 500 },
  },
  {
    id: 'ema',
    displayName: 'EMA（指数移動平均）',
    category: 'trend',
    description: '直近の価格に重みを置いた移動平均',
    defaultParams: { period: 20 },
    paramConstraints: { minPeriod: 1, maxPeriod: 500 },
  },
  {
    id: 'dema',
    displayName: 'DEMA（二重指数移動平均）',
    category: 'trend',
    description: 'EMAのラグを軽減した移動平均',
    defaultParams: { period: 20 },
    paramConstraints: { minPeriod: 1, maxPeriod: 500 },
  },
  {
    id: 'tema',
    displayName: 'TEMA（三重指数移動平均）',
    category: 'trend',
    description: 'DEMAよりさらにラグを軽減した移動平均',
    defaultParams: { period: 20 },
    paramConstraints: { minPeriod: 1, maxPeriod: 500 },
  },
  {
    id: 'macd',
    displayName: 'MACD',
    category: 'trend',
    description: '短期・長期EMAの差分でトレンド転換を捉える',
    defaultParams: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    paramConstraints: { minPeriod: 1, maxPeriod: 100 },
  },
  {
    id: 'aroon',
    displayName: 'Aroon（アルーン）',
    category: 'trend',
    description: 'トレンドの強さと方向を判断する指標',
    defaultParams: { period: 25 },
    paramConstraints: { minPeriod: 1, maxPeriod: 100 },
  },
  {
    id: 'cci',
    displayName: 'CCI（コモディティチャネル指数）',
    category: 'trend',
    description: '平均価格からの乖離度を測定',
    defaultParams: { period: 20 },
    paramConstraints: { minPeriod: 1, maxPeriod: 100 },
  },
  {
    id: 'psar',
    displayName: 'Parabolic SAR',
    category: 'trend',
    description: 'トレンドの転換点を示す指標',
    defaultParams: { step: 0.02, maxStep: 0.2 },
    paramConstraints: {},
  },
  {
    id: 'ichimoku',
    displayName: '一目均衡表',
    category: 'trend',
    description: '転換線・基準線・雲で複合的にトレンドを判断',
    defaultParams: {
      conversionPeriod: 9,
      basePeriod: 26,
      spanBPeriod: 52,
      displacement: 26,
    },
    paramConstraints: { minPeriod: 1, maxPeriod: 200 },
  },
  // === Volatility 系 ===
  {
    id: 'atr',
    displayName: 'ATR（平均真幅）',
    category: 'volatility',
    description: 'ボラティリティの大きさを測定',
    defaultParams: { period: 14 },
    paramConstraints: { minPeriod: 1, maxPeriod: 100 },
  },
  {
    id: 'bb',
    displayName: 'ボリンジャーバンド',
    category: 'volatility',
    description: '移動平均と標準偏差でバンドを形成',
    defaultParams: { period: 20, stdDev: 2 },
    paramConstraints: { minPeriod: 1, maxPeriod: 100, stdDevRange: { min: 0.5, max: 4 } },
  },
  {
    id: 'kc',
    displayName: 'ケルトナーチャネル',
    category: 'volatility',
    description: 'ATRを使用したトレンドバンド',
    defaultParams: { period: 20, stdDev: 2 },
    paramConstraints: { minPeriod: 1, maxPeriod: 100, stdDevRange: { min: 0.5, max: 4 } },
  },
  // === Volume 系 ===
  {
    id: 'obv',
    displayName: 'OBV（オンバランスボリューム）',
    category: 'volume',
    description: '出来高の累積で需給を判断',
    defaultParams: {},
    paramConstraints: {},
  },
  {
    id: 'vwap',
    displayName: 'VWAP（出来高加重平均価格）',
    category: 'volume',
    description: '出来高で加重した平均価格。機関投資家の基準',
    defaultParams: {},
    paramConstraints: {},
  },
  {
    id: 'cmf',
    displayName: 'CMF（チャイキンマネーフロー）',
    category: 'volume',
    description: '一定期間の買い圧力・売り圧力を測定',
    defaultParams: { period: 20 },
    paramConstraints: { minPeriod: 1, maxPeriod: 100 },
  },
] as const;

/**
 * インジケーターIDからメタデータを取得
 * 
 * @param id - インジケーターID
 * @returns メタデータまたはundefined
 */
export function getIndicatorMetadata(id: IndicatorId): IndicatorMetadata | undefined {
  return INDICATOR_METADATA.find(meta => meta.id === id);
}

/**
 * カテゴリでインジケーターをフィルタ
 * 
 * @param category - インジケーターカテゴリ
 * @returns 該当カテゴリのメタデータ配列
 */
export function getIndicatorsByCategory(category: IndicatorCategory): IndicatorMetadata[] {
  return INDICATOR_METADATA.filter(meta => meta.category === category);
}

/**
 * デフォルトのインジケーターセットを生成
 * 
 * MVP用の基本セット（9種類）
 * @returns デフォルトのIndicatorSet
 */
export function createDefaultIndicatorSet(): IndicatorSet {
  const now = new Date();
  return {
    name: 'デフォルト',
    configs: [
      { configId: 'rsi-14', indicatorId: 'rsi', label: 'RSI(14)', params: { period: 14 }, enabled: true },
      { configId: 'sma-20', indicatorId: 'sma', label: 'SMA(20)', params: { period: 20 }, enabled: true },
      { configId: 'ema-20', indicatorId: 'ema', label: 'EMA(20)', params: { period: 20 }, enabled: true },
      { configId: 'macd-default', indicatorId: 'macd', label: 'MACD', params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }, enabled: true },
      { configId: 'bb-20', indicatorId: 'bb', label: 'BB(20,2)', params: { period: 20, stdDev: 2 }, enabled: true },
      { configId: 'atr-14', indicatorId: 'atr', label: 'ATR(14)', params: { period: 14 }, enabled: true },
      { configId: 'stoch-14-3', indicatorId: 'stochastic', label: 'Stoch(14,3)', params: { kPeriod: 14, dPeriod: 3 }, enabled: true },
      { configId: 'obv-default', indicatorId: 'obv', label: 'OBV', params: {}, enabled: true },
      { configId: 'vwap-default', indicatorId: 'vwap', label: 'VWAP', params: {}, enabled: true },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * IndicatorConfig のパラメータをバリデーション
 * 
 * @param config - 検証対象の設定
 * @returns エラーメッセージ配列（空なら有効）
 */
export function validateIndicatorConfig(config: IndicatorConfig): string[] {
  const errors: string[] = [];
  const metadata = getIndicatorMetadata(config.indicatorId);

  if (!metadata) {
    errors.push(`不明なインジケーター: ${config.indicatorId}`);
    return errors;
  }

  const { paramConstraints } = metadata;
  const { params } = config;

  // 期間パラメータのバリデーション
  if (params.period !== undefined && paramConstraints.minPeriod !== undefined) {
    if (params.period < paramConstraints.minPeriod) {
      errors.push(`${metadata.displayName}の期間は${paramConstraints.minPeriod}以上にしてください`);
    }
  }
  if (params.period !== undefined && paramConstraints.maxPeriod !== undefined) {
    if (params.period > paramConstraints.maxPeriod) {
      errors.push(`${metadata.displayName}の期間は${paramConstraints.maxPeriod}以下にしてください`);
    }
  }

  // 標準偏差のバリデーション
  if (params.stdDev !== undefined && paramConstraints.stdDevRange) {
    if (params.stdDev < paramConstraints.stdDevRange.min || params.stdDev > paramConstraints.stdDevRange.max) {
      errors.push(`${metadata.displayName}の標準偏差は${paramConstraints.stdDevRange.min}〜${paramConstraints.stdDevRange.max}の範囲で設定してください`);
    }
  }

  return errors;
}
