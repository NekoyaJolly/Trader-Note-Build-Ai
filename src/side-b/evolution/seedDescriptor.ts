/**
 * 進化ループの初期 novelty seed (PR ⑤D-2)。
 *
 * **設計方針 (Nekoさん 確定)**: 既存の regime 別 5 seed (RSI/ATR 単純) は撤廃し、
 * 6 戦略カテゴリ × long/short = **12 種の seed** を初期世代に並列注入する。
 * 各 seed は機能群 (= MTF / multi-instance / time_session / 20 indicator) を
 * 意識的に「使い切る」形で組まれており、進化ループの探索初期から多様な戦略
 * アーキタイプが出発点に並ぶ。pattern lens は本 seed 集には含めず、mutation /
 * crossover の探索的変異 (PR ⑤C) で導入される想定 (= 12 seed 数を保つため)。
 *
 * **戦略カテゴリ**:
 * 1. **MTF** (= 上位足コンテキスト + 下位足エントリー): mtf_long / mtf_short
 * 2. **multi-instance indicator** (= EMA パーフェクトオーダー):
 *    multi_instance_long / multi_instance_short
 * 3. **トレンドフォロー** (= indicator 2 つ以上): trend_long / trend_short
 * 4. **オシレーター** (= 過売り / 過買い、indicator 2 つ以上):
 *    oscillator_long / oscillator_short
 * 5. **アノマリー** (= time_session lens の day_of_month / 曜日 / セッション):
 *    anomaly_long / anomaly_short
 * 6. **レンジ** (= 低ボラ + 過売り/過買り):
 *    range_long / range_short
 *
 * 主 timeframe は **15m** (= MTF で 1h を上位足として使うため)。symbol は
 * 既定で `EURUSD`。各 seed は entry trigger + SL/TP + parameters を完備した
 * `StrategyDSL` として `StrategyDSLSchema.parse` 通過済みで提供される。
 *
 * **後方互換**: 旧 `getSeedDescriptor(regime)` は撤廃。novelty seed の供給元は
 * `buildAllNoveltySeeds(regime)` に統一される。regime は seed 内の `regimeTarget`
 * フィールドに記録するが、seed 内容自体は regime に依存しない (= 12 種を全 regime
 * で並列注入)。
 */

import { randomUUID } from 'crypto';

import { StrategyDSLSchema, type StrategyDSL } from '../strategy_dsl/schema';

/** 12 種の seed の識別子 (= 安定キー)。 */
export type SeedKind =
  | 'mtf_long'
  | 'mtf_short'
  | 'multi_instance_long'
  | 'multi_instance_short'
  | 'trend_long'
  | 'trend_short'
  | 'oscillator_long'
  | 'oscillator_short'
  | 'anomaly_long'
  | 'anomaly_short'
  | 'range_long'
  | 'range_short';

export const ALL_SEED_KINDS: readonly SeedKind[] = [
  'mtf_long',
  'mtf_short',
  'multi_instance_long',
  'multi_instance_short',
  'trend_long',
  'trend_short',
  'oscillator_long',
  'oscillator_short',
  'anomaly_long',
  'anomaly_short',
  'range_long',
  'range_short',
];

interface SeedRecipe {
  /** seed カテゴリの識別子 */
  readonly kind: SeedKind;
  /** 人間語の戦略概要 (= metadata.description に入る、Mutation prompt の参考にもなる) */
  readonly description: string;
  /** entry direction */
  readonly direction: 'long' | 'short';
  /** entry trigger (= ConditionGroup) */
  readonly trigger: StrategyDSL['entry'] extends infer E
    ? E extends { trigger: infer T }
      ? T
      : never
    : never;
  /** SL */
  readonly stopLoss: StrategyDSL['stopLoss'];
  /** TP */
  readonly takeProfit: StrategyDSL['takeProfit'];
  /** 必要な parameters (= ParamRef を value に使う場合のみ。本 seed 集では未使用) */
  readonly parameters?: StrategyDSL['parameters'];
}

const STANDARD_SL: StrategyDSL['stopLoss'] = { type: 'atr_multiple', value: 1.5 };
const STANDARD_TP: StrategyDSL['takeProfit'] = { type: 'rr_ratio', value: 2 };
const TIGHT_SL: StrategyDSL['stopLoss'] = { type: 'atr_multiple', value: 1.0 };
const TIGHT_TP: StrategyDSL['takeProfit'] = { type: 'rr_ratio', value: 1.5 };

const SEED_RECIPES: Record<SeedKind, SeedRecipe> = {
  // === 1. MTF (= 上位足コンテキスト + 下位足エントリー) ===
  mtf_long: {
    kind: 'mtf_long',
    description: 'MTF long: 1h 足が EMA(50) より上 (= 上位足上昇トレンド) かつ 15m RSI 過売り → 押し目買い',
    direction: 'long',
    trigger: {
      logic: 'AND',
      conditions: [
        {
          lens: 'ohlcv',
          feature: 'close',
          op: '>',
          compareTarget: { lens: 'ohlcv', feature: 'ema', params: { period: 50 }, timeframe: '1h' },
          timeframe: '1h',
        },
        { lens: 'ohlcv', feature: 'rsi', op: '<', value: 35 },
      ],
    },
    stopLoss: STANDARD_SL,
    takeProfit: STANDARD_TP,
  },
  mtf_short: {
    kind: 'mtf_short',
    description: 'MTF short: 1h 足が EMA(50) より下 (= 上位足下降トレンド) かつ 15m RSI 過買り → 戻り売り',
    direction: 'short',
    trigger: {
      logic: 'AND',
      conditions: [
        {
          lens: 'ohlcv',
          feature: 'close',
          op: '<',
          compareTarget: { lens: 'ohlcv', feature: 'ema', params: { period: 50 }, timeframe: '1h' },
          timeframe: '1h',
        },
        { lens: 'ohlcv', feature: 'rsi', op: '>', value: 65 },
      ],
    },
    stopLoss: STANDARD_SL,
    takeProfit: STANDARD_TP,
  },

  // === 2. multi-instance EMA (= パーフェクトオーダー) ===
  multi_instance_long: {
    kind: 'multi_instance_long',
    description: 'EMA パーフェクトオーダー long: EMA(7) > EMA(15) > EMA(60) (強い上昇トレンド)',
    direction: 'long',
    trigger: {
      logic: 'AND',
      conditions: [
        {
          lens: 'ohlcv',
          feature: 'ema',
          params: { period: 7 },
          op: '>',
          compareTarget: { lens: 'ohlcv', feature: 'ema', params: { period: 15 } },
        },
        {
          lens: 'ohlcv',
          feature: 'ema',
          params: { period: 15 },
          op: '>',
          compareTarget: { lens: 'ohlcv', feature: 'ema', params: { period: 60 } },
        },
      ],
    },
    stopLoss: STANDARD_SL,
    takeProfit: STANDARD_TP,
  },
  multi_instance_short: {
    kind: 'multi_instance_short',
    description: 'EMA 逆パーフェクトオーダー short: EMA(7) < EMA(15) < EMA(60) (強い下降トレンド)',
    direction: 'short',
    trigger: {
      logic: 'AND',
      conditions: [
        {
          lens: 'ohlcv',
          feature: 'ema',
          params: { period: 7 },
          op: '<',
          compareTarget: { lens: 'ohlcv', feature: 'ema', params: { period: 15 } },
        },
        {
          lens: 'ohlcv',
          feature: 'ema',
          params: { period: 15 },
          op: '<',
          compareTarget: { lens: 'ohlcv', feature: 'ema', params: { period: 60 } },
        },
      ],
    },
    stopLoss: STANDARD_SL,
    takeProfit: STANDARD_TP,
  },

  // === 3. トレンドフォロー (= indicator 2 種以上で確認) ===
  trend_long: {
    kind: 'trend_long',
    description: 'トレンド long: close > EMA(50) かつ MACD > 0 (上昇トレンドの 2 重確認)',
    direction: 'long',
    trigger: {
      logic: 'AND',
      conditions: [
        {
          lens: 'ohlcv',
          feature: 'close',
          op: '>',
          compareTarget: { lens: 'ohlcv', feature: 'ema', params: { period: 50 } },
        },
        {
          lens: 'ohlcv',
          feature: 'macd',
          params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
          op: '>',
          value: 0,
        },
      ],
    },
    stopLoss: STANDARD_SL,
    takeProfit: STANDARD_TP,
  },
  trend_short: {
    kind: 'trend_short',
    description: 'トレンド short: close < EMA(50) かつ MACD < 0 (下降トレンドの 2 重確認)',
    direction: 'short',
    trigger: {
      logic: 'AND',
      conditions: [
        {
          lens: 'ohlcv',
          feature: 'close',
          op: '<',
          compareTarget: { lens: 'ohlcv', feature: 'ema', params: { period: 50 } },
        },
        {
          lens: 'ohlcv',
          feature: 'macd',
          params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
          op: '<',
          value: 0,
        },
      ],
    },
    stopLoss: STANDARD_SL,
    takeProfit: STANDARD_TP,
  },

  // === 4. オシレーター (= 過売り/過買り、indicator 2 種以上) ===
  oscillator_long: {
    kind: 'oscillator_long',
    description: 'オシレーター long: RSI(14) < 30 かつ Williams%R < -80 (過売り 2 重確認で反発狙い)',
    direction: 'long',
    trigger: {
      logic: 'AND',
      conditions: [
        { lens: 'ohlcv', feature: 'rsi', op: '<', value: 30 },
        {
          lens: 'ohlcv',
          feature: 'williamsR',
          params: { period: 14 },
          op: '<',
          value: -80,
        },
      ],
    },
    stopLoss: STANDARD_SL,
    takeProfit: STANDARD_TP,
  },
  oscillator_short: {
    kind: 'oscillator_short',
    description: 'オシレーター short: RSI(14) > 70 かつ Williams%R > -20 (過買り 2 重確認で反落狙い)',
    direction: 'short',
    trigger: {
      logic: 'AND',
      conditions: [
        { lens: 'ohlcv', feature: 'rsi', op: '>', value: 70 },
        {
          lens: 'ohlcv',
          feature: 'williamsR',
          params: { period: 14 },
          op: '>',
          value: -20,
        },
      ],
    },
    stopLoss: STANDARD_SL,
    takeProfit: STANDARD_TP,
  },

  // === 5. アノマリー (= 日付/曜日/セッション + indicator フィルタ) ===
  anomaly_long: {
    kind: 'anomaly_long',
    description: 'アノマリー long: ゴトー日 (5/10/15/20/25/30 日) + ロンドンフィキシング前後 (UTC 14-16) で円安バイアス想定',
    direction: 'long',
    trigger: {
      logic: 'AND',
      conditions: [
        {
          lens: 'time_session',
          feature: 'day_of_month',
          op: 'in',
          value: [5, 10, 15, 20, 25, 30],
        },
        {
          lens: 'time_session',
          feature: 'utc_hour',
          op: 'between',
          value: [14, 16],
        },
      ],
    },
    stopLoss: STANDARD_SL,
    takeProfit: STANDARD_TP,
  },
  anomaly_short: {
    kind: 'anomaly_short',
    description: 'アノマリー short: 金曜 NY クローズ前 (is_friday_close) + RSI 過買い → 週末ポジション整理狙いの戻り売り',
    direction: 'short',
    trigger: {
      logic: 'AND',
      conditions: [
        { lens: 'time_session', feature: 'is_friday_close', op: 'is_true' },
        { lens: 'ohlcv', feature: 'rsi', op: '>', value: 60 },
      ],
    },
    stopLoss: STANDARD_SL,
    takeProfit: STANDARD_TP,
  },

  // === 6. レンジ (= 低ボラ + 過売り/過買りで上下限反発狙い) ===
  range_long: {
    kind: 'range_long',
    description: 'レンジ long: 低ボラ (ATR < 0.0008) + RSI 過売り (< 35) でレンジ底反発狙い',
    direction: 'long',
    trigger: {
      logic: 'AND',
      conditions: [
        { lens: 'ohlcv', feature: 'atr', op: '<', value: 0.0008 },
        { lens: 'ohlcv', feature: 'rsi', op: '<', value: 35 },
      ],
    },
    stopLoss: TIGHT_SL,
    takeProfit: TIGHT_TP,
  },
  range_short: {
    kind: 'range_short',
    description: 'レンジ short: 低ボラ (ATR < 0.0008) + RSI 過買り (> 65) でレンジ上限反落狙い',
    direction: 'short',
    trigger: {
      logic: 'AND',
      conditions: [
        { lens: 'ohlcv', feature: 'atr', op: '<', value: 0.0008 },
        { lens: 'ohlcv', feature: 'rsi', op: '>', value: 65 },
      ],
    },
    stopLoss: TIGHT_SL,
    takeProfit: TIGHT_TP,
  },
};

/**
 * 指定 seedKind の StrategyDSL を生成する。`StrategyDSLSchema.parse` で
 * 検証済の `StrategyDSL` を返す (= 構造的に正当な DSL であることが保証される)。
 *
 * 注: 戻り値は **deep freeze されない** (= 呼び出し側で破壊的変更が物理的には
 * 可能)。進化ループでは戦略を mutation で派生させる際にコピーして使うので
 * 実用上は問題ないが、不変性を強要したい場合は呼び出し側で Object.freeze する。
 *
 * @param kind seed カテゴリ
 * @param regime 戦略の `regimeTarget` フィールドに入れる値 (= 進化ループの分類用)
 * @param symbol 既定 'EURUSD'
 * @param timeframe 既定 '15m' (= MTF で 1h を上位足として使うため)
 */
export function buildSeedDsl(
  kind: SeedKind,
  regime: string,
  symbol: string = 'EURUSD',
  timeframe: string = '15m',
): StrategyDSL {
  const recipe = SEED_RECIPES[kind];
  const raw = {
    id: `novelty-${kind}-${regime}-${randomUUID()}`,
    generation: 0,
    parentIds: [] as string[],
    regimeTarget: regime,
    symbol,
    timeframe,
    entry: {
      direction: recipe.direction,
      trigger: recipe.trigger,
      orderType: 'market' as const,
    },
    stopLoss: recipe.stopLoss,
    takeProfit: recipe.takeProfit,
    parameters: recipe.parameters ?? {},
    metadata: {
      createdAt: new Date().toISOString(),
      createdBy: 'initial_random' as const,
      description: recipe.description,
    },
  };
  return StrategyDSLSchema.parse(raw);
}

/**
 * 全 12 seed を一括生成する (= novelty seed 注入経路の単一エントリポイント)。
 *
 * 戻り値の順序は `ALL_SEED_KINDS` の順序 (= 12 個)。各 seed は **異なる id** を持つ。
 */
export function buildAllNoveltySeeds(
  regime: string,
  symbol: string = 'EURUSD',
  timeframe: string = '15m',
): StrategyDSL[] {
  return ALL_SEED_KINDS.map((kind) => buildSeedDsl(kind, regime, symbol, timeframe));
}
