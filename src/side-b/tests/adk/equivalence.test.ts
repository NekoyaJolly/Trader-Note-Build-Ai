/**
 * 等価性検証テスト (Step 1 Ticket T7)
 *
 * ADK 経由 (新) と SkillRegistry 直接 invoke (既存) で、同一入力に対して
 * 同一出力 (deep equal) が返ることを保証する。
 *
 * 設計書: /src/side-b/adk/adapters/README.md §6.5 等価性検証
 *
 * テスト対象範囲 (KICKOFF §T7 の判断記録):
 * - 本テストでは **モック Skill 4 件** を SkillRegistry に登録し検証する。
 *   理由: 実 Skill (queryEdgeLedger / runFullValidation 等) は内部で Prisma / 外部 API
 *   に依存しており、CI でのユニット実行に DB 環境が必要。等価性の本質は「adapter が
 *   registry.invoke の結果を素通しで返す」「ADK Context → SkillContext マッピングが
 *   正しい」の 2 点で、これはモック Skill で完全に検証できる。
 * - 実 Skill の inputSchema → Zod 変換は T3 (jsonSchemaToZod.test.ts) で全 8 件
 *   実機検証済み。
 *
 * テスト経路 (Nekoさん T2.5 承認):
 * - ADK 経路: `FunctionTool.runAsync()` (public method)
 * - 直接経路: `SkillRegistry.invoke()` (既存 API)
 * - `FunctionTool.execute` (private) には触らない
 *
 * 比較戦略:
 * - Skill 出力に `timestamp` を含めない (ADK 経路は new Date() を内部生成するため
 *   deep equal が壊れる。本質的に検証したいのは出力構造の同一性)
 * - 直接 invoke 時の SkillContext を ADK 経路と同条件で構築 (callerAgent / callerReason)
 */

import { SkillRegistry } from '../../skills/registry';
import type { Skill, SkillContext, SkillResult } from '../../skills/types';
import { skillRegistryToAdkTools } from '../../adk/adapters/skillRegistryToAdkTools';
import { createMinimalAdkContext } from '../../adk/adapters/_testHelpers';
import { ADK_DEFAULT_CALLER_REASON } from '../../adk/adapters/skillContext';

// ============================================================================
// モック Skill 群 (4 件)
// ============================================================================

type CtxEcho = { callerAgent?: string; callerReason?: string };

/** Skill 1: 文字列を大文字化して返す (正常系 / 単純型) */
const makeUpperSkill = (): Skill<{ text: string }, { upper: string; ctx: CtxEcho }> => ({
  name: 'mock_upper',
  description: '入力文字列を大文字化',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  execute: (input: { text: string }, ctx: SkillContext): Promise<{ upper: string; ctx: CtxEcho }> => {
    return Promise.resolve({
      upper: input.text.toUpperCase(),
      ctx: { callerAgent: ctx.callerAgent, callerReason: ctx.callerReason },
    });
  },
});

/** Skill 2: 数値配列を合計 (配列入力 / 型バリエーション) */
const makeSumSkill = (): Skill<{ values: number[] }, { sum: number; count: number }> => ({
  name: 'mock_sum',
  description: '数値配列の合計',
  inputSchema: {
    type: 'object',
    properties: {
      values: { type: 'array', items: { type: 'number' } },
    },
    required: ['values'],
  },
  execute: (input: { values: number[] }): Promise<{ sum: number; count: number }> => {
    const sum = input.values.reduce((acc, v) => acc + v, 0);
    return Promise.resolve({ sum, count: input.values.length });
  },
});

/** Skill 3: optional プロパティ / enum (実 Skill 構造に近い) */
type StatusFilterInput = { status?: 'unverified' | 'confirmed' };
type StatusFilterOutput = { matched: number };
const makeFilterSkill = (): Skill<StatusFilterInput, StatusFilterOutput> => ({
  name: 'mock_filter',
  description: 'enum + optional の動作確認',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['unverified', 'confirmed'],
      },
    },
  },
  execute: (input: StatusFilterInput): Promise<StatusFilterOutput> => {
    return Promise.resolve({ matched: input.status === 'confirmed' ? 5 : 0 });
  },
});

/** Skill 4: 必ず throw する (エラー伝播の等価性確認) */
const makeBoomSkill = (): Skill<{ msg: string }, never> => ({
  name: 'mock_boom',
  description: '必ず Error を throw する',
  inputSchema: {
    type: 'object',
    properties: { msg: { type: 'string' } },
    required: ['msg'],
  },
  execute: (input: { msg: string }): Promise<never> => {
    return Promise.reject(new Error(`boom: ${input.msg}`));
  },
});

// ============================================================================
// 等価性検証ヘルパー
// ============================================================================

const CALLER_AGENT = 'test-agent';

/** 同一条件の SkillContext を構築 (ADK 経路と一致する callerAgent / callerReason) */
function buildEquivalentContext(): Pick<SkillContext, 'callerAgent' | 'callerReason'> {
  return { callerAgent: CALLER_AGENT, callerReason: ADK_DEFAULT_CALLER_REASON };
}

/**
 * 単一 Skill の等価性を検証する共通ロジック。
 *
 * @param skillName 対象 Skill 名
 * @param input 入力 (両経路に同じものを渡す)
 * @param registry テスト用 SkillRegistry (Skill 登録済み)
 */
async function assertEquivalent(
  skillName: string,
  input: Record<string, unknown>,
  registry: SkillRegistry,
): Promise<void> {
  // 直接経路
  const directResult: SkillResult = await registry.invoke(skillName, input, buildEquivalentContext());

  // ADK 経路
  const tools = skillRegistryToAdkTools(registry);
  const tool = tools.find((t) => t.name === skillName);
  if (!tool) throw new Error(`tool not found: ${skillName}`);

  const adkCtx = createMinimalAdkContext({ agentName: CALLER_AGENT });
  const adkResult = (await tool.runAsync({
    args: input,
    toolContext: adkCtx,
  })) as SkillResult;

  expect(adkResult).toEqual(directResult);
}

// ============================================================================
// テスト本体
// ============================================================================

describe('equivalence: ADK runAsync vs SkillRegistry.invoke', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
    registry.registerAll([
      makeUpperSkill(),
      makeSumSkill(),
      makeFilterSkill(),
      makeBoomSkill(),
    ]);
  });

  it('正常系 / 文字列入出力 → 両経路で deep equal', async () => {
    await assertEquivalent('mock_upper', { text: 'hello' }, registry);
  });

  it('正常系 / 配列入力 → 両経路で deep equal', async () => {
    await assertEquivalent('mock_sum', { values: [1, 2, 3, 4] }, registry);
  });

  it('正常系 / enum + optional (値あり) → 両経路で deep equal', async () => {
    await assertEquivalent('mock_filter', { status: 'confirmed' }, registry);
  });

  it('正常系 / enum + optional (値なし) → 両経路で deep equal', async () => {
    await assertEquivalent('mock_filter', {}, registry);
  });

  it('Skill 内 throw → 両経路で SkillResult(ok=false) として deep equal', async () => {
    // 直接経路と ADK 経路で error.code / message が一致することを確認。
    // SkillRegistry.invoke は throw を { ok: false, error: {...details: <元 Error>} } に
    // wrap する。adapter は invoke の戻り値をそのまま return するため等価。
    // ただし error.details は Error インスタンス → deep equal で型情報が異なる可能性が
    // あるため、ここは要約フィールドのみで比較する。
    const input = { msg: 'kaboom' };
    const ctx = buildEquivalentContext();

    const directResult: SkillResult = await registry.invoke('mock_boom', input, ctx);

    const tools = skillRegistryToAdkTools(registry);
    const tool = tools.find((t) => t.name === 'mock_boom');
    if (!tool) throw new Error('tool not found');
    const adkResult = (await tool.runAsync({
      args: input,
      toolContext: createMinimalAdkContext({ agentName: CALLER_AGENT }),
    })) as SkillResult;

    expect(adkResult.ok).toBe(false);
    expect(directResult.ok).toBe(false);
    if (!adkResult.ok && !directResult.ok) {
      expect(adkResult.error.code).toEqual(directResult.error.code);
      expect(adkResult.error.message).toEqual(directResult.error.message);
    }
  });

  it('SKILL_NOT_FOUND は ADK 経路では発生しない (FunctionTool 生成時点で名前固定)', async () => {
    // 直接経路: 未登録名 → SKILL_NOT_FOUND
    const directResult: SkillResult = await registry.invoke('does_not_exist', {}, buildEquivalentContext());
    expect(directResult.ok).toBe(false);
    if (!directResult.ok) {
      expect(directResult.error.code).toBe('SKILL_NOT_FOUND');
    }

    // ADK 経路: skillRegistryToAdkTools は登録済み Skill だけを変換するため、
    // 「未登録名で呼び出す」シナリオが存在しない (= 構造的に SKILL_NOT_FOUND は発生不可能)。
    // これは等価性の例外ではなく、ADK 経路がより安全な設計であることを示す。
    const tools = skillRegistryToAdkTools(registry);
    expect(tools.find((t) => t.name === 'does_not_exist')).toBeUndefined();
  });

  it('全モック Skill 4 件すべてが両経路で実行可能', () => {
    const tools = skillRegistryToAdkTools(registry);
    expect(tools).toHaveLength(4);
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['mock_boom', 'mock_filter', 'mock_sum', 'mock_upper'],
    );
  });
});
