/**
 * collectDslIndicatorNeeds / collectDslPatternNeeds の MTF 対応テスト (PR ⑤)。
 *
 * - timeframe 未指定の condition は主 timeframe で collect される
 * - 上位足 (1h on 15m strategy) は別 snapshot key (`@1h` 修飾) で collect
 * - 下位足は弾く (= 主より細かい時間足は不正)
 * - 未知 timeframe は弾く
 */

import {
  buildSnapshotKey,
  buildSnapshotKeyWithPrimary,
} from '../../strategy_dsl/snapshotKey';
import {
  collectDslIndicatorNeeds,
  collectDslPatternNeeds,
} from '../../strategy_dsl/dslOhlcvFeatureNeeds';
import { StrategyDSLSchema, type Condition, type ConditionGroup, type StrategyDSL } from '../../strategy_dsl/schema';

/**
 * PR #129 Copilot review #2-3: テスト用 DSL を `StrategyDSLSchema.parse` で
 * Zod を通して構築する (= unknown キャストを使わない型安全な経路)。
 *
 * conditions は `Condition | ConditionGroup` の union 型で受ける。
 */
function makeDsl(
  timeframe: string,
  conditions: Array<Condition | ConditionGroup>,
): StrategyDSL {
  const raw = {
    id: 'test',
    generation: 0,
    parentIds: [],
    regimeTarget: 'breakout',
    symbol: 'EURUSD',
    timeframe,
    entry: {
      direction: 'long' as const,
      trigger: { logic: 'AND' as const, conditions },
    },
    stopLoss: { type: 'atr_multiple' as const, value: 1.5 },
    takeProfit: { type: 'rr_ratio' as const, value: 2 },
    parameters: {},
    metadata: {
      createdAt: '2026-05-08T00:00:00Z',
      createdBy: 'mutation' as const,
    },
  };
  return StrategyDSLSchema.parse(raw);
}

describe('buildSnapshotKey: PR ⑤ 拡張', () => {
  it('timeframe 未指定なら接尾なし (= 後方互換)', () => {
    expect(buildSnapshotKey('ohlcv', 'rsi')).toBe('ohlcv.rsi');
    expect(buildSnapshotKey('ohlcv', 'ema', { period: 20 })).toBe('ohlcv.ema(period=20)');
  });

  it('timeframe 指定で `@<tf>` 修飾が lens の後に付く', () => {
    expect(buildSnapshotKey('ohlcv', 'rsi', undefined, '1h')).toBe('ohlcv@1h.rsi');
    expect(buildSnapshotKey('ohlcv', 'ema', { period: 20 }, '1h')).toBe('ohlcv@1h.ema(period=20)');
  });
});

describe('buildSnapshotKeyWithPrimary', () => {
  it('conditionTimeframe 未指定 → 接尾なし', () => {
    expect(buildSnapshotKeyWithPrimary('ohlcv', 'rsi', undefined, undefined, '15m')).toBe(
      'ohlcv.rsi',
    );
  });

  it('主 timeframe と一致 → 接尾なし (= 後方互換)', () => {
    expect(buildSnapshotKeyWithPrimary('ohlcv', 'rsi', undefined, '15m', '15m')).toBe(
      'ohlcv.rsi',
    );
    // alias 一致も含む
    expect(buildSnapshotKeyWithPrimary('ohlcv', 'rsi', undefined, '60m', '1h')).toBe(
      'ohlcv.rsi',
    );
  });

  it('上位足のみ `@<canonical>` 修飾', () => {
    expect(buildSnapshotKeyWithPrimary('ohlcv', 'ema', { period: 20 }, '1h', '15m')).toBe(
      'ohlcv@1h.ema(period=20)',
    );
  });

  it('未知 timeframe は例外', () => {
    expect(() =>
      buildSnapshotKeyWithPrimary('ohlcv', 'rsi', undefined, 'xxx', '15m'),
    ).toThrow(/未知の conditionTimeframe/);
    expect(() =>
      buildSnapshotKeyWithPrimary('ohlcv', 'rsi', undefined, '1h', 'xxx'),
    ).toThrow(/未知の primaryTimeframe/);
  });
});

describe('collectDslIndicatorNeeds: MTF', () => {
  it('timeframe 未指定の indicator は主 timeframe で集める', () => {
    const dsl = makeDsl('15m', [
      { lens: 'ohlcv', feature: 'ema', op: '>', value: 1.0, params: { period: 20 } },
    ]);
    const needs = collectDslIndicatorNeeds(dsl);
    expect(needs).toHaveLength(1);
    expect(needs[0].snapshotKey).toBe('ohlcv.ema(period=20)');
    expect(needs[0].timeframe).toBe('15m');
  });

  it('上位足指定の indicator は `@<tf>` 修飾 key で集める', () => {
    const dsl = makeDsl('15m', [
      {
        lens: 'ohlcv',
        feature: 'ema',
        op: '>',
        value: 1.0,
        params: { period: 20 },
        timeframe: '1h',
      },
    ]);
    const needs = collectDslIndicatorNeeds(dsl);
    expect(needs).toHaveLength(1);
    expect(needs[0].snapshotKey).toBe('ohlcv@1h.ema(period=20)');
    expect(needs[0].timeframe).toBe('1h');
  });

  it('主 timeframe + 上位足の同じ indicator は別 need として集める', () => {
    const dsl = makeDsl('15m', [
      { lens: 'ohlcv', feature: 'ema', op: '>', value: 1.0, params: { period: 20 } },
      {
        lens: 'ohlcv',
        feature: 'ema',
        op: '>',
        value: 1.0,
        params: { period: 20 },
        timeframe: '1h',
      },
    ]);
    const needs = collectDslIndicatorNeeds(dsl);
    expect(needs).toHaveLength(2);
    const keys = needs.map((n) => n.snapshotKey).sort();
    expect(keys).toEqual(['ohlcv.ema(period=20)', 'ohlcv@1h.ema(period=20)']);
  });

  it('下位足指定 (主より短い時間足) は弾く', () => {
    const dsl = makeDsl('1h', [
      {
        lens: 'ohlcv',
        feature: 'ema',
        op: '>',
        value: 1.0,
        params: { period: 20 },
        timeframe: '15m', // 主 1h より下位足は不正
      },
    ]);
    const needs = collectDslIndicatorNeeds(dsl);
    expect(needs).toHaveLength(0);
  });

  it('未知 timeframe は弾く', () => {
    const dsl = makeDsl('15m', [
      {
        lens: 'ohlcv',
        feature: 'ema',
        op: '>',
        value: 1.0,
        params: { period: 20 },
        timeframe: 'xxx',
      },
    ]);
    const needs = collectDslIndicatorNeeds(dsl);
    expect(needs).toHaveLength(0);
  });

  it('compareTarget の timeframe も継承して collect する', () => {
    const dsl = makeDsl('15m', [
      {
        lens: 'ohlcv',
        feature: 'close',
        op: '>',
        compareTarget: {
          lens: 'ohlcv',
          feature: 'ema',
          params: { period: 20 },
          timeframe: '1h',
        },
      },
    ]);
    const needs = collectDslIndicatorNeeds(dsl);
    // close は compareTarget なので left を collect しない (close は static feature)
    // ただし compareTarget の ema(period=20)@1h は collect される
    const keys = needs.map((n) => n.snapshotKey);
    expect(keys).toContain('ohlcv@1h.ema(period=20)');
  });

  it('主 timeframe + params なし rsi/atr は **collect しない** (= legacy 経路維持、PR ④F の例外)', () => {
    const dsl = makeDsl('15m', [
      { lens: 'ohlcv', feature: 'rsi', op: '<', value: 30 },
      { lens: 'ohlcv', feature: 'atr', op: '>', value: 0.001 },
    ]);
    const needs = collectDslIndicatorNeeds(dsl);
    expect(needs).toHaveLength(0);
  });

  it('上位足の rsi/atr (params なし) は **collect する** (= legacy 経路は主 timeframe のみ)', () => {
    const dsl = makeDsl('15m', [
      { lens: 'ohlcv', feature: 'rsi', op: '<', value: 30, timeframe: '1h' },
    ]);
    const needs = collectDslIndicatorNeeds(dsl);
    expect(needs).toHaveLength(1);
    expect(needs[0].snapshotKey).toBe('ohlcv@1h.rsi');
  });

  it('field alias は snapshotKey を保ちつつ analysis-engine 用 indicatorId / field に解決する', () => {
    const dsl = makeDsl('15m', [
      {
        lens: 'ohlcv',
        feature: 'macd_histogram',
        op: '>',
        value: 0,
        params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
      },
      {
        lens: 'ohlcv',
        feature: 'close',
        op: '>',
        compareTarget: {
          lens: 'ohlcv',
          feature: 'bb_upper',
          params: { period: 20 },
        },
      },
    ]);
    const needs = collectDslIndicatorNeeds(dsl);
    expect(needs.map((n) => n.snapshotKey).sort()).toEqual([
      'ohlcv.bb_upper(period=20)',
      'ohlcv.macd_histogram(fastPeriod=12,signalPeriod=9,slowPeriod=26)',
    ]);
    expect(needs.map((n) => `${n.feature}:${n.indicatorId}:${n.field}`).sort()).toEqual([
      'bb_upper:bb:upper',
      'macd_histogram:macd:histogram',
    ]);
  });
});

describe('collectDslPatternNeeds: MTF', () => {
  it('timeframe 未指定の pattern は主 timeframe で集める', () => {
    const dsl = makeDsl('15m', [
      { lens: 'pattern', feature: 'engulfing_bull', op: 'is_true' },
    ]);
    const needs = collectDslPatternNeeds(dsl);
    expect(needs.has('15m')).toBe(true);
    expect(needs.size).toBe(1);
  });

  it('主 + 上位足の pattern は両方の timeframe を集める', () => {
    const dsl = makeDsl('15m', [
      { lens: 'pattern', feature: 'engulfing_bull', op: 'is_true' },
      { lens: 'pattern', feature: 'pinbar_bull', op: 'is_true', timeframe: '1h' },
    ]);
    const needs = collectDslPatternNeeds(dsl);
    expect(Array.from(needs).sort()).toEqual(['15m', '1h']);
  });

  it('下位足指定は弾く', () => {
    const dsl = makeDsl('1h', [
      { lens: 'pattern', feature: 'engulfing_bull', op: 'is_true', timeframe: '15m' },
    ]);
    const needs = collectDslPatternNeeds(dsl);
    expect(needs.size).toBe(0);
  });

  it('pattern を持たない DSL は空集合', () => {
    const dsl = makeDsl('15m', [
      { lens: 'ohlcv', feature: 'rsi', op: '<', value: 30 },
    ]);
    const needs = collectDslPatternNeeds(dsl);
    expect(needs.size).toBe(0);
  });
});
