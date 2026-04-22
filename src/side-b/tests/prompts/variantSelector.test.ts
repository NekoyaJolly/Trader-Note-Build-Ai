/**
 * Phase 6: variantSelector のユニットテスト
 *
 * 安全装置(実験プロンプト使用率 20%、即時中止判定)の挙動を検証する。
 */

import {
  selectVariant,
  shouldReject,
  EXPERIMENTAL_USAGE_RATIO,
  MIN_USAGE_FOR_REJECTION,
} from '../../prompts/registry/variantSelector';
import type { PromptVersion } from '../../prompts/registry/types';

function makePrompt(overrides: Partial<PromptVersion>): PromptVersion {
  return {
    id: 'id-' + Math.random().toString(36).slice(2, 8),
    agentName: 'test_agent',
    version: 'v1',
    content: '...',
    createdBy: 'human',
    status: 'active',
    usageCount: 0,
    successCount: 0,
    avgScore: 0.5,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('selectVariant', () => {
  it('experimental が空のときは常に active を返す', () => {
    const active = makePrompt({ status: 'active' });
    const res = selectVariant(active, [], () => 0.01);
    expect(res.selected.id).toBe(active.id);
    expect(res.isExperimental).toBe(false);
  });

  it('roll < 0.2 なら experimental、>= 0.2 なら active', () => {
    const active = makePrompt({ id: 'a', status: 'active' });
    const exp = makePrompt({ id: 'e', status: 'experimental' });

    // roll=0.1 は active 抽選範囲 <0.2、ただし selectVariant は2回 rand() を呼ぶ
    // 1回目で分岐判定、2回目は index 選択。rand をスタブする
    const seq = [0.1, 0.0];
    let i = 0;
    const rand = () => seq[i++] ?? 0;
    const res = selectVariant(active, [exp], rand);
    expect(res.selected.id).toBe('e');
    expect(res.isExperimental).toBe(true);

    const res2 = selectVariant(active, [exp], () => 0.99);
    expect(res2.selected.id).toBe('a');
    expect(res2.isExperimental).toBe(false);
  });

  it('閾値ちょうど 0.2 は active(境界条件)', () => {
    const active = makePrompt({ id: 'a' });
    const exp = makePrompt({ id: 'e', status: 'experimental' });
    const res = selectVariant(active, [exp], () => EXPERIMENTAL_USAGE_RATIO);
    expect(res.selected.id).toBe('a');
  });

  it('即時中止対象の experimental は viable から除外される', () => {
    const active = makePrompt({ avgScore: 0.8 });
    const exp = makePrompt({
      status: 'experimental',
      avgScore: 0.3, // 0.8 * 0.7 = 0.56 を下回る
      usageCount: MIN_USAGE_FOR_REJECTION + 1,
    });
    const res = selectVariant(active, [exp], () => 0.01);
    expect(res.selected.id).toBe(active.id);
    expect(res.isExperimental).toBe(false);
    expect(res.reason).toMatch(/rejection threshold/);
  });

  it('統計不足の experimental は viable に残る', () => {
    const active = makePrompt({ avgScore: 0.8 });
    const exp = makePrompt({
      status: 'experimental',
      avgScore: 0.1,
      usageCount: 3, // MIN_USAGE_FOR_REJECTION 未満
    });
    const seq = [0.1, 0];
    let i = 0;
    const res = selectVariant(active, [exp], () => seq[i++] ?? 0);
    expect(res.selected.id).toBe(exp.id);
    expect(res.isExperimental).toBe(true);
  });

  it('複数 viable experimental からは等確率で選ぶ', () => {
    const active = makePrompt({ id: 'a' });
    const e1 = makePrompt({ id: 'e1', status: 'experimental' });
    const e2 = makePrompt({ id: 'e2', status: 'experimental' });
    // 1回目: 0.1 (experimental 選択)、2回目: index 計算
    // floor(0.6 * 2) = 1 → e2
    const seq = [0.1, 0.6];
    let i = 0;
    const res = selectVariant(active, [e1, e2], () => seq[i++] ?? 0);
    expect(res.selected.id).toBe('e2');
  });
});

describe('shouldReject', () => {
  it('usage が閾値未満なら false', () => {
    const active = makePrompt({ avgScore: 0.8 });
    const exp = makePrompt({
      status: 'experimental',
      avgScore: 0.1,
      usageCount: MIN_USAGE_FOR_REJECTION - 1,
    });
    expect(shouldReject(exp, active)).toBe(false);
  });

  it('usage 充足 + avgScore が active * 0.7 未満なら true', () => {
    const active = makePrompt({ avgScore: 0.8 });
    const exp = makePrompt({
      status: 'experimental',
      avgScore: 0.5, // 0.8 * 0.7 = 0.56 未満
      usageCount: MIN_USAGE_FOR_REJECTION,
    });
    expect(shouldReject(exp, active)).toBe(true);
  });

  it('active の avgScore が 0 なら比較しないで false', () => {
    const active = makePrompt({ avgScore: 0 });
    const exp = makePrompt({
      status: 'experimental',
      avgScore: 0,
      usageCount: MIN_USAGE_FOR_REJECTION,
    });
    expect(shouldReject(exp, active)).toBe(false);
  });

  it('対象が experimental でなければ false', () => {
    const active = makePrompt({ avgScore: 0.8 });
    const notExp = makePrompt({
      status: 'deprecated',
      avgScore: 0.1,
      usageCount: MIN_USAGE_FOR_REJECTION,
    });
    expect(shouldReject(notExp, active)).toBe(false);
  });
});
