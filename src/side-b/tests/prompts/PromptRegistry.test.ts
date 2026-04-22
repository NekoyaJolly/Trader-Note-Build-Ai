/**
 * Phase 6: PromptRegistry のユニットテスト
 *
 * Prisma 本体ではなく、PromptRegistry が期待する最小インターフェースを
 * 満たす in-memory fake を注入してロジックを検証する。
 */

import { PromptRegistry } from '../../prompts/registry/PromptRegistry';
import type { PromptStatus } from '../../prompts/registry/types';

// PromptVersion テーブル行のフェイク表現(Prisma スキーマの部分集合)
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
  let id = 0;

  const promptVersion = {
    create: jest.fn(async ({ data }: { data: Partial<FakeRow> }) => {
      id++;
      const row: FakeRow = {
        id: `id-${id}`,
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
      const match = rows.find(
        (r) => r.agentName === where.agentName && r.status === where.status,
      );
      return match ? { ...match } : null;
    }),
    findMany: jest.fn(
      async ({ where, distinct, select }: { where?: any; distinct?: string[]; select?: any }) => {
        let results = [...rows];
        if (where) {
          if (where.agentName) results = results.filter((r) => r.agentName === where.agentName);
          if (where.status) {
            const s = where.status;
            if (typeof s === 'string') {
              results = results.filter((r) => r.status === s);
            } else if (s.in) {
              results = results.filter((r) => s.in.includes(r.status));
            }
          }
        }
        if (distinct && distinct.includes('agentName')) {
          const seen = new Set<string>();
          results = results.filter((r) =>
            seen.has(r.agentName) ? false : (seen.add(r.agentName), true),
          );
        }
        if (select) {
          return results.map((r) => {
            const o: any = {};
            for (const k of Object.keys(select)) o[k] = (r as any)[k];
            return o;
          });
        }
        return results.map((r) => ({ ...r }));
      },
    ),
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
      const m = rows.find((r) => r.id === where.id);
      return m ? { ...m } : null;
    }),
    findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
      const m = rows.find((r) => r.id === where.id);
      if (!m) throw new Error(`Not found: ${where.id}`);
      return { ...m };
    }),
    update: jest.fn(
      async ({ where, data }: { where: { id: string }; data: Partial<FakeRow> }) => {
        const i = rows.findIndex((r) => r.id === where.id);
        if (i === -1) throw new Error(`Not found: ${where.id}`);
        rows[i] = { ...rows[i]!, ...data, updatedAt: new Date() };
        return { ...rows[i]! };
      },
    ),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { agentName: string; status: string };
        data: Partial<FakeRow>;
      }) => {
        let count = 0;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i]!;
          if (r.agentName === where.agentName && r.status === where.status) {
            rows[i] = { ...r, ...data, updatedAt: new Date() };
            count++;
          }
        }
        return { count };
      },
    ),
  };

  const fake: any = {
    promptVersion,
  };
  fake.$transaction = jest.fn(async (fn: (tx: any) => Promise<any>) => fn(fake));
  return { fake, rows };
}

describe('PromptRegistry', () => {
  it('register で新規 experimental を追加できる', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(fake as any);
    const v = await reg.register({
      agentName: 'trend_specialist',
      version: '1.0.0',
      content: '...',
      createdBy: 'human',
    });
    expect(v.agentName).toBe('trend_specialist');
    expect(v.status).toBe('experimental');
    expect(v.avgScore).toBe(0);
  });

  it('getActive は status=active の最新を返す、なければ null', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(fake as any);
    await reg.register({
      agentName: 'x',
      version: '1',
      content: 'a',
      createdBy: 'human',
      status: 'active',
    });
    const act = await reg.getActive('x');
    expect(act?.status).toBe('active');
    expect(await reg.getActive('y')).toBeNull();
  });

  it('recordUsage で usageCount/successCount/avgScore が逐次更新される', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(fake as any);
    const v = await reg.register({
      agentName: 'x',
      version: '1',
      content: 'a',
      createdBy: 'human',
      status: 'active',
    });
    const r1 = await reg.recordUsage(v.id, { score: 0.6, success: true });
    expect(r1.usageCount).toBe(1);
    expect(r1.avgScore).toBeCloseTo(0.6);
    expect(r1.successCount).toBe(1);
    const r2 = await reg.recordUsage(v.id, { score: 0.4, success: false });
    expect(r2.usageCount).toBe(2);
    expect(r2.avgScore).toBeCloseTo(0.5);
    expect(r2.successCount).toBe(1);
  });

  it('promote は実行時に既存 active を deprecated にする', async () => {
    const { fake, rows } = makeFakePrisma();
    const reg = new PromptRegistry(fake as any);
    const oldActive = await reg.register({
      agentName: 'x',
      version: '1',
      content: 'a',
      createdBy: 'human',
      status: 'active',
    });
    const exp = await reg.register({
      agentName: 'x',
      version: '2',
      content: 'b',
      createdBy: 'mutation',
      status: 'experimental',
    });
    const promoted = await reg.promote(exp.id, { approvedBy: 'neko', notes: 'ok' });
    expect(promoted.status).toBe('active');
    expect(promoted.approvedBy).toBe('neko');

    const updatedOld = rows.find((r) => r.id === oldActive.id)!;
    expect(updatedOld.status).toBe('deprecated');
    // active は 1 件だけ
    expect(rows.filter((r) => r.agentName === 'x' && r.status === 'active').length).toBe(1);
  });

  it('promote は experimental 以外を拒否する', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(fake as any);
    const v = await reg.register({
      agentName: 'x',
      version: '1',
      content: 'a',
      createdBy: 'human',
      status: 'active',
    });
    await expect(reg.promote(v.id, { approvedBy: 'neko' })).rejects.toThrow(
      /only experimental/,
    );
  });

  it('registerNewAgent は既存 active があると例外', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(fake as any);
    await reg.register({
      agentName: 'new_agent',
      version: '1',
      content: 'x',
      createdBy: 'human',
      status: 'active',
    });
    await expect(
      reg.registerNewAgent('new_agent', {
        agentName: 'new_agent',
        version: '1.1',
        content: 'y',
        createdBy: 'meta_evolution',
      }),
    ).rejects.toThrow(/already has active/);
  });

  it('listAgents は distinct な agentName を返す', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(fake as any);
    await reg.register({
      agentName: 'a',
      version: '1',
      content: '.',
      createdBy: 'human',
      status: 'active',
    });
    await reg.register({
      agentName: 'b',
      version: '1',
      content: '.',
      createdBy: 'human',
      status: 'active',
    });
    await reg.register({
      agentName: 'a',
      version: '2',
      content: '.',
      createdBy: 'mutation',
      status: 'experimental',
    });
    const list = await reg.listAgents();
    expect(list.sort()).toEqual(['a', 'b']);
  });

  it('listActiveAndExperimental は 2 つのステータスを返す', async () => {
    const { fake } = makeFakePrisma();
    const reg = new PromptRegistry(fake as any);
    await reg.register({
      agentName: 'x',
      version: '1',
      content: '.',
      createdBy: 'human',
      status: 'active',
    });
    await reg.register({
      agentName: 'x',
      version: '2',
      content: '.',
      createdBy: 'mutation',
      status: 'experimental',
    });
    await reg.register({
      agentName: 'x',
      version: '0',
      content: '.',
      createdBy: 'human',
      status: 'deprecated' as PromptStatus,
    });
    const list = await reg.listActiveAndExperimental('x');
    const statuses = list.map((p) => p.status).sort();
    expect(statuses).toEqual(['active', 'experimental']);
  });
});
