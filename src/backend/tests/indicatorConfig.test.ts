/**
 * インジケーター設定型 テスト
 * 
 * テスト対象:
 * - INDICATOR_METADATA の整合性
 * - バリデーション関数
 * - ヘルパー関数
 */

import {
  INDICATOR_METADATA,
  getIndicatorMetadata,
  getIndicatorsByCategory,
  createDefaultIndicatorSet,
  validateIndicatorConfig,
  IndicatorConfig,
  IndicatorId,
} from '../../models/indicatorConfig';

describe('IndicatorConfig', () => {
  describe('INDICATOR_METADATA', () => {
    it('20種類のインジケーターが定義されていること', () => {
      expect(INDICATOR_METADATA.length).toBe(20);
    });

    it('全てのインジケーターに必須フィールドがあること', () => {
      for (const meta of INDICATOR_METADATA) {
        expect(meta.id).toBeDefined();
        expect(meta.displayName).toBeDefined();
        expect(meta.category).toBeDefined();
        expect(meta.description).toBeDefined();
        expect(meta.defaultParams).toBeDefined();
        expect(meta.paramConstraints).toBeDefined();
      }
    });

    it('IDが重複していないこと', () => {
      const ids = INDICATOR_METADATA.map(m => m.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('各カテゴリにインジケーターが含まれること', () => {
      const categories = ['momentum', 'trend', 'volatility', 'volume'] as const;
      for (const category of categories) {
        const indicators = INDICATOR_METADATA.filter(m => m.category === category);
        expect(indicators.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getIndicatorMetadata', () => {
    it('存在するIDでメタデータを取得できること', () => {
      const meta = getIndicatorMetadata('rsi');
      expect(meta).toBeDefined();
      expect(meta?.displayName).toContain('RSI');
    });

    it('存在しないIDでundefinedを返すこと', () => {
      const meta = getIndicatorMetadata('nonexistent' as IndicatorId);
      expect(meta).toBeUndefined();
    });
  });

  describe('getIndicatorsByCategory', () => {
    it('momentum カテゴリのインジケーターを取得できること', () => {
      const indicators = getIndicatorsByCategory('momentum');
      expect(indicators.length).toBeGreaterThan(0);
      expect(indicators.every(i => i.category === 'momentum')).toBe(true);
    });

    it('trend カテゴリのインジケーターを取得できること', () => {
      const indicators = getIndicatorsByCategory('trend');
      expect(indicators.length).toBeGreaterThan(0);
      expect(indicators.every(i => i.category === 'trend')).toBe(true);
    });
  });

  describe('createDefaultIndicatorSet', () => {
    it('デフォルトセットを生成できること', () => {
      const set = createDefaultIndicatorSet();
      expect(set.name).toBe('デフォルト');
      expect(set.configs.length).toBeGreaterThan(0);
    });

    it('全ての設定が有効化されていること', () => {
      const set = createDefaultIndicatorSet();
      expect(set.configs.every(c => c.enabled)).toBe(true);
    });

    it('設定IDがユニークであること', () => {
      const set = createDefaultIndicatorSet();
      const ids = set.configs.map(c => c.configId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('validateIndicatorConfig', () => {
    it('正常な設定でエラーが空であること', () => {
      const config: IndicatorConfig = {
        configId: 'test-rsi',
        indicatorId: 'rsi',
        params: { period: 14 },
        enabled: true,
      };
      const errors = validateIndicatorConfig(config);
      expect(errors).toHaveLength(0);
    });

    it('期間が最小値未満でエラーになること', () => {
      const config: IndicatorConfig = {
        configId: 'test-rsi',
        indicatorId: 'rsi',
        params: { period: 1 }, // 最小値は2
        enabled: true,
      };
      const errors = validateIndicatorConfig(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('期間');
    });

    it('期間が最大値超過でエラーになること', () => {
      const config: IndicatorConfig = {
        configId: 'test-rsi',
        indicatorId: 'rsi',
        params: { period: 200 }, // 最大値は100
        enabled: true,
      };
      const errors = validateIndicatorConfig(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('期間');
    });

    it('不明なインジケーターIDでエラーになること', () => {
      const config: IndicatorConfig = {
        configId: 'test-unknown',
        indicatorId: 'unknown' as IndicatorId,
        params: {},
        enabled: true,
      };
      const errors = validateIndicatorConfig(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('不明なインジケーター');
    });

    // 注: BB/KCの標準偏差はindicatortsライブラリの制約により2固定のためテスト不要
  });
});
