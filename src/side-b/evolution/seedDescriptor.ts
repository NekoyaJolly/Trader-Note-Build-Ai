/**
 * regime 別の seed トリガー構造 + SL/TP 設定 (PR #114)。
 *
 * 旧 seed は全 regime で `close > 0` (常時 true) で「無条件エントリー」相当だった。
 * これでは進化の出発点が trivial になり、mutation で多様な仮説に発散しにくい。
 *
 * 各 regime の意図 (現 DSL は `lens.feature op literal` のみ表現可能、`close > open`
 * のような indicator 同士比較は PR #116 で `compareTarget` で表現):
 * - **breakout**: RSI 強気帯 (>55) + ATR 高ボラ (>0.0008) → 上昇 + 揺らぎ十分
 * - **trending_with_pullback**: RSI 中立 (40-60) → 押し目買い候補
 * - **consolidation**: RSI 中立 (45-55) + 低ボラ (<0.0015) → レンジ底狙い
 * - **reversal**: RSI 売られすぎ (<30) → 反転狙い
 * - **default (未知 regime)**: RSI 弱気帯 (<50) → 保守値
 *
 * 全条件は `ohlcv.{rsi, atr}` のみで構成、AND 結合。数学的に常時 true / false に
 * はならない (= 進化の意味のある出発点)。
 *
 * PR #122 Copilot review: 旧 `EvolutionLoop.ts` から本ファイルに切り出し済み。
 * `EvolutionLoop` ↔ `parentPoolPolicy` の循環依存を解消するため、両者から本
 * ファイル経由で `getSeedDescriptor` を import する。
 */

export type SeedConditionLeaf = {
  lens: 'ohlcv';
  feature: 'rsi' | 'atr';
  op: '<' | '<=' | '>' | '>=' | 'between';
  value: number | [number, number];
};

export type SeedDescriptor = {
  description: string;
  conditions: SeedConditionLeaf[];
  stopLoss: { type: 'atr_multiple'; value: number };
  takeProfit: { type: 'rr_ratio'; value: number };
};

export function getSeedDescriptor(regime: string): SeedDescriptor {
  switch (regime) {
    case 'breakout':
      return {
        description: 'breakout シード: RSI 強気帯 (>55) + 高ボラ (atr>0.0008)',
        conditions: [
          { lens: 'ohlcv', feature: 'rsi', op: '>', value: 55 },
          { lens: 'ohlcv', feature: 'atr', op: '>', value: 0.0008 },
        ],
        stopLoss: { type: 'atr_multiple', value: 1.5 },
        takeProfit: { type: 'rr_ratio', value: 2 },
      };
    case 'trending_with_pullback':
      return {
        description: 'trending_with_pullback シード: RSI 中立 (40-60) で押し目買い候補',
        conditions: [{ lens: 'ohlcv', feature: 'rsi', op: 'between', value: [40, 60] }],
        stopLoss: { type: 'atr_multiple', value: 2.0 },
        takeProfit: { type: 'rr_ratio', value: 2.5 },
      };
    case 'consolidation':
      return {
        description: 'consolidation シード: RSI 中立 (45-55) + 低ボラ (atr<0.0015) でレンジ底狙い',
        conditions: [
          { lens: 'ohlcv', feature: 'rsi', op: 'between', value: [45, 55] },
          { lens: 'ohlcv', feature: 'atr', op: '<', value: 0.0015 },
        ],
        stopLoss: { type: 'atr_multiple', value: 1.0 },
        takeProfit: { type: 'rr_ratio', value: 1.5 },
      };
    case 'reversal':
      return {
        description: 'reversal シード: RSI 売られすぎ (<30) で反転狙い',
        conditions: [{ lens: 'ohlcv', feature: 'rsi', op: '<', value: 30 }],
        stopLoss: { type: 'atr_multiple', value: 1.5 },
        takeProfit: { type: 'rr_ratio', value: 2 },
      };
    default:
      return {
        description: `default シード (regime=${regime}): RSI 弱気帯 (<50) で保守的に拾う`,
        conditions: [{ lens: 'ohlcv', feature: 'rsi', op: '<', value: 50 }],
        stopLoss: { type: 'atr_multiple', value: 1.5 },
        takeProfit: { type: 'rr_ratio', value: 2 },
      };
  }
}
