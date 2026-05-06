/**
 * PR #114: regime 別 seed strategy のテスト。
 *
 * 旧 seed は全 regime で `close > 0` (常時 true) という trivial な「無条件エントリー」相当だった。
 * このテストは regime 別 seed が:
 *   1. 各 regime で意味の異なる trigger 条件を返す
 *   2. 全 leaf が PR #112 対応の `ohlcv.{rsi, atr}` のみに収まる (= Python BT が動く)
 *   3. trigger が数学的に常時 true な条件 (`close > 0` 等) を含まない
 *   4. StrategyDSLSchema を通る (= Zod parse が落ちない)
 *   5. 未知 regime は default に倒れる
 *
 * を pin する。
 */

import { getSeedDescriptor, seedStrategy } from '../../evolution/EvolutionLoop';
import type { ConditionGroup } from '../../strategy_dsl/schema';
import { StrategyDSLSchema, type Condition, type StrategyDSL } from '../../strategy_dsl/schema';

/** seed の trigger ConditionGroup を取り出す。seed は ImmediateEntry を生成する想定。 */
function getTriggerGroup(seed: StrategyDSL): ConditionGroup {
  const entry = seed.entry as { trigger?: ConditionGroup; triggerConditions?: ConditionGroup };
  // seed は ImmediateEntry なので trigger を持つ
  const group = entry.trigger ?? entry.triggerConditions;
  if (!group) {
    throw new Error('seed entry に trigger / triggerConditions が見つからない');
  }
  return group;
}

/** ConditionGroup の leaf を平坦化 */
function flattenLeaves(group: ConditionGroup): Condition[] {
  const out: Condition[] = [];
  for (const c of group.conditions) {
    if ('logic' in c) out.push(...flattenLeaves(c));
    else out.push(c);
  }
  return out;
}

describe('PR #114: regime 別 seed strategy', () => {
  describe('getSeedDescriptor', () => {
    it('breakout: RSI 強気帯 (>55) + 高ボラ (atr>0.0008)', () => {
      const desc = getSeedDescriptor('breakout');
      expect(desc.conditions).toHaveLength(2);
      expect(desc.conditions).toContainEqual({ lens: 'ohlcv', feature: 'rsi', op: '>', value: 55 });
      expect(desc.conditions).toContainEqual({ lens: 'ohlcv', feature: 'atr', op: '>', value: 0.0008 });
      expect(desc.stopLoss).toEqual({ type: 'atr_multiple', value: 1.5 });
      expect(desc.takeProfit).toEqual({ type: 'rr_ratio', value: 2 });
    });

    it('trending_with_pullback: RSI 中立 (between 40-60)', () => {
      const desc = getSeedDescriptor('trending_with_pullback');
      expect(desc.conditions).toEqual([
        { lens: 'ohlcv', feature: 'rsi', op: 'between', value: [40, 60] },
      ]);
      expect(desc.stopLoss).toEqual({ type: 'atr_multiple', value: 2.0 });
      expect(desc.takeProfit).toEqual({ type: 'rr_ratio', value: 2.5 });
    });

    it('consolidation: RSI 中立 (45-55) + 低ボラ (atr<0.0015)', () => {
      const desc = getSeedDescriptor('consolidation');
      expect(desc.conditions).toHaveLength(2);
      expect(desc.conditions).toContainEqual({ lens: 'ohlcv', feature: 'rsi', op: 'between', value: [45, 55] });
      expect(desc.conditions).toContainEqual({ lens: 'ohlcv', feature: 'atr', op: '<', value: 0.0015 });
      expect(desc.stopLoss).toEqual({ type: 'atr_multiple', value: 1.0 });
      expect(desc.takeProfit).toEqual({ type: 'rr_ratio', value: 1.5 });
    });

    it('reversal: RSI 売られすぎ (<30)', () => {
      const desc = getSeedDescriptor('reversal');
      expect(desc.conditions).toEqual([{ lens: 'ohlcv', feature: 'rsi', op: '<', value: 30 }]);
    });

    it('未知 regime は default (RSI <50) に倒れる', () => {
      const desc = getSeedDescriptor('totally_unknown_regime_xyz');
      expect(desc.conditions).toEqual([{ lens: 'ohlcv', feature: 'rsi', op: '<', value: 50 }]);
    });

    it('未知 regime の description には regime 名が埋め込まれる', () => {
      const desc = getSeedDescriptor('mystery_regime');
      expect(desc.description).toContain('mystery_regime');
    });
  });

  describe('seedStrategy', () => {
    const regimes = ['breakout', 'trending_with_pullback', 'consolidation', 'reversal', 'unknown_x'];

    it.each(regimes)('regime=%s: StrategyDSLSchema を通る', (regime) => {
      const seed = seedStrategy(regime);
      expect(() => StrategyDSLSchema.parse(seed)).not.toThrow();
      expect(seed.regimeTarget).toBe(regime);
      expect(seed.metadata.createdBy).toBe('initial_random');
      expect(seed.metadata.description).toBeDefined();
    });

    it.each(regimes)('regime=%s: 全 leaf が ohlcv.{rsi, atr} のみ (PR #112 対応範囲)', (regime) => {
      const seed = seedStrategy(regime);
      const leaves = flattenLeaves(getTriggerGroup(seed));
      const allowedFeatures = new Set(['rsi', 'atr']);
      expect(leaves.length).toBeGreaterThan(0);
      for (const leaf of leaves) {
        expect(leaf.lens).toBe('ohlcv');
        expect(allowedFeatures.has(leaf.feature)).toBe(true);
      }
    });

    it.each(regimes)('regime=%s: 数学的に常時 true な leaf (close > 0 等) を含まない', (regime) => {
      const seed = seedStrategy(regime);
      const leaves = flattenLeaves(getTriggerGroup(seed));
      const trivial = leaves.find(
        (l) => l.lens === 'ohlcv' && l.feature === 'close' && l.op === '>' && l.value === 0,
      );
      expect(trivial).toBeUndefined();
    });

    it('異なる regime は異なる trigger 構造になる (= 進化の出発点が分岐する)', () => {
      const breakout = seedStrategy('breakout');
      const reversal = seedStrategy('reversal');
      const consolidation = seedStrategy('consolidation');
      const trendingPb = seedStrategy('trending_with_pullback');

      const sigs = [breakout, reversal, consolidation, trendingPb].map((s) =>
        JSON.stringify(getTriggerGroup(s).conditions),
      );
      // 4 regime の trigger 構造はすべて異なる
      expect(new Set(sigs).size).toBe(4);
    });

    it('trigger は AND 結合の ConditionGroup である', () => {
      const seed = seedStrategy('breakout');
      const group = getTriggerGroup(seed);
      expect(group.logic).toBe('AND');
      expect(group.conditions.length).toBeGreaterThanOrEqual(1);
    });
  });
});
