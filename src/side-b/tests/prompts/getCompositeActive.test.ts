/**
 * Phase 6.7a: PromptRegistry.getCompositeActive のユニットテスト
 *
 * C案(グローバル+ローカル合成)の挙動を検証する。
 * in-memory fake Prisma を注入し、__global__ の有無・マクロ展開・例外経路を確認。
 */

import { PromptRegistry, GLOBAL_AGENT_NAME } from '../../prompts/registry/PromptRegistry';

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

function makeFakePrisma() {
  const rows: FakeRow[] = [];
  let seq = 0;
  const fake: any = {
    promptVersion: {
      create: jest.fn(async ({ data }: { data: Partial<FakeRow> }) => {
        seq++;
        const row: FakeRow = {
          id: `id-${seq}`,
          agentName: data.agentName!,
          version: data.version!,
          content: data.content!,
          parentVersionId: data.parentVersionId ?? null,
          createdBy: data.createdBy!,
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
      findFirst: jest.fn(async ({ where }: { where: { agentName: string; status: string } }) => {
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
    },
  };
  fake.$transaction = jest.fn(async (fn: any) => fn(fake));
  return { fake, rows };
}

describe('PromptRegistry.getCompositeActive', () => {
  it('global + agent の content を "\\n\\n" で連結して返す', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(fake as any);
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
    expect(out).toBe('# Global\n\n# Local Trend');
  });

  it('macros を両方の content に適用する', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(fake as any);
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
    const reg = new PromptRegistry(fake as any);
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
    const reg = new PromptRegistry(fake as any);
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
    const reg = new PromptRegistry(fake as any);
    await expect(reg.getCompositeActive(GLOBAL_AGENT_NAME)).rejects.toThrow(
      /通常エージェントとして取得できない/,
    );
  });
});
