/**
 * ModuleParent Registry の単体テスト (Filter Evolution M4)。
 *
 * - registry 整合性 (= 全 entry が type 契約を満たす)
 * - 各カテゴリに最低 1 件
 * - selectModuleParents の round-robin / regime フィルタリング / count 制御
 * - immutability (= Object.freeze で readonly)
 *
 * 設計書: `docs/design/phase_filter_evolution_specification.md` §4
 */

import {
  MODULE_PARENT_REGISTRY,
  getAllModuleParents,
  getModuleParentsByCategory,
  selectModuleParents,
  type ModuleParentCategory,
} from '../../evolution/moduleParentRegistry';

describe('MODULE_PARENT_REGISTRY 整合性', () => {
  it('registry が空でない (= 最低 5 件)', () => {
    expect(MODULE_PARENT_REGISTRY.length).toBeGreaterThanOrEqual(5);
  });

  it('id が一意', () => {
    const ids = new Set(MODULE_PARENT_REGISTRY.map((m) => m.id));
    expect(ids.size).toBe(MODULE_PARENT_REGISTRY.length);
  });

  it('5 カテゴリ全てに最低 1 件 (= MTF / TimeSession / Pattern / MarketStructure / Volatility)', () => {
    const categories: ModuleParentCategory[] = [
      'mtf',
      'time_session',
      'pattern',
      'market_structure',
      'volatility',
    ];
    for (const c of categories) {
      const found = MODULE_PARENT_REGISTRY.filter((m) => m.category === c);
      expect(found.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('全 entry が必須フィールドを持つ', () => {
    for (const m of MODULE_PARENT_REGISTRY) {
      expect(m.id).toBeTruthy();
      expect(m.category).toBeTruthy();
      expect(m.description).toBeTruthy();
      expect(m.lensName).toBeTruthy();
      expect(m.featureKey).toBeTruthy();
      expect(m.typicalOps.length).toBeGreaterThan(0);
    }
  });

  it('registry が immutable (= Object.freeze 適用済)', () => {
    expect(Object.isFrozen(MODULE_PARENT_REGISTRY)).toBe(true);
  });
});

describe('selectModuleParents', () => {
  it('count=0 なら空配列を返す', () => {
    const out = selectModuleParents({ regime: 'breakout', count: 0 });
    expect(out).toEqual([]);
  });

  it('count=3 で 3 件返す', () => {
    const out = selectModuleParents({ regime: 'breakout', count: 3 });
    expect(out).toHaveLength(3);
  });

  it('regime=breakout で recommendedRegimes が breakout を含む / 未指定の entry のみ返る', () => {
    const out = selectModuleParents({ regime: 'breakout', count: 10 });
    for (const m of out) {
      if (m.recommendedRegimes && m.recommendedRegimes.length > 0) {
        expect(m.recommendedRegimes).toContain('breakout');
      }
    }
  });

  it('regime=reversal で reversal 専用の pattern entry が含まれる', () => {
    const out = selectModuleParents({ regime: 'reversal', count: 10 });
    const patternIds = out.filter((m) => m.category === 'pattern').map((m) => m.id);
    expect(patternIds).toContain('pattern-bullish-confirm-for-long');
  });

  it('count > 候補数 でも例外を投げず round-robin で返す', () => {
    const out = selectModuleParents({ regime: 'breakout', count: 100 });
    expect(out).toHaveLength(100);
    // 重複を許容する (= round-robin の意図通り)
    const uniqueIds = new Set(out.map((m) => m.id));
    expect(uniqueIds.size).toBeGreaterThan(0);
    expect(uniqueIds.size).toBeLessThanOrEqual(MODULE_PARENT_REGISTRY.length);
  });

  it('rotationOffset で先頭位置を変えられる (= 決定論)', () => {
    const a = selectModuleParents({ regime: 'breakout', count: 1, rotationOffset: 0 });
    const b = selectModuleParents({ regime: 'breakout', count: 1, rotationOffset: 1 });
    expect(a[0].id).not.toBe(b[0].id);
  });

  it('未知 regime (= recommendedRegimes に該当 entry なし) でも全 registry にフォールバック', () => {
    const out = selectModuleParents({ regime: 'unknown_regime_xyz', count: 5 });
    expect(out.length).toBe(5);
    // recommendedRegimes 未指定 entry は通る
  });

  it('同じ入力で常に同じ結果 (= 決定論性 pin)', () => {
    const a = selectModuleParents({ regime: 'breakout', count: 3 });
    const b = selectModuleParents({ regime: 'breakout', count: 3 });
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
  });
});

describe('getAllModuleParents / getModuleParentsByCategory', () => {
  it('getAllModuleParents は registry をそのまま返す', () => {
    expect(getAllModuleParents()).toBe(MODULE_PARENT_REGISTRY);
  });

  it('getModuleParentsByCategory("mtf") で MTF カテゴリだけ返す', () => {
    const out = getModuleParentsByCategory('mtf');
    expect(out.length).toBeGreaterThan(0);
    for (const m of out) {
      expect(m.category).toBe('mtf');
    }
  });

  it('getModuleParentsByCategory("time_session") で 2 件以上返す (= overlap + friday close 等)', () => {
    const out = getModuleParentsByCategory('time_session');
    expect(out.length).toBeGreaterThanOrEqual(2);
  });
});
