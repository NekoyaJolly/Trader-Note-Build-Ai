/**
 * skillContext 単体テスト (Step 1 Ticket T5)
 *
 * ADK Context → 既存 SkillContext マッピングの検証。
 *
 * 設計書: /src/side-b/adk/adapters/README.md §3
 *
 * 合格条件 (Nekoさん T2.5 承認):
 * - `Context.agentName` から `callerAgent` を抽出できる
 * - `callerReason` は adapter 側定数 `ADK_DEFAULT_CALLER_REASON` 固定
 * - `timestamp` は呼び出し時刻 (Date インスタンス)
 * - `Context` が undefined の場合のフォールバック動作
 * - 既存 `SkillContext` 型を満たす (型レベルで検証)
 * - any/unknown 違反ゼロ
 */

import {
  toSkillContext,
  ADK_DEFAULT_CALLER_REASON,
  ADK_DEFAULT_CALLER_AGENT,
} from '../../adk/adapters/skillContext';
import { createMinimalAdkContext } from '../../adk/adapters/_testHelpers';
import type { SkillContext } from '../../skills/types';

// ============================================================================
// 正常系: Context.agentName からの抽出
// ============================================================================

describe('toSkillContext: 正常系', () => {
  it('Context.agentName を callerAgent にマッピング', () => {
    const ctx = createMinimalAdkContext({ agentName: 'discovery' });
    const result = toSkillContext(ctx);
    expect(result.callerAgent).toBe('discovery');
  });

  it('callerReason は adapter 定数 (ADK_DEFAULT_CALLER_REASON)', () => {
    const ctx = createMinimalAdkContext({ agentName: 'strategist' });
    const result = toSkillContext(ctx);
    expect(result.callerReason).toBe(ADK_DEFAULT_CALLER_REASON);
    expect(result.callerReason).toBe('invoked-via-adk-runner');
  });

  it('timestamp は Date インスタンス (現在時刻)', () => {
    const before = Date.now();
    const ctx = createMinimalAdkContext({ agentName: 'a' });
    const result = toSkillContext(ctx);
    const after = Date.now();

    expect(result.timestamp).toBeInstanceOf(Date);
    expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.timestamp.getTime()).toBeLessThanOrEqual(after);
  });

  it('出力は既存 SkillContext 型を満たす (型レベル)', () => {
    const ctx = createMinimalAdkContext({ agentName: 'x' });
    const result: SkillContext = toSkillContext(ctx);
    // 型互換性の確認 (compile-time)
    expect(result).toBeDefined();
  });
});

// ============================================================================
// フォールバック: Context undefined / agentName 空文字
// ============================================================================

describe('toSkillContext: フォールバック', () => {
  it('Context が undefined → callerAgent はフォールバック値', () => {
    const result = toSkillContext(undefined);
    expect(result.callerAgent).toBe(ADK_DEFAULT_CALLER_AGENT);
    expect(result.callerAgent).toBe('adk-runner');
  });

  it('Context が undefined → callerReason / timestamp は通常通り', () => {
    const result = toSkillContext(undefined);
    expect(result.callerReason).toBe(ADK_DEFAULT_CALLER_REASON);
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it('agentName が空文字 → フォールバック値を使う', () => {
    const ctx = createMinimalAdkContext({ agentName: '' });
    const result = toSkillContext(ctx);
    expect(result.callerAgent).toBe(ADK_DEFAULT_CALLER_AGENT);
  });
});

// ============================================================================
// 不可侵性: 既存 SkillContext 型を改変していない
// ============================================================================

describe('toSkillContext: 既存型との互換性', () => {
  it('SkillContext のフィールドのみ持つ (余計なフィールドなし)', () => {
    const ctx = createMinimalAdkContext({ agentName: 'a' });
    const result = toSkillContext(ctx);

    const keys = Object.keys(result).sort();
    expect(keys).toEqual(['callerAgent', 'callerReason', 'timestamp']);
  });
});
