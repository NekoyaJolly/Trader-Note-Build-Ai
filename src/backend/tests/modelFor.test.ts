/**
 * modelFor() の優先順位テスト (AI_MODEL_OVERRIDE_ALL の挙動を中心に)
 *
 * 注意: `config` オブジェクトは module 評価時に env から固められるため、
 *   個別 AI_MODEL_<KEY> の動作は process.env を後から書き換えても反映されない。
 *   一方 AI_MODEL_OVERRIDE_ALL は modelFor() 内で都度 process.env を見るため、
 *   ランタイム上書き / 復元のテストが書ける。
 */

import { modelFor } from '../../config';

describe('modelFor() - AI_MODEL_OVERRIDE_ALL', () => {
  const originalOverride = process.env.AI_MODEL_OVERRIDE_ALL;

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env.AI_MODEL_OVERRIDE_ALL;
    } else {
      process.env.AI_MODEL_OVERRIDE_ALL = originalOverride;
    }
  });

  it('AI_MODEL_OVERRIDE_ALL が未設定なら config.ai.models[key] のハードコード既定値を返す', () => {
    delete process.env.AI_MODEL_OVERRIDE_ALL;
    // ハードコード既定 (config/index.ts) は anthropic/claude-opus-4.7
    expect(modelFor('strategist')).toMatch(/claude-opus-4\.7$/);
  });

  it('AI_MODEL_OVERRIDE_ALL が設定されると全 key で同じモデル ID を返す', () => {
    process.env.AI_MODEL_OVERRIDE_ALL = 'gpt-4o-mini';
    expect(modelFor('strategist')).toBe('gpt-4o-mini');
    expect(modelFor('mutation')).toBe('gpt-4o-mini');
    expect(modelFor('trend_specialist')).toBe('gpt-4o-mini');
    expect(modelFor('ai_note')).toBe('gpt-4o-mini');
    expect(modelFor('ai_summary')).toBe('gpt-4o-mini');
    expect(modelFor('decision_inference')).toBe('gpt-4o-mini');
  });

  it('AI_MODEL_OVERRIDE_ALL が空文字列のときは override されない', () => {
    process.env.AI_MODEL_OVERRIDE_ALL = '';
    expect(modelFor('strategist')).toMatch(/claude-opus-4\.7$/);
  });

  it('AI_MODEL_OVERRIDE_ALL が空白のみのときも override されない', () => {
    process.env.AI_MODEL_OVERRIDE_ALL = '   ';
    expect(modelFor('strategist')).toMatch(/claude-opus-4\.7$/);
  });
});
