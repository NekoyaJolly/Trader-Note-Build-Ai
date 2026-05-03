/**
 * modelFor() / resolveDefaultModel() の優先順位テスト
 * (AI_MODEL_OVERRIDE_ALL の挙動を中心に)
 *
 * 注意: `config` オブジェクトは module 評価時に env から固められるため、
 *   個別 AI_MODEL_<KEY> の動作は process.env を後から書き換えても反映されない。
 *   一方 AI_MODEL_OVERRIDE_ALL は readOverrideAll() で都度 process.env を見るため、
 *   ランタイム上書き / 復元のテストが書ける。
 *
 * 「未設定時に既定が config.ai.models.<key> と一致する」という形で検証することで、
 * 将来モデル ID を更新してもテストが落ちない (= 優先順位の意図そのものを検証する)。
 */

import { config, modelFor, resolveDefaultModel } from '../../config';

describe('modelFor() / resolveDefaultModel() - AI_MODEL_OVERRIDE_ALL', () => {
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
    expect(modelFor('strategist')).toBe(config.ai.models.strategist);
    expect(modelFor('mutation')).toBe(config.ai.models.mutation);
    expect(modelFor('ai_note')).toBe(config.ai.models.ai_note);
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
    expect(modelFor('strategist')).toBe(config.ai.models.strategist);
  });

  it('AI_MODEL_OVERRIDE_ALL が空白のみのときも override されない', () => {
    process.env.AI_MODEL_OVERRIDE_ALL = '   ';
    expect(modelFor('strategist')).toBe(config.ai.models.strategist);
  });

  it('AI_MODEL_OVERRIDE_ALL の前後空白は trim される (誤設定保護)', () => {
    process.env.AI_MODEL_OVERRIDE_ALL = '  gpt-4o-mini  ';
    expect(modelFor('strategist')).toBe('gpt-4o-mini');
  });

  it('resolveDefaultModel() も同じ override を読む (modelFor を経由しない AIProvider 用)', () => {
    process.env.AI_MODEL_OVERRIDE_ALL = 'gpt-4o-mini';
    expect(resolveDefaultModel()).toBe('gpt-4o-mini');

    delete process.env.AI_MODEL_OVERRIDE_ALL;
    expect(resolveDefaultModel()).toBe(config.ai.model);
  });
});
