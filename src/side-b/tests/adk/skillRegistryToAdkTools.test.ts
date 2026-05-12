/**
 * skillRegistryToAdkTools 単体テスト (Step 1 Ticket T6)
 *
 * SkillRegistry → FunctionTool[] アダプターの検証。
 *
 * 設計書: /src/side-b/adk/adapters/README.md §2 §4 §6 §8
 *
 * テスト経路 (Nekoさん T2.5 承認): ADK `FunctionTool.runAsync()` public API のみ使用。
 * `execute` (private) には触らない。
 *
 * 検証項目 (KICKOFF §T6 6 パターン):
 * 1. 空の SkillRegistry → 空配列
 * 2. 1 件の Skill → 1 件の FunctionTool
 * 3. FunctionTool の name / description が元 Skill と一致
 * 4. runAsync 経由実行で registry.invoke と等価な結果
 * 5. Skill 内エラー → SkillResult(ok=false) として **return** (throw しない)
 * 6. ADK 自動 Zod validation → 不正引数で reject される
 */

import { z } from 'zod';
import { SkillRegistry } from '../../skills/registry';
import type { Skill, SkillContext, SkillResult } from '../../skills/types';
import { skillRegistryToAdkTools } from '../../adk/adapters/skillRegistryToAdkTools';
import { createMinimalAdkContext } from '../../adk/adapters/_testHelpers';
import {
  ADK_DEFAULT_CALLER_REASON,
  ADK_DEFAULT_CALLER_AGENT,
} from '../../adk/adapters/skillContext';

// ============================================================================
// テスト用 Skill 群 (実 Skill とは独立、振る舞いのみ検証)
// ============================================================================

const echoInputSchema = z.object({
  message: z.string(),
  count: z.number().int().optional(),
});
type EchoInput = z.infer<typeof echoInputSchema>;
type EchoOutput = { echoed: string; meta: { callerAgent?: string; callerReason?: string } };

const makeEchoSkill = (): Skill<EchoInput, EchoOutput> => ({
  name: 'echo',
  description: 'テスト用: メッセージをそのまま返し、ctx 情報をメタとして付ける',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: '返却対象の文字列' },
      count: { type: 'integer', description: '繰り返し回数 (省略時 1)' },
    },
    required: ['message'],
  },
  execute: (input: EchoInput, ctx: SkillContext): Promise<EchoOutput> => {
    const parsed = echoInputSchema.parse(input);
    const n = parsed.count ?? 1;
    return Promise.resolve({
      echoed: parsed.message.repeat(n),
      meta: { callerAgent: ctx.callerAgent, callerReason: ctx.callerReason },
    });
  },
});

type FailingOutput = never;
const makeFailingSkill = (): Skill<{ reason: string }, FailingOutput> => ({
  name: 'failing_skill',
  description: 'テスト用: 必ず Error を throw する',
  inputSchema: {
    type: 'object',
    properties: { reason: { type: 'string' } },
    required: ['reason'],
  },
  execute: (input: { reason: string }): Promise<FailingOutput> => {
    return Promise.reject(new Error(`failing: ${input.reason}`));
  },
});

// ============================================================================
// 1. 空の SkillRegistry → 空配列
// ============================================================================

describe('skillRegistryToAdkTools: 基本変換', () => {
  it('空の SkillRegistry → 空配列', () => {
    const registry = new SkillRegistry();
    const tools = skillRegistryToAdkTools(registry);
    expect(tools).toEqual([]);
  });

  it('1 件の Skill → 1 件の FunctionTool', () => {
    const registry = new SkillRegistry();
    registry.register(makeEchoSkill());
    const tools = skillRegistryToAdkTools(registry);
    expect(tools).toHaveLength(1);
  });

  it('複数の Skill → 同数の FunctionTool', () => {
    const registry = new SkillRegistry();
    registry.register(makeEchoSkill());
    registry.register(makeFailingSkill());
    const tools = skillRegistryToAdkTools(registry);
    expect(tools).toHaveLength(2);
  });
});

// ============================================================================
// 2. name / description / parameters 整合
// ============================================================================

describe('skillRegistryToAdkTools: name/description 整合', () => {
  it('FunctionTool.name は元 Skill.name と一致', () => {
    const registry = new SkillRegistry();
    registry.register(makeEchoSkill());
    const [tool] = skillRegistryToAdkTools(registry);
    expect(tool?.name).toBe('echo');
  });
});

// ============================================================================
// 3. runAsync 経由実行で SkillResult を return
// ============================================================================

describe('skillRegistryToAdkTools: runAsync 経由実行', () => {
  it('正常系: runAsync の戻り値が registry.invoke と等価', async () => {
    const registry = new SkillRegistry();
    registry.register(makeEchoSkill());
    const [tool] = skillRegistryToAdkTools(registry);
    if (!tool) throw new Error('tool not created');

    const ctx = createMinimalAdkContext({ agentName: 'discovery' });
    const adkResult = (await tool.runAsync({
      args: { message: 'hi', count: 3 },
      toolContext: ctx,
    })) as SkillResult<EchoOutput>;

    expect(adkResult.ok).toBe(true);
    if (adkResult.ok) {
      expect(adkResult.data.echoed).toBe('hihihi');
      // callerAgent は ADK Context.agentName、callerReason は ADK_DEFAULT_CALLER_REASON
      expect(adkResult.data.meta.callerAgent).toBe('discovery');
      expect(adkResult.data.meta.callerReason).toBe(ADK_DEFAULT_CALLER_REASON);
    }
  });

  it('callerAgent フォールバック: agentName 空 → ADK_DEFAULT_CALLER_AGENT', async () => {
    const registry = new SkillRegistry();
    registry.register(makeEchoSkill());
    const [tool] = skillRegistryToAdkTools(registry);
    if (!tool) throw new Error('tool not created');

    const ctx = createMinimalAdkContext({ agentName: '' });
    const adkResult = (await tool.runAsync({
      args: { message: 'x' },
      toolContext: ctx,
    })) as SkillResult<EchoOutput>;

    expect(adkResult.ok).toBe(true);
    if (adkResult.ok) {
      expect(adkResult.data.meta.callerAgent).toBe(ADK_DEFAULT_CALLER_AGENT);
    }
  });

  it('Skill 内 throw → SkillResult(ok=false) として return (throw しない)', async () => {
    const registry = new SkillRegistry();
    registry.register(makeFailingSkill());
    const [tool] = skillRegistryToAdkTools(registry);
    if (!tool) throw new Error('tool not created');

    const ctx = createMinimalAdkContext({ agentName: 'a' });

    // ADK runAsync は throw しない (adapter が SkillResult を return するため)
    let thrown: unknown = null;
    let returned: SkillResult<never> | null = null;
    try {
      returned = (await tool.runAsync({
        args: { reason: 'boom' },
        toolContext: ctx,
      })) as SkillResult<never>;
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeNull();
    expect(returned).not.toBeNull();
    if (returned) {
      expect(returned.ok).toBe(false);
      if (!returned.ok) {
        expect(returned.error.message).toContain('failing: boom');
      }
    }
  });
});

// ============================================================================
// 4. ADK 自動 Zod validation (parameters 経由)
// ============================================================================

describe('skillRegistryToAdkTools: ADK 自動 Zod validation', () => {
  it('不正引数 (required 欠落) → ADK runAsync が wrap して throw', async () => {
    const registry = new SkillRegistry();
    registry.register(makeEchoSkill());
    const [tool] = skillRegistryToAdkTools(registry);
    if (!tool) throw new Error('tool not created');

    const ctx = createMinimalAdkContext({ agentName: 'a' });

    // ADK の自動 Zod validation は parse 失敗時に throw する (function_tool.js 実装)
    // adapter 側ではなく ADK 側で wrap される (= Error: "Error in tool 'echo': ...")
    await expect(
      tool.runAsync({
        args: { count: 5 }, // message 欠落
        toolContext: ctx,
      }),
    ).rejects.toThrow(/echo/);
  });

  it('不正引数 (型不一致) → ADK runAsync が throw', async () => {
    const registry = new SkillRegistry();
    registry.register(makeEchoSkill());
    const [tool] = skillRegistryToAdkTools(registry);
    if (!tool) throw new Error('tool not created');

    const ctx = createMinimalAdkContext({ agentName: 'a' });
    await expect(
      tool.runAsync({
        args: { message: 123 }, // message が number
        toolContext: ctx,
      }),
    ).rejects.toThrow(/echo/);
  });
});
