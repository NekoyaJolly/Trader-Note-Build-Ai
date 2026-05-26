/**
 * IndicatorSpecialist が扱う indicator のカタログ (2026-05-27)。
 *
 * 設計書: docs/architecture/INDICATOR_SPECIALIST_DESIGN.md
 *
 * 役割:
 * - 取得対象 indicator (= P0/P1 の Phase 1 固定 10 種) を Specialist 固有情報
 *   (priority / field / category / 意味文) と共に集約
 * - `IndicatorId` は **shared registry** (`src/shared/indicators/registry.ts`) を
 *   canonical 情報源として import (= drift 防止)
 *
 * Phase 1: P0 (5 種) + P1 (5 種) = 計 10 種固定。P2 は将来必要になった時点で追加。
 */

import type { IndicatorId } from '../../../shared/indicators/registry';

export interface IndicatorSpec {
  id: IndicatorId;
  /** analysis-engine `compute_indicator_series` 用の標準パラメータ */
  params: Record<string, number>;
  /** どの field を主に参照するか (= analysis-engine 側 1 系列に絞る用、'value' が既定) */
  field: string;
  /** P0 = 必須、P1 = 高、P2 = 中 (Phase 1 では P0+P1 のみ採用) */
  priority: 'P0' | 'P1' | 'P2';
  /** カテゴリ (= 後段 debug 用) */
  category: 'trend' | 'oscillator' | 'volatility' | 'volume';
}

/**
 * 取得対象 indicator のセット (Phase 1 = P0 + P1 の **10 種固定**)。
 *
 * - P0 (必須、5 種): sma / ema / rsi / macd / atr
 * - P1 (高、5 種): obv / vwap / ichimoku / cci / aroon
 *
 * P2 は将来必要になった時点で追加 (dema / tema / kc / psar / mfi / roc / cmf 等)。
 * shared registry には bb / stochastic / williamsR / adx / supertrend / pivot 等も
 * 存在するが、Specialist が解釈すべき最小セットに絞っている。
 */
// `as const satisfies` で `IndicatorSpec[]` 制約を満たしつつ literal 型を保持
// (= 後段で `(typeof INDICATOR_CATALOG)[number]['id']` で tuple union を抽出できるように)。
export const INDICATOR_CATALOG = [
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
] as const satisfies ReadonlyArray<IndicatorSpec>;

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
 *
 * Key type は `INDICATOR_CATALOG` に含まれる id のみ (= Phase 1 固定 10 種)。
 * 将来 P2 を追加する場合は CATALOG への spec 追加 + ここに 1 行追加する。
 */
type CatalogIndicatorId = (typeof INDICATOR_CATALOG)[number]['id'];

export const INDICATOR_MEANINGS: Readonly<Record<CatalogIndicatorId, string>> = {
  sma: 'Simple Moving Average — 期間内の平均価格。トレンドの平準化を表す',
  ema: 'Exponential Moving Average — 直近を重視した移動平均。トレンド転換に SMA より敏感',
  macd: 'MACD — 短期/長期 EMA の差。トレンドの強さと転換点を示す、ヒストグラム拡大で勢い増',
  rsi: 'RSI — 0-100 で相対的な買われ過ぎ/売られ過ぎ。70 以上 = overbought、30 以下 = oversold',
  atr: 'ATR (Average True Range) — ボラティリティの絶対量',
  ichimoku: 'Ichimoku — 雲 / 転換線 / 基準線 / 遅行線でトレンド転換点と支持/抵抗を一目で',
  cci: 'CCI — 標準偏差ベースの逸脱度。±100 で過熱判断',
  aroon: 'Aroon — トレンドの強さと age を表す、up/down の差で方向感',
  obv: 'OBV (On-Balance Volume) — 累積出来高。価格と乖離するとダイバージェンス',
  vwap: 'VWAP — 出来高加重平均価格。institutional 価格水準',
};

/**
 * prompt に埋め込む indicator カタログを 1 つの string にレンダリング。
 * 各 meaning は既に "RSI — 説明" 形式で接頭辞を含むため、bullet 接頭辞 `- ` のみ付与する
 * (= 「- RSI: RSI — ...」のような重複ラベルを避ける、PR #261 Copilot review #4 対応)。
 */
export function renderIndicatorCatalog(): string {
  return INDICATOR_CATALOG.map((spec) => `- ${INDICATOR_MEANINGS[spec.id]}`).join('\n');
}
