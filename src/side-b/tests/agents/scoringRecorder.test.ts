/**
 * Critical-3 残スコープ PR-2: scoringRecorder のユニットテスト。
 *
 * 8 エージェント側の配線は recordAgentUsage への 1 行呼び出しに集約しているため、
 * 本テストでは「ヘルパー単体の挙動」を確認することで全エージェントの記録経路を
 * 担保する(各エージェント test での重複検証を避ける)。
 */

import { recordAgentUsage } from '../../agents/scoringRecorder';
import type { PromptRegistry } from '../../prompts/registry/PromptRegistry';
import type { PromptVersion, RecordUsageInput } from '../../prompts/registry/types';

interface RecordUsageCall {
  versionId: string;
  input: RecordUsageInput;
}

function buildPromptVersion(overrides: Partial<PromptVersion> = {}): PromptVersion {
  const now = new Date();
  return {
    id: 'v-1',
    agentName: 'strategist',
    version: 'v1',
    content: 'system prompt',
    createdBy: 'human',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    avgScore: 0,
    usageCount: 0,
    successCount: 0,
    ...overrides,
  };
}

function makeMockRegistry(opts: {
  active?: PromptVersion | null;
  getActiveThrows?: Error;
  recordUsageThrows?: Error;
}): {
  registry: PromptRegistry;
  recordCalls: RecordUsageCall[];
  getActiveCalls: string[];
} {
  const recordCalls: RecordUsageCall[] = [];
  const getActiveCalls: string[] = [];
  const mock: Pick<PromptRegistry, 'getActive' | 'recordUsage'> = {
    getActive: (agentName: string) => {
      getActiveCalls.push(agentName);
      if (opts.getActiveThrows) return Promise.reject(opts.getActiveThrows);
      return Promise.resolve(opts.active ?? null);
    },
    recordUsage: (versionId: string, input: RecordUsageInput) => {
      recordCalls.push({ versionId, input });
      if (opts.recordUsageThrows) return Promise.reject(opts.recordUsageThrows);
      return Promise.resolve(buildPromptVersion({ id: versionId }));
    },
  };
  return {
    registry: mock as PromptRegistry,
    recordCalls,
    getActiveCalls,
  };
}

describe('recordAgentUsage', () => {
  it('active prompt が存在し output が満点出力なら score=1, success=true で記録する', async () => {
    const { registry, recordCalls, getActiveCalls } = makeMockRegistry({
      active: buildPromptVersion({ id: 'v-strategist' }),
    });

    await recordAgentUsage(
      'strategist',
      {},
      {
        verdict: 'rejected',
        baseCriteriaReasons: ['PF 不足'],
        interpretation: 'i'.repeat(80),
        actionableInsights: ['x', 'y'],
      },
      registry,
    );

    expect(getActiveCalls).toEqual(['strategist']);
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0].versionId).toBe('v-strategist');
    expect(recordCalls[0].input.score).toBeCloseTo(1, 5);
    expect(recordCalls[0].input.success).toBe(true);
  });

  it('output が null なら score=0, success=false で記録する(LLM 失敗の記録)', async () => {
    const { registry, recordCalls } = makeMockRegistry({
      active: buildPromptVersion(),
    });

    await recordAgentUsage('strategist', {}, null, registry);

    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0].input.score).toBe(0);
    expect(recordCalls[0].input.success).toBe(false);
  });

  it('active が存在しない場合は recordUsage を呼ばない(silent skip)', async () => {
    const { registry, recordCalls } = makeMockRegistry({ active: null });

    await recordAgentUsage('strategist', {}, { verdict: 'confirmed' }, registry);

    expect(recordCalls).toHaveLength(0);
  });

  it('getActive 失敗時は warn ログのみで本体は止めない', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { registry, recordCalls } = makeMockRegistry({
      getActiveThrows: new Error('DB connection failed'),
    });

    await expect(
      recordAgentUsage('strategist', {}, { verdict: 'confirmed' }, registry),
    ).resolves.toBeUndefined();
    expect(recordCalls).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('strategist: getActive 失敗'),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it('recordUsage 失敗時は warn ログのみで本体は止めない', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { registry } = makeMockRegistry({
      active: buildPromptVersion({ id: 'v-1' }),
      recordUsageThrows: new Error('DB write failed'),
    });

    await expect(
      recordAgentUsage('strategist', {}, { verdict: 'confirmed' }, registry),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('strategist: recordUsage 失敗'),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it('scoring 関数未登録のエージェントでも output 有なら score=1 で記録する(後方互換)', async () => {
    const { registry, recordCalls } = makeMockRegistry({
      active: buildPromptVersion({ id: 'v-unknown', agentName: 'unknown_agent' }),
    });

    await recordAgentUsage('unknown_agent', {}, { foo: 'bar' }, registry);

    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0].input.score).toBe(1);
    expect(recordCalls[0].input.success).toBe(true);
  });

  it('mutation/crossover の scoringInput { count } が反映される', async () => {
    const { registry, recordCalls } = makeMockRegistry({
      active: buildPromptVersion({ id: 'v-mut', agentName: 'mutation' }),
    });

    // count=4 要求に対し 2 件のみ → mutationScoreFn は countScore=0.5 + fields=1 → 0.75
    await recordAgentUsage(
      'mutation',
      { count: 4 },
      [
        { id: 'm1', generation: 1, parentIds: ['p1'] },
        { id: 'm2', generation: 1, parentIds: ['p1'] },
      ],
      registry,
    );

    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0].input.score).toBeCloseTo(0.75, 5);
    expect(recordCalls[0].input.success).toBe(true);
  });

  it('scoring 結果が低い (score < 0.3) なら success=false', async () => {
    const { registry, recordCalls } = makeMockRegistry({
      active: buildPromptVersion({ id: 'v-hg', agentName: 'hypothesis_generator' }),
    });

    // 空 output → hypothesisGeneratorScoreFn は 0 を返す。success=false。
    await recordAgentUsage('hypothesis_generator', {}, {}, registry);

    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0].input.score).toBe(0);
    expect(recordCalls[0].input.success).toBe(false);
  });
});
