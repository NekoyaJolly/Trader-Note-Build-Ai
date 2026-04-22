/**
 * Phase 6: ABTestRunner のユニットテスト
 *
 * - 複数バリアントの並行実行
 * - 勝者判定(1.15 倍ルール)
 * - 例外が 1 バリアントで起きても他は走る
 * - persist=false でも結果は返る
 */

import { ABTestRunner } from '../../prompts/abtest/ABTestRunner';
import type { VariantExecutor, ScoringFunction } from '../../prompts/abtest/types';
import { PromptRegistry } from '../../prompts/registry/PromptRegistry';

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
      findUnique: jest.fn(async ({ where }: any) => {
        const r = rows.find((x) => x.id === where.id);
        return r ? { ...r } : null;
      }),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    promptAbTestResult: {
      create: jest.fn(async ({ data }: { data: any }) => ({
        ...data,
        id: `ab-${id++}`,
        testedAt: new Date(),
      })),
    },
    $transaction: jest.fn(async (fn: any) => fn(fake)),
  };
  return { fake, rows };
}

describe('ABTestRunner', () => {
  it('複数バリアントを並行実行し、スコア最高を勝者判定する', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(fake as any);
    const v1 = await reg.register({
      agentName: 'trend_specialist',
      version: 'A',
      content: 'promptA',
      createdBy: 'human',
      status: 'active',
    });
    const v2 = await reg.register({
      agentName: 'trend_specialist',
      version: 'B',
      content: 'promptB',
      createdBy: 'mutation',
      status: 'experimental',
    });

    const executor: VariantExecutor<string, { q: number }> = async (prompt, input) => ({
      q: prompt === 'promptB' ? 1.0 : 0.5,
    });
    const scoreFn: ScoringFunction<string, { q: number }> = (_i, o) => o.q;

    const runner = new ABTestRunner(executor, scoreFn, {
      registry: reg,
      prisma: fake as any,
    });
    const res = await runner.runTest('trend_specialist', 'x', [v1.id, v2.id]);
    expect(res.variants.length).toBe(2);
    expect(res.winnerVersionId).toBe(v2.id); // 1.0 / 0.5 = 2 >= 1.15
    expect(res.winnerReason).toMatch(/ratio=2/);
  });

  it('有意差未満なら winnerVersionId 未設定', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(fake as any);
    const a = await reg.register({
      agentName: 'x',
      version: 'A',
      content: 'a',
      createdBy: 'human',
      status: 'active',
    });
    const b = await reg.register({
      agentName: 'x',
      version: 'B',
      content: 'b',
      createdBy: 'mutation',
      status: 'experimental',
    });
    const runner = new ABTestRunner(
      async () => ({ score: 1 }),
      (_i, o: any) => (o.score === 1 ? 0.5 : 0.45),
      { registry: reg, prisma: fake as any },
    );
    const res = await runner.runTest('x', 'any', [a.id, b.id]);
    expect(res.winnerVersionId).toBeUndefined();
    expect(res.winnerReason).toMatch(/有意差なし/);
  });

  it('1 バリアントが例外でも他は完走する', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(fake as any);
    const a = await reg.register({
      agentName: 'x',
      version: 'A',
      content: 'a',
      createdBy: 'human',
      status: 'active',
    });
    const b = await reg.register({
      agentName: 'x',
      version: 'B',
      content: 'b',
      createdBy: 'mutation',
      status: 'experimental',
    });
    const runner = new ABTestRunner<string, any>(
      async (prompt) => {
        if (prompt === 'b') throw new Error('boom');
        return 'ok';
      },
      (_i, o) => (o === 'ok' ? 0.8 : 0.3),
      { registry: reg, prisma: fake as any },
    );
    const res = await runner.runTest('x', 'input', [a.id, b.id]);
    const aRes = res.variants.find((v) => v.promptVersionId === a.id)!;
    const bRes = res.variants.find((v) => v.promptVersionId === b.id)!;
    expect(aRes.score).toBe(0.8);
    expect(aRes.error).toBeUndefined();
    expect(bRes.score).toBe(0);
    expect(bRes.error).toMatch(/boom/);
    expect(res.winnerVersionId).toBe(a.id);
  });

  it('agentName が一致しないバリアントは拒否', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(fake as any);
    const a = await reg.register({
      agentName: 'alpha',
      version: 'A',
      content: '.',
      createdBy: 'human',
      status: 'active',
    });
    const runner = new ABTestRunner(
      async () => ({}),
      () => 0,
      { registry: reg, prisma: fake as any },
    );
    await expect(runner.runTest('beta', 'x', [a.id])).rejects.toThrow(
      /belongs to agentName=alpha/,
    );
  });

  it('variantIds が空なら例外', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(fake as any);
    const runner = new ABTestRunner(
      async () => ({}),
      () => 0,
      { registry: reg, prisma: fake as any },
    );
    await expect(runner.runTest('x', 'i', [])).rejects.toThrow(/must not be empty/);
  });

  it('persist=false なら DB 書き込みなし', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(fake as any);
    const v = await reg.register({
      agentName: 'x',
      version: 'A',
      content: '.',
      createdBy: 'human',
      status: 'active',
    });
    const runner = new ABTestRunner(
      async () => ({}),
      () => 0.5,
      { registry: reg, prisma: fake as any, persist: false },
    );
    const res = await runner.runTest('x', 'i', [v.id]);
    expect(res.variants.length).toBe(1);
    expect(fake.promptAbTestResult.create).not.toHaveBeenCalled();
  });
});
