/**
 * Phase 6: 月次プロンプト進化ジョブのユニットテスト
 *
 * - 昇格候補の判定(ratio >= 1.15)
 * - 成績不振の reject
 * - PromptMutationAgent モックからの新 experimental 登録
 */

import { runPromptEvolutionCycle } from '../../prompts/registry/promptEvolutionJob';
import { PromptRegistry } from '../../prompts/registry/PromptRegistry';
import type { PromptMutationAgent } from '../../agents/PromptMutationAgent';

function makeFakePrisma() {
  const rows: any[] = [];
  let id = 0;
  const fake: any = {
    promptVersion: {
      create: jest.fn(async ({ data }: { data: any }) => {
        id++;
        const row = {
          id: `v-${id}`,
          agentName: data.agentName,
          version: data.version,
          content: data.content,
          parentVersionId: data.parentVersionId ?? null,
          createdBy: data.createdBy,
          status: data.status ?? 'experimental',
          notes: data.notes ?? null,
          usageCount: data.usageCount ?? 0,
          successCount: data.successCount ?? 0,
          avgScore: data.avgScore ?? 0,
          lastUsedAt: null,
          approvedAt: null,
          approvedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        rows.push(row);
        return { ...row };
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        const r = rows.find((x) => x.agentName === where.agentName && x.status === where.status);
        return r ? { ...r } : null;
      }),
      findMany: jest.fn(async ({ where, distinct, select }: any) => {
        let out = [...rows];
        if (where?.agentName) out = out.filter((r) => r.agentName === where.agentName);
        if (where?.status) {
          if (typeof where.status === 'string') out = out.filter((r) => r.status === where.status);
          else if (where.status.in)
            out = out.filter((r) => where.status.in.includes(r.status));
        }
        if (distinct?.includes('agentName')) {
          const seen = new Set<string>();
          out = out.filter((r) => (seen.has(r.agentName) ? false : (seen.add(r.agentName), true)));
        }
        if (select) {
          return out.map((r) => ({ agentName: r.agentName }));
        }
        return out.map((r) => ({ ...r }));
      }),
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const r = rows.find((x) => x.id === where.id);
        if (!r) throw new Error('not found');
        return { ...r };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const i = rows.findIndex((r) => r.id === where.id);
        rows[i] = { ...rows[i], ...data, updatedAt: new Date() };
        return { ...rows[i] };
      }),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => fn(fake)),
  };
  return { fake, rows };
}

function mockMutationAgent(responses: Array<{ content: string; version: string; notes?: string }>): PromptMutationAgent {
  return {
    proposeImprovements: jest.fn(async () => responses.map((r) => ({ ...r }))),
  } as unknown as PromptMutationAgent;
}

describe('runPromptEvolutionCycle', () => {
  it('active がないエージェントはスキップされる', async () => {
    const { fake } = makeFakePrisma();
    const registry = new PromptRegistry(fake as any);
    // experimental のみ登録
    await registry.register({
      agentName: 'orphan',
      version: 'e1',
      content: 'x'.repeat(80),
      createdBy: 'mutation',
      status: 'experimental',
    });
    const res = await runPromptEvolutionCycle({
      registry,
      mutationAgent: mockMutationAgent([]),
    });
    const r = res.reports.find((x) => x.agentName === 'orphan');
    expect(r?.errors.length).toBeGreaterThan(0);
    expect(r?.newExperimentalIds.length).toBe(0);
  });

  it('成績上位の experimental は昇格候補としてレポートされる(自動昇格はしない)', async () => {
    const { fake, rows } = makeFakePrisma();
    const registry = new PromptRegistry(fake as any);
    const active = await registry.register({
      agentName: 'trend_specialist',
      version: 'A',
      content: 'a'.repeat(80),
      createdBy: 'human',
      status: 'active',
    });
    // active の avgScore を 0.5 にセット
    rows.find((r) => r.id === active.id)!.avgScore = 0.5;
    rows.find((r) => r.id === active.id)!.usageCount = 50;

    const exp = await registry.register({
      agentName: 'trend_specialist',
      version: 'E',
      content: 'e'.repeat(80),
      createdBy: 'mutation',
      status: 'experimental',
    });
    // experimental: avgScore 0.7 (= 0.5 * 1.4, 1.15 倍以上)
    rows.find((r) => r.id === exp.id)!.avgScore = 0.7;
    rows.find((r) => r.id === exp.id)!.usageCount = 30;

    const res = await runPromptEvolutionCycle({
      registry,
      mutationAgent: mockMutationAgent([
        { content: 'new prompt 1 '.repeat(10), version: 'mut-1' },
      ]),
      fetchRecentFailures: async () => [],
    });
    const r = res.reports.find((x) => x.agentName === 'trend_specialist')!;
    expect(r.promotionCandidates.length).toBe(1);
    expect(r.promotionCandidates[0]!.id).toBe(exp.id);
    // 自動昇格していないこと
    expect(rows.find((x) => x.id === exp.id)!.status).toBe('experimental');
  });

  it('成績不振の experimental は reject される', async () => {
    const { fake, rows } = makeFakePrisma();
    const registry = new PromptRegistry(fake as any);
    const active = await registry.register({
      agentName: 'hypothesis_generator',
      version: 'A',
      content: 'a',
      createdBy: 'human',
      status: 'active',
    });
    rows.find((r) => r.id === active.id)!.avgScore = 0.8;
    rows.find((r) => r.id === active.id)!.usageCount = 100;

    const bad = await registry.register({
      agentName: 'hypothesis_generator',
      version: 'E',
      content: 'e',
      createdBy: 'mutation',
      status: 'experimental',
    });
    rows.find((r) => r.id === bad.id)!.avgScore = 0.4; // 0.8 * 0.7 = 0.56 を下回る
    rows.find((r) => r.id === bad.id)!.usageCount = 25;

    const res = await runPromptEvolutionCycle({
      registry,
      mutationAgent: mockMutationAgent([]),
    });
    const r = res.reports.find((x) => x.agentName === 'hypothesis_generator')!;
    expect(r.rejectedIds).toContain(bad.id);
    expect(rows.find((x) => x.id === bad.id)!.status).toBe('rejected');
  });

  it('PromptMutationAgent の提案が experimental として登録される', async () => {
    const { fake, rows } = makeFakePrisma();
    const registry = new PromptRegistry(fake as any);
    await registry.register({
      agentName: 'oscillator_specialist',
      version: 'A',
      content: 'a',
      createdBy: 'human',
      status: 'active',
    });
    const ma = mockMutationAgent([
      { content: 'a'.repeat(80), version: 'm1' },
      { content: 'b'.repeat(80), version: 'm2' },
      { content: 'c'.repeat(80), version: 'm3' },
    ]);
    const res = await runPromptEvolutionCycle({
      registry,
      mutationAgent: ma,
      proposalsPerAgent: 3,
      makeVersion: (_a, i) => `mut-${i}`,
    });
    const r = res.reports.find((x) => x.agentName === 'oscillator_specialist')!;
    expect(r.newExperimentalIds.length).toBe(3);
    const exps = rows.filter(
      (x) => x.agentName === 'oscillator_specialist' && x.status === 'experimental',
    );
    expect(exps.length).toBe(3);
    expect(exps.map((e) => e.createdBy).every((c) => c === 'mutation')).toBe(true);
  });
});
