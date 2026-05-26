/**
 * IndicatorSpecialist が扱う indicator のカタログ (2026-05-27)。
 *
 * 設計書: docs/architecture/INDICATOR_SPECIALIST_DESIGN.md
 *
 * 役割:
 * - analysis-engine `/v1/indicator-series` 取得時の indicator id + 標準パラメータを集約
 * - 各 indicator の **意味カタログ** (LLM prompt 内蔵用) を提供
 * - P0/P1/P2 優先度別の取得セットを定義
 */

/** 取得対象 indicator の id (analysis-engine 側と完全一致) */
export type IndicatorId =
  | 'sma'
  | 'ema'
  | 'dema'
  | 'tema'
  | 'macd'
  | 'ichimoku'
  | 'psar'
  | 'aroon'
  | 'rsi'
  | 'cci'
  | 'roc'
  | 'mfi'
  | 'atr'
  | 'kc'
  | 'obv'
  | 'vwap'
  | 'cmf';

export interface IndicatorSpec {
  id: IndicatorId;
  /** analysis-engine `compute_indicator_series` 用の標準パラメータ */
  params: Record<string, number>;
  /** どの field を主に参照するか (= analysis-engine 側 1 系列に絞る用、'value' が既定) */
  field: string;
  /** P0 = 必須、P1 = 高、P2 = 中 */
  priority: 'P0' | 'P1' | 'P2';
  /** カテゴリ (= 後段 debug 用) */
  category: 'trend' | 'oscillator' | 'volatility' | 'volume';
}

/**
 * 取得対象 indicator のセット。
 *
 * 設計書 §4.2 の優先度に基づく:
 * - P0 (必須、5 種): sma / ema / rsi / macd / atr
 * - P1 (高、5 種): obv / vwap / ichimoku / cci / aroon
 * - P2 (中、7 種): dema / tema / kc / psar / mfi / roc / cmf
 *
 * Phase 1 では P0 + P1 (= 10 種) を固定取得。P2 は段階追加。
 */
export const INDICATOR_CATALOG: ReadonlyArray<IndicatorSpec> = [
  // === P0 必須 (= トレンド + モメンタム + ボラの基礎) ===
  { id: 'sma', params: { period: 20 }, field: 'value', priority: 'P0', category: 'trend' },
  { id: 'ema', params: { period: 20 }, field: 'value', priority: 'P0', category: 'trend' },
  { id: 'rsi', params: { period: 14 }, field: 'value', priority: 'P0', category: 'oscillator' },
  { id: 'macd', params: { fast: 12, slow: 26, signal: 9 }, field: 'macd', priority: 'P0', category: 'trend' },
  { id: 'atr', params: { period: 14 }, field: 'value', priority: 'P0', category: 'volatility' },
  // === P1 高 (= トレンド / オシレーター強化) ===
  { id: 'obv', params: {}, field: 'value', priority: 'P1', category: 'volume' },
  { id: 'vwap', params: {}, field: 'value', priority: 'P1', category: 'volume' },
  { id: 'ichimoku', params: { tenkan: 9, kijun: 26, senkou_b: 52 }, field: 'tenkan', priority: 'P1', category: 'trend' },
  { id: 'cci', params: { period: 20 }, field: 'value', priority: 'P1', category: 'oscillator' },
  { id: 'aroon', params: { period: 14 }, field: 'aroon_up', priority: 'P1', category: 'trend' },
] as const;

/** P0 必須 indicator id 一覧 (= 取得失敗で Specialist null 化判定に使う) */
export const P0_INDICATOR_IDS: ReadonlyArray<IndicatorId> = INDICATOR_CATALOG
  .filter((s) => s.priority === 'P0')
  .map((s) => s.id);

/**
 * 各 indicator の意味カタログ (LLM prompt に内蔵)。
 *
 * Nekoさん 2026-05-27 指示: 「インジケーターごとに何を表すかを prompt に含めて
 * おかないと毎度大変になる」「LLM に計算させず、analysis-engine の計算結果を解釈
 * させる」設計の根幹。
 *
 * 自然文で各 indicator の意味と典型的な解釈を 1 行で説明。
 */
export const INDICATOR_MEANINGS: Readonly<Record<IndicatorId, string>> = {
  sma: 'Simple Moving Average: 期間内の平均価格。トレンドの平準化を表す',
  ema: 'Exponential Moving Average: 直近を重視した移動平均。トレンド転換に SMA より敏感',
  dema: 'Double EMA: EMA を二重に重ねた smoother、ラグ削減',
  tema: 'Triple EMA: EMA を三重に重ねた smoother、より積極的なラグ削減',
  macd: 'MACD: 短期/長期 EMA の差。トレンドの強さと転換点を示す、ヒストグラム拡大で勢い増',
  ichimoku: 'Ichimoku: 雲 / 転換線 / 基準線 / 遅行線でトレンド転換点と支持/抵抗を一目で',
  psar: 'Parabolic SAR: トレンドフォロー + 反転 stop の目安、ドットの位置で買い/売り判定',
  aroon: 'Aroon: トレンドの強さと age を表す、up/down の差で方向感',
  rsi: 'RSI: 0-100 で相対的な買われ過ぎ/売られ過ぎ。70 以上 = overbought、30 以下 = oversold',
  cci: 'CCI: 標準偏差ベースの逸脱度。±100 で過熱判断',
  roc: 'ROC: モメンタムの変化率',
  mfi: 'MFI: RSI に出来高を加味したオシレーター',
  atr: 'ATR (Average True Range): ボラティリティの絶対量',
  kc: 'Keltner Channel: EMA + ATR の bands。価格の正常範囲',
  obv: 'OBV (On-Balance Volume): 累積出来高。価格と乖離するとダイバージェンス',
  vwap: 'VWAP: 出来高加重平均価格。institutional 価格水準',
  cmf: 'CMF (Chaikin Money Flow): 出来高ベースの買い圧/売り圧',
};

/**
 * prompt に埋め込む indicator カタログを 1 つの string にレンダリング。
 * 「- {id}: {meaning}」形式の Markdown bullet list。
 */
export function renderIndicatorCatalog(): string {
  return INDICATOR_CATALOG
    .map((spec) => `- ${spec.id.toUpperCase()}: ${INDICATOR_MEANINGS[spec.id]}`)
    .join('\n');
}
