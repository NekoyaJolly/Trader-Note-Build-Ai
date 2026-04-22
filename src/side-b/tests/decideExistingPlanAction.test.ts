/**
 * Hotfix: aiOrchestrator.decideExistingPlanAction のユニットテスト
 *
 * 空プランキャッシュが 24 時間残り続けて createTradeFromPlan が失敗し続けた
 * 問題の根本修正。forceRefresh と scenarios.length の組み合わせで挙動を検証。
 */

import { decideExistingPlanAction } from '../orchestrator/aiOrchestrator';

describe('decideExistingPlanAction', () => {
  it('forceRefresh=true なら、scenarios の数に関わらず delete(forceRefresh)', () => {
    expect(decideExistingPlanAction({ scenarios: [] }, true)).toEqual({
      action: 'delete',
      reason: 'forceRefresh',
    });
    expect(decideExistingPlanAction({ scenarios: [{ id: 'a' }] }, true)).toEqual({
      action: 'delete',
      reason: 'forceRefresh',
    });
  });

  it('forceRefresh=false + scenarios=[] なら delete(empty-scenarios) - 本件の本丸', () => {
    expect(decideExistingPlanAction({ scenarios: [] }, false)).toEqual({
      action: 'delete',
      reason: 'empty-scenarios',
    });
  });

  it('forceRefresh=false + scenarios=undefined なら delete(empty-scenarios)', () => {
    expect(decideExistingPlanAction({ scenarios: undefined }, false)).toEqual({
      action: 'delete',
      reason: 'empty-scenarios',
    });
    expect(decideExistingPlanAction({}, false)).toEqual({
      action: 'delete',
      reason: 'empty-scenarios',
    });
  });

  it('forceRefresh=false + scenarios=Array 以外(数値等)なら delete(empty-scenarios)', () => {
    // 壊れたデータへの防御
    expect(
      decideExistingPlanAction({ scenarios: 'broken' as unknown } as any, false),
    ).toEqual({
      action: 'delete',
      reason: 'empty-scenarios',
    });
  });

  it('forceRefresh=false + scenarios.length >= 1 なら reuse(cache-hit)', () => {
    expect(
      decideExistingPlanAction({ scenarios: [{ id: 'a' }] }, false),
    ).toEqual({ action: 'reuse', reason: 'cache-hit' });
    expect(
      decideExistingPlanAction(
        { scenarios: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
        false,
      ),
    ).toEqual({ action: 'reuse', reason: 'cache-hit' });
  });

  it('null / undefined の existingPlan は empty-scenarios として delete(ただし呼び出し側は既存プランが無い時点で呼ばない想定)', () => {
    expect(decideExistingPlanAction(null, false)).toEqual({
      action: 'delete',
      reason: 'empty-scenarios',
    });
    expect(decideExistingPlanAction(undefined, false)).toEqual({
      action: 'delete',
      reason: 'empty-scenarios',
    });
  });
});
