/**
 * Phase 6.7a: PromptRegistry.getCompositeActive のユニットテスト
 *
 * C案(グローバル+ローカル合成)の挙動を検証する。
 * in-memory fake Prisma を注入し、__global__ の有無・マクロ展開・例外経路を確認。
 */

import type { PrismaClient } from '@prisma/client';
import type { PromptMacros } from '../../prompts/loader';
import { PromptRegistry, GLOBAL_AGENT_NAME } from '../../prompts/registry/PromptRegistry';
import { EVOLUTION_TARGETS_PROMPT_TEXT } from '../../evolution/evolutionTargets';

interface FakeRow {
  id: string;
  agentName: string;
  version: string;
  content: string;
  parentVersionId: string | null;
  createdBy: string;
  status: string;
  notes: string | null;
  usageCount: number;
  successCount: number;
  avgScore: number;
  lastUsedAt: Date | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CreateArgs {
  data: Partial<FakeRow> & {
    agentName: string;
    version: string;
    content: string;
    createdBy: string;
  };
}
interface FindFirstArgs { where: { agentName: string; status: string } }

interface FakePromptVersionDelegate {
  create: jest.Mock<Promise<FakeRow>, [CreateArgs]>;
  findFirst: jest.Mock<Promise<FakeRow | null>, [FindFirstArgs]>;
  findMany: jest.Mock<Promise<FakeRow[]>, []>;
  findUnique: jest.Mock<Promise<null>, []>;
  findUniqueOrThrow: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
}

interface FakePrismaStub {
  promptVersion: FakePromptVersionDelegate;
  $transaction: jest.Mock<Promise<unknown>, [(tx: FakePrismaStub) => Promise<unknown>]>;
}

function makeFakePrisma(): { fake: FakePrismaStub; rows: FakeRow[] } {
  const rows: FakeRow[] = [];
  let seq = 0;

  const promptVersion: FakePromptVersionDelegate = {
    create: jest.fn(async ({ data }: CreateArgs) => {
      seq++;
      const row: FakeRow = {
        id: `id-${seq}`,
        agentName: data.agentName,
        version: data.version,
        content: data.content,
        parentVersionId: data.parentVersionId ?? null,
        createdBy: data.createdBy,
        status: data.status ?? 'experimental',
        notes: data.notes ?? null,
        usageCount: 0,
        successCount: 0,
        avgScore: 0,
        lastUsedAt: null,
        approvedAt: null,
        approvedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.push(row);
      return { ...row };
    }),
    findFirst: jest.fn(async ({ where }: FindFirstArgs) => {
      const r = rows.find(
        (x) => x.agentName === where.agentName && x.status === where.status,
      );
      return r ? { ...r } : null;
    }),
    findMany: jest.fn(async () => rows.map((r) => ({ ...r }))),
    findUnique: jest.fn(async () => null),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };

  const fake: FakePrismaStub = {
    promptVersion,
    $transaction: jest.fn(async (fn) => fn(fake)),
  };
  return { fake, rows };
}

/**
 * 境界 cast: FakePrismaStub は PromptRegistry が使うメソッドを完全型付けしており、
 * unknown 経由の二重 cast は行わない。
 */
function asPrisma(stub: FakePrismaStub): PrismaClient {
  return stub as unknown as PrismaClient;
}

describe('PromptRegistry.getCompositeActive', () => {
  it('global + evolution targets + agent の content を連結して返す', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(asPrisma(fake));
    await reg.register({
      agentName: GLOBAL_AGENT_NAME,
      version: 'initial',
      content: '# Global',
      createdBy: 'human',
      status: 'active',
    });
    await reg.register({
      agentName: 'trend_specialist',
      version: 'initial',
      content: '# Local Trend',
      createdBy: 'human',
      status: 'active',
    });
    const out = await reg.getCompositeActive('trend_specialist');
    // 現在の実装: global + EVOLUTION_TARGETS_PROMPT_TEXT + local の3部構成
    expect(out).toContain('# Global');
    expect(out).toContain(EVOLUTION_TARGETS_PROMPT_TEXT);
    expect(out).toContain('# Local Trend');
    expect(out.indexOf('# Global')).toBeLessThan(out.indexOf(EVOLUTION_TARGETS_PROMPT_TEXT));
    expect(out.indexOf(EVOLUTION_TARGETS_PROMPT_TEXT)).toBeLessThan(out.indexOf('# Local Trend'));
  });

  it('macros を両方の content に適用する', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(asPrisma(fake));
    await reg.register({
      agentName: GLOBAL_AGENT_NAME,
      version: 'initial',
      content: 'GLOBAL: {{CORE_TRADING_RULES}}',
      createdBy: 'human',
      status: 'active',
    });
    await reg.register({
      agentName: 'strategy_thinker',
      version: 'initial',
      content: 'LOCAL: {{CORE_TRADING_RULES}}',
      createdBy: 'human',
      status: 'active',
    });
    const out = await reg.getCompositeActive('strategy_thinker', {
      CORE_TRADING_RULES: '- rule A',
    });
    expect(out).toContain('GLOBAL: - rule A');
    expect(out).toContain('LOCAL: - rule A');
    expect(out).not.toContain('{{CORE_TRADING_RULES}}');
  });

  it('__global__ が存在しない場合は agent 単独で返す(警告のみ、落ちない)', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(asPrisma(fake));
    await reg.register({
      agentName: 'trend_specialist',
      version: 'initial',
      content: '# Local',
      createdBy: 'human',
      status: 'active',
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await reg.getCompositeActive('trend_specialist');
    expect(out).toBe('# Local');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('__global__ active が存在しません'),
    );
    warnSpy.mockRestore();
  });

  it('指定 agent の active が存在しない場合は例外', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(asPrisma(fake));
    // __global__ だけあって他は無い状態
    await reg.register({
      agentName: GLOBAL_AGENT_NAME,
      version: 'initial',
      content: '# Global',
      createdBy: 'human',
      status: 'active',
    });
    await expect(reg.getCompositeActive('unknown_agent')).rejects.toThrow(
      /No active prompt for agent="unknown_agent"/,
    );
  });

  it('agentName に __global__ を直接渡すと例外(保守的ガード)', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(asPrisma(fake));
    await expect(reg.getCompositeActive(GLOBAL_AGENT_NAME)).rejects.toThrow(
      /通常エージェントとして取得できない/,
    );
  });

  it('composeGlobalWithContent は __global__ active と local 本文を合成する', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(asPrisma(fake));
    await reg.register({
      agentName: GLOBAL_AGENT_NAME,
      version: 'initial',
      content: 'G: {{K}}',
      createdBy: 'human',
      status: 'active',
    });
    const macros: PromptMacros = { K: 'v' };
    const out = await reg.composeGlobalWithContent('L: part', macros);
    expect(out).toContain('G: v');
    expect(out).toContain('L: part');
  });
});
