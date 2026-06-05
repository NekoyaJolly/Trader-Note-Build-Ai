/**
 * EODHD read-only リサーチスキル 6 種 (P3) のユニットテスト。
 *
 * fetch 関数は DI で偽物に差し替え、入力 Zod 検証・呼び出し委譲・fundamentals の
 * poka-yoke (非対応シンボル拒否)・registry 登録を非ネットワークで検証する。
 */
import { describe, it, expect, jest } from '@jest/globals';
import {
  createFetchEodhdNewsSkill,
  createFetchEodhdMacroIndicatorSkill,
  createFetchEodhdFundamentalsSkill,
  type EodhdResearchSkillsDeps,
} from '../../skills/research/eodhdResearchSkills';
import { buildDefaultSkillRegistry } from '../../skills';
import type { SkillContext } from '../../skills/types';

const CTX: SkillContext = { timestamp: new Date('2026-06-05T00:00:00Z') };

describe('fetch_eodhd_news', () => {
  it('symbol 必須・limit 上限を Zod 検証し、fetch に parse 済み入力を渡す', async () => {
    const fetchNews = jest.fn<NonNullable<EodhdResearchSkillsDeps['fetchNews']>>().mockResolvedValue([]);
    const skill = createFetchEodhdNewsSkill({ fetchNews });
    await skill.execute({ symbol: 'AAPL.US', limit: 5 }, CTX);
    expect(fetchNews).toHaveBeenCalledWith({ symbol: 'AAPL.US', limit: 5 });
  });

  it('symbol 欠落は Zod エラーで弾く', async () => {
    const fetchNews = jest.fn<NonNullable<EodhdResearchSkillsDeps['fetchNews']>>().mockResolvedValue([]);
    const skill = createFetchEodhdNewsSkill({ fetchNews });
    await expect(skill.execute({ limit: 5 } as never, CTX)).rejects.toThrow();
    expect(fetchNews).not.toHaveBeenCalled();
  });

  it('limit 上限超過 (>100) は弾く', async () => {
    const fetchNews = jest.fn<NonNullable<EodhdResearchSkillsDeps['fetchNews']>>().mockResolvedValue([]);
    const skill = createFetchEodhdNewsSkill({ fetchNews });
    await expect(skill.execute({ symbol: 'AAPL.US', limit: 101 }, CTX)).rejects.toThrow();
  });
});

describe('fetch_eodhd_macro_indicator', () => {
  it('country 必須', async () => {
    const fetchMacroIndicator = jest
      .fn<NonNullable<EodhdResearchSkillsDeps['fetchMacroIndicator']>>()
      .mockResolvedValue([]);
    const skill = createFetchEodhdMacroIndicatorSkill({ fetchMacroIndicator });
    await expect(skill.execute({ indicator: 'gdp_current_usd' } as never, CTX)).rejects.toThrow();
    await skill.execute({ country: 'US', indicator: 'gdp_current_usd' }, CTX);
    expect(fetchMacroIndicator).toHaveBeenCalledWith({ country: 'US', indicator: 'gdp_current_usd' });
  });
});

describe('fetch_eodhd_fundamentals (poka-yoke)', () => {
  it('US/ETF/INDX 以外のシンボルは fetch を呼ばずエラー', async () => {
    const fetchFundamentals = jest
      .fn<NonNullable<EodhdResearchSkillsDeps['fetchFundamentals']>>()
      .mockResolvedValue(null);
    const skill = createFetchEodhdFundamentalsSkill({ fetchFundamentals });
    // FX は非対応 → 叩かずにエラー
    await expect(skill.execute({ symbol: 'EURUSD.FOREX' }, CTX)).rejects.toThrow(/非対応|US/);
    expect(fetchFundamentals).not.toHaveBeenCalled();
  });

  it('.US シンボルは fetch を呼ぶ', async () => {
    const fetchFundamentals = jest
      .fn<NonNullable<EodhdResearchSkillsDeps['fetchFundamentals']>>()
      .mockResolvedValue(null);
    const skill = createFetchEodhdFundamentalsSkill({ fetchFundamentals });
    await skill.execute({ symbol: 'AAPL.US' }, CTX);
    expect(fetchFundamentals).toHaveBeenCalledWith({ symbol: 'AAPL.US' });
  });
});

describe('buildDefaultSkillRegistry: EODHD 6 種が登録される', () => {
  it('6 つの read-only リサーチスキルが has() で見つかる', () => {
    const registry = buildDefaultSkillRegistry();
    for (const name of [
      'fetch_eodhd_news',
      'fetch_eodhd_sentiments',
      'fetch_eodhd_economic_events',
      'fetch_eodhd_macro_indicator',
      'fetch_eodhd_earnings',
      'fetch_eodhd_fundamentals',
    ]) {
      expect(registry.has(name)).toBe(true);
    }
  });
});
