/**
 * novelty seed 生成のテスト (PR ⑤D-2 で全面再設計)。
 *
 * 旧 PR #114 の `getSeedDescriptor` / `seedStrategy` (= regime 別 RSI/ATR 単純 seed)
 * は撤廃され、PR ⑤D-2 で **6 カテゴリ × long/short = 12 種** の
 * `buildSeedDsl(kind, regime)` / `buildAllNoveltySeeds(regime)` に置き換えられた。
 * 本テストは新方式を pin する:
 *   1. 12 種すべて schema 通過 (= 機械判定可能な DSL)
 *   2. long seed と short seed の direction が正しく設定される
 *   3. 各 seed が意味のある条件を含む (= MTF / multi-instance / time_session 等)
 *   4. id は randomUUID で重複しない
 *   5. buildAllNoveltySeeds で 12 種を一括生成可能
 */

import {
  ALL_SEED_KINDS,
  buildAllNoveltySeeds,
  buildSeedDsl,
  type SeedKind,
} from '../../evolution/EvolutionLoop';
import { deriveHigherTimeframe } from '../../evolution/seedDescriptor';
import { StrategyDSLSchema } from '../../strategy_dsl/schema';

describe('PR ⑤D-2: 新 12 種の novelty seed', () => {
  describe('ALL_SEED_KINDS', () => {
    it('12 種の seed kind を含む', () => {
      expect(ALL_SEED_KINDS).toHaveLength(12);
    });

    it('6 カテゴリ × long/short の組合せが揃っている', () => {
      const sorted = [...ALL_SEED_KINDS].sort();
      expect(sorted).toEqual(
        [
          'anomaly_long',
          'anomaly_short',
          'mtf_long',
          'mtf_short',
          'multi_instance_long',
          'multi_instance_short',
          'oscillator_long',
          'oscillator_short',
          'range_long',
          'range_short',
          'trend_long',
          'trend_short',
        ].sort(),
      );
    });
  });

  describe('buildSeedDsl', () => {
    it('全 12 seed kind が StrategyDSLSchema を通る (= 機械判定可能な DSL)', () => {
      for (const kind of ALL_SEED_KINDS) {
        const seed = buildSeedDsl(kind, 'breakout');
        expect(() => StrategyDSLSchema.parse(seed)).not.toThrow();
      }
    });

    it('long seed と short seed の direction が正しく設定される', () => {
      const longKinds: SeedKind[] = [
        'mtf_long',
        'multi_instance_long',
        'trend_long',
        'oscillator_long',
        'anomaly_long',
        'range_long',
      ];
      const shortKinds: SeedKind[] = [
        'mtf_short',
        'multi_instance_short',
        'trend_short',
        'oscillator_short',
        'anomaly_short',
        'range_short',
      ];
      for (const k of longKinds) {
        const seed = buildSeedDsl(k, 'breakout');
        expect(
          'direction' in seed.entry ? seed.entry.direction : undefined,
        ).toBe('long');
      }
      for (const k of shortKinds) {
        const seed = buildSeedDsl(k, 'breakout');
        expect(
          'direction' in seed.entry ? seed.entry.direction : undefined,
        ).toBe('short');
      }
    });

    it('seed の id が `novelty-<kind>-<regime>-<uuid v4>` 形式で kind/regime を含む', () => {
      // PR #133 Copilot review #3: randomUUID 衝突の偶発 flake を避けるため
      // 「全 36 個が異なる」から「id の構造を pin」する形に変更。UUID v4 部分は
      // 正規表現で検証 (= 8-4-4-4-12 hex)。
      const uuidV4Re =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      for (const kind of ALL_SEED_KINDS) {
        for (let i = 0; i < 3; i++) {
          const id = buildSeedDsl(kind, 'breakout').id;
          // prefix が `novelty-<kind>-<regime>-` で始まる
          const prefix = `novelty-${kind}-breakout-`;
          expect(id.startsWith(prefix)).toBe(true);
          // 末尾は UUID v4 形式
          const uuidPart = id.slice(prefix.length);
          expect(uuidPart).toMatch(uuidV4Re);
        }
      }
    });

    it('regimeTarget は引数の値が入る', () => {
      const seed = buildSeedDsl('mtf_long', 'trending_with_pullback');
      expect(seed.regimeTarget).toBe('trending_with_pullback');
    });

    it('既定 symbol/timeframe は EURUSD/15m', () => {
      const seed = buildSeedDsl('range_long', 'consolidation');
      expect(seed.symbol).toBe('EURUSD');
      expect(seed.timeframe).toBe('15m');
    });

    it('symbol/timeframe を引数で上書き可能', () => {
      const seed = buildSeedDsl('range_long', 'breakout', 'GBPJPY', '1h');
      expect(seed.symbol).toBe('GBPJPY');
      expect(seed.timeframe).toBe('1h');
    });

    it('mtf_long seed には timeframe 1h の上位足条件が含まれる (= default entry 15m → higher 1h)', () => {
      const seed = buildSeedDsl('mtf_long', 'trending_with_pullback');
      const conditions =
        'trigger' in seed.entry ? seed.entry.trigger.conditions : [];
      // 上位足条件 (= timeframe='1h') が 1 つ以上含まれる
      const hasMtf = conditions.some(
        (c) => 'timeframe' in c && c.timeframe === '1h',
      );
      expect(hasMtf).toBe(true);
    });

    it('MTF seed の上位足は entry timeframe から derive される (Phase B 2026-05-22)', () => {
      // entry=1h → higher=4h
      const seed1h = buildSeedDsl('mtf_long', 'breakout', 'EURUSD', '1h');
      const conds1h =
        'trigger' in seed1h.entry ? seed1h.entry.trigger.conditions : [];
      expect(
        conds1h.some((c) => 'timeframe' in c && c.timeframe === '4h'),
      ).toBe(true);

      // entry=5m → higher=15m
      const seed5m = buildSeedDsl('mtf_short', 'breakout', 'EURUSD', '5m');
      const conds5m =
        'trigger' in seed5m.entry ? seed5m.entry.trigger.conditions : [];
      expect(
        conds5m.some((c) => 'timeframe' in c && c.timeframe === '15m'),
      ).toBe(true);

      // entry=4h → higher=1d
      const seed4h = buildSeedDsl('mtf_long', 'breakout', 'EURUSD', '4h');
      const conds4h =
        'trigger' in seed4h.entry ? seed4h.entry.trigger.conditions : [];
      expect(
        conds4h.some((c) => 'timeframe' in c && c.timeframe === '1d'),
      ).toBe(true);
    });

    it('非 MTF seed (range_long 等) は entry timeframe そのまま (上位足 derive されない)', () => {
      // range_long は MTF ではないため timeframe を伴う leaf 条件を持たない
      const seed = buildSeedDsl('range_long', 'breakout', 'EURUSD', '1h');
      expect(seed.timeframe).toBe('1h');
      const conditions =
        'trigger' in seed.entry ? seed.entry.trigger.conditions : [];
      // range_long の conditions は ATR + RSI のみで `timeframe` 指定なし (= entry 同足)
      const explicitTfs = conditions.filter((c) => 'timeframe' in c && c.timeframe);
      expect(explicitTfs).toHaveLength(0);
    });
  });

  describe('deriveHigherTimeframe (Phase B 2026-05-22)', () => {
    it('各 entry timeframe から次段階の上位足を返す', () => {
      expect(deriveHigherTimeframe('1m')).toBe('5m');
      expect(deriveHigherTimeframe('5m')).toBe('15m');
      expect(deriveHigherTimeframe('15m')).toBe('1h');
      expect(deriveHigherTimeframe('30m')).toBe('4h');
      expect(deriveHigherTimeframe('1h')).toBe('4h');
      expect(deriveHigherTimeframe('4h')).toBe('1d');
      expect(deriveHigherTimeframe('1d')).toBe('1w');
    });

    it('1w は自身を返す (= 最上位足)', () => {
      expect(deriveHigherTimeframe('1w')).toBe('1w');
    });

    it('未知の値は \'1h\' にフォールバック (= 過去デフォルト挙動)', () => {
      expect(deriveHigherTimeframe('2h')).toBe('1h');
      expect(deriveHigherTimeframe('')).toBe('1h');
      expect(deriveHigherTimeframe('multi')).toBe('1h');
    });

    it('multi_instance_long は EMA の異なる period が複数現れる', () => {
      const seed = buildSeedDsl('multi_instance_long', 'breakout');
      const conditions =
        'trigger' in seed.entry ? seed.entry.trigger.conditions : [];
      const periods = new Set<number>();
      for (const c of conditions) {
        if ('feature' in c && c.feature === 'ema' && c.params?.period) {
          periods.add(Number(c.params.period));
        }
        if (
          'compareTarget' in c &&
          c.compareTarget?.feature === 'ema' &&
          c.compareTarget.params?.period
        ) {
          periods.add(Number(c.compareTarget.params.period));
        }
      }
      expect(periods.has(7)).toBe(true);
      expect(periods.has(15)).toBe(true);
      expect(periods.has(60)).toBe(true);
    });

    it('anomaly_long は time_session.day_of_month を参照する', () => {
      const seed = buildSeedDsl('anomaly_long', 'breakout');
      const conditions =
        'trigger' in seed.entry ? seed.entry.trigger.conditions : [];
      const hasGotoubi = conditions.some(
        (c) =>
          'lens' in c &&
          c.lens === 'time_session' &&
          c.feature === 'day_of_month' &&
          c.op === 'in',
      );
      expect(hasGotoubi).toBe(true);
    });

    it('oscillator_long は indicator 2 種以上 (rsi + williamsR) を含む', () => {
      const seed = buildSeedDsl('oscillator_long', 'breakout');
      const conditions =
        'trigger' in seed.entry ? seed.entry.trigger.conditions : [];
      const features = new Set<string>();
      for (const c of conditions) {
        if ('feature' in c) features.add(c.feature);
      }
      expect(features.size).toBeGreaterThanOrEqual(2);
      expect(features.has('rsi')).toBe(true);
      expect(features.has('williamsR')).toBe(true);
    });

    it('全 12 seed の trigger に少なくとも 1 leaf 含まれる (= 空 trigger ではない)', () => {
      for (const kind of ALL_SEED_KINDS) {
        const seed = buildSeedDsl(kind, 'breakout');
        const conditions =
          'trigger' in seed.entry ? seed.entry.trigger.conditions : [];
        expect(conditions.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('buildAllNoveltySeeds', () => {
    it('12 個の seed を ALL_SEED_KINDS の順序で返す', () => {
      const seeds = buildAllNoveltySeeds('breakout');
      expect(seeds).toHaveLength(12);
      for (let i = 0; i < ALL_SEED_KINDS.length; i++) {
        const expectedKind = ALL_SEED_KINDS[i];
        // id の prefix に kind 名が含まれる (= novelty-<kind>-<regime>-<uuid>)
        expect(seeds[i].id).toContain(expectedKind);
      }
    });

    it('全 seed が schema 通過済 (= StrategyDSLSchema.parse 成功)', () => {
      const seeds = buildAllNoveltySeeds('breakout');
      for (const s of seeds) {
        expect(() => StrategyDSLSchema.parse(s)).not.toThrow();
      }
    });

    it('regimeTarget は全 seed で一致する', () => {
      const seeds = buildAllNoveltySeeds('reversal');
      for (const s of seeds) {
        expect(s.regimeTarget).toBe('reversal');
      }
    });
  });
});
