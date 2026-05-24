/**
 * TopLevelOrchestrator 単体テスト (Phase B+、2026-05-24)
 *
 * 設計書: docs/architecture/TOP_LEVEL_ORCHESTRATOR_DESIGN.md
 *
 * 検証範囲:
 *   - 禁止事項 7 ルールの個別動作 (= topLevelOrchestratorRules)
 *   - dispatchAction の正しい Job 呼び出し
 *   - LLM 出力 parse + Zod 検証
 *   - strictBlocked 経路の no-op
 *   - run_all の budget clamp
 */

import {
  evaluateInputRules,
  checkConsecutiveFatalErrors,
  checkLlmTokenBudget,
  checkRateLimit,
  checkEdgeHypothesisCapacity,
  checkManualJobRunning,
  type RuleEvaluationInput,
} from '../../orchestrator/topLevelOrchestratorRules';
import {
  TopLevelOrchestrator,
  TopLevelOrchestratorOutputSchema,
  type TopLevelOrchestratorJobInvokers,
} from '../../orchestrator/topLevelOrchestrator';

// ==========================================
// Rules テスト (純粋関数、I/O なし)
// ==========================================

describe('topLevelOrchestratorRules', () => {
  describe('#1 checkConsecutiveFatalErrors', () => {
    it('3 件未満は blocked=false', () => {
      const runs = [
        { finishedAt: new Date(), status: 'failed' as const, isFatal: true },
        { finishedAt: new Date(), status: 'failed' as const, isFatal: true },
      ];
      expect(checkConsecutiveFatalErrors(runs).blocked).toBe(false);
    });

    it('直近 3 件すべて fatal なら blocked=true', () => {
      const runs = [
        { finishedAt: new Date(), status: 'failed' as const, isFatal: true },
        { finishedAt: new Date(), status: 'failed' as const, isFatal: true },
        { finishedAt: new Date(), status: 'failed' as const, isFatal: true },
      ];
      const result = checkConsecutiveFatalErrors(runs);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('連続 3');
    });

    it('直近 3 件のうち 1 件でも非 fatal なら blocked=false', () => {
      const runs = [
        { finishedAt: new Date(), status: 'failed' as const, isFatal: true },
        { finishedAt: new Date(), status: 'completed' as const, isFatal: false },
        { finishedAt: new Date(), status: 'failed' as const, isFatal: true },
      ];
      expect(checkConsecutiveFatalErrors(runs).blocked).toBe(false);
    });
  });

  describe('#2 checkLlmTokenBudget', () => {
    it('100k 以下は blocked=false', () => {
      expect(checkLlmTokenBudget(50_000).blocked).toBe(false);
      expect(checkLlmTokenBudget(99_999).blocked).toBe(false);
      expect(checkLlmTokenBudget(100_000).blocked).toBe(false);
    });

    it('100k 超は blocked=true', () => {
      const result = checkLlmTokenBudget(100_001);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('100000');
    });
  });

  describe('#3 checkRateLimit', () => {
    it('limit 未満は blocked=false', () => {
      const now = new Date('2026-05-24T12:00:00Z');
      const halfHourAgo = new Date('2026-05-24T11:30:00Z');
      const runs = [
        { finishedAt: halfHourAgo, status: 'completed' as const, isFatal: false },
        { finishedAt: halfHourAgo, status: 'completed' as const, isFatal: false },
      ];
      // limit=3 で 2 件 → OK
      expect(checkRateLimit(runs, now, 3).blocked).toBe(false);
    });

    it('limit 以上は blocked=true', () => {
      const now = new Date('2026-05-24T12:00:00Z');
      const t = new Date('2026-05-24T11:30:00Z');
      const runs = Array.from({ length: 3 }, () => ({
        finishedAt: t,
        status: 'completed' as const,
        isFatal: false,
      }));
      // limit=3 で 3 件 → blocked
      const result = checkRateLimit(runs, now, 3);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('3 >= 3');
    });

    it('1h 以上前の run は count しない', () => {
      const now = new Date('2026-05-24T12:00:00Z');
      const twoHoursAgo = new Date('2026-05-24T10:00:00Z');
      const runs = Array.from({ length: 5 }, () => ({
        finishedAt: twoHoursAgo,
        status: 'completed' as const,
        isFatal: false,
      }));
      // 5 件あっても 1h 以上前なので blocked=false
      expect(checkRateLimit(runs, now, 3).blocked).toBe(false);
    });
  });

  describe('#4 checkEdgeHypothesisCapacity', () => {
    it('合計 1000 以下は blocked=false', () => {
      expect(
        checkEdgeHypothesisCapacity({ unverified: 500, screening_passed: 500 }).blocked,
      ).toBe(false);
    });

    it('合計 1000 超は blocked=true', () => {
      const result = checkEdgeHypothesisCapacity({
        unverified: 600,
        screening_passed: 401,
      });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('1001');
    });
  });

  describe('#6 checkManualJobRunning', () => {
    it('running 無しなら blocked=false', () => {
      const runs = [
        { finishedAt: new Date(), status: 'completed' as const, isFatal: false },
      ];
      expect(checkManualJobRunning(runs).blocked).toBe(false);
    });

    it('running ありなら blocked=true', () => {
      const runs = [
        { finishedAt: null, status: 'running' as const, isFatal: false },
      ];
      const result = checkManualJobRunning(runs);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('running');
    });
  });

  describe('evaluateInputRules (統合)', () => {
    const baseInput: RuleEvaluationInput = {
      recentAgentRuns: [],
      edgeLedgerByStatus: { unverified: 10, screening_passed: 5 },
      now: new Date('2026-05-24T12:00:00Z'),
    };

    it('問題なしなら strictBlocked=false / blockedActions 空', () => {
      const result = evaluateInputRules(baseInput, 3);
      expect(result.strictBlocked).toBe(false);
      expect(result.blockedActions.size).toBe(0);
    });

    it('連続 3 fatal → strictBlocked', () => {
      const input = {
        ...baseInput,
        recentAgentRuns: Array.from({ length: 3 }, () => ({
          finishedAt: new Date(),
          status: 'failed' as const,
          isFatal: true,
        })),
      };
      const result = evaluateInputRules(input, 3);
      expect(result.strictBlocked).toBe(true);
      expect(result.strictBlockedReason).toContain('連続 3');
    });

    it('running あり → strictBlocked (= #1 より優先順位は #1 先だが、#1 該当しない時)', () => {
      const input = {
        ...baseInput,
        recentAgentRuns: [
          { finishedAt: null, status: 'running' as const, isFatal: false },
        ],
      };
      const result = evaluateInputRules(input, 3);
      expect(result.strictBlocked).toBe(true);
      expect(result.strictBlockedReason).toContain('running');
    });

    it('EdgeHypothesis 1000 超 → blockedActions に create_hypothesis 追加 (strictBlocked=false)', () => {
      const input = {
        ...baseInput,
        edgeLedgerByStatus: { unverified: 1500 },
      };
      const result = evaluateInputRules(input, 3);
      expect(result.strictBlocked).toBe(false);
      expect(result.blockedActions.has('create_hypothesis')).toBe(true);
      expect(result.blockedReasons['create_hypothesis']).toContain('1500');
    });
  });
});

// ==========================================
// Zod schema テスト
// ==========================================

describe('TopLevelOrchestratorOutputSchema', () => {
  it('valid な 5 action はすべて通る (PR #248 Copilot review #8 修正: run_all 含む)', () => {
    const actions = [
      'create_hypothesis',
      'advance_validation',
      'run_evolution',
      'run_all',
      'wait',
    ];
    for (const action of actions) {
      const result = TopLevelOrchestratorOutputSchema.safeParse({
        action,
        reasoning: 'test',
      });
      expect(result.success).toBe(true);
    }
  });

  it('run_all は runAllBudget なしでも通る (= optional、PR #248 review #9 整合)', () => {
    const result = TopLevelOrchestratorOutputSchema.safeParse({
      action: 'run_all',
      reasoning: 'test',
    });
    expect(result.success).toBe(true);
  });

  it('runAllBudget の値域 (maxParallel 1-5) を強制 (= 未使用フィールド削除済、PR #248 review #6)', () => {
    const result = TopLevelOrchestratorOutputSchema.safeParse({
      action: 'run_all',
      reasoning: 'test',
      runAllBudget: { maxParallel: 10 },
    });
    expect(result.success).toBe(false);
  });

  it('未知 action は reject', () => {
    const result = TopLevelOrchestratorOutputSchema.safeParse({
      action: 'unknown',
      reasoning: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('reasoning が空文字なら reject', () => {
    const result = TopLevelOrchestratorOutputSchema.safeParse({
      action: 'wait',
      reasoning: '',
    });
    expect(result.success).toBe(false);
  });
});

// ==========================================
// dispatchAction テスト (= job dispatch ロジック)
// ==========================================

describe('TopLevelOrchestrator.dispatchAction (= LLM mock で action 別 dispatch を pin)', () => {
  function makeInvokerMocks(): TopLevelOrchestratorJobInvokers & {
    counts: Record<string, number>;
  } {
    const counts = { plan: 0, screening: 0, fullValidation: 0, evolution: 0 };
    return {
      counts,
      runPlanGeneration: async () => {
        counts.plan++;
      },
      runScreening: async () => {
        counts.screening++;
      },
      runFullValidation: async () => {
        counts.fullValidation++;
      },
      runEvolution: async () => {
        counts.evolution++;
      },
    };
  }

  function makePrismaMock(): unknown {
    // 最低限のスタブ (= decideAndExecute 内部の prisma 呼び出しを全て 0/空で返す)。
    // Phase 2 (2026-05-24): AgentRun の create/update + AgentRunStep の create/findMany を追加。
    const groupBy = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const findFirst = jest.fn().mockResolvedValue(null);
    const findMany = jest.fn().mockResolvedValue([]);
    // AgentRun.create は dummy run record を返す (= id だけ使われる)
    const agentRunCreate = jest.fn().mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000001',
      status: 'pending',
      startedAt: new Date(),
    });
    const agentRunUpdate = jest.fn().mockResolvedValue({});
    const agentRunStepCreate = jest.fn().mockResolvedValue({});
    const agentRunStepFindMany = jest.fn().mockResolvedValue([]);
    return {
      edgeHypothesis: { groupBy, count },
      evolutionBacktestRun: { count, findFirst },
      agentRun: { findMany, create: agentRunCreate, update: agentRunUpdate },
      agentRunStep: { create: agentRunStepCreate, findMany: agentRunStepFindMany },
    };
  }

  function makeAiProviderMock(action: string, reasoning: string = 'mock'): unknown {
    const body = JSON.stringify({ action, reasoning });
    return {
      chat: jest.fn().mockResolvedValue({ content: body, usage: { totalTokens: 100 } }),
    };
  }

  it('action=wait は no-op (= どの Job も呼ばれない)', async () => {
    const invokers = makeInvokerMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orchestrator = new TopLevelOrchestrator({
      prisma: makePrismaMock() as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aiProvider: makeAiProviderMock('wait') as any,
      jobInvokers: invokers,
      promptRegistry: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getCompositeActive: async () => 'system prompt' as never,
      } as any,
    });
    const result = await orchestrator.decideAndExecute('test');
    expect(result.output?.action).toBe('wait');
    expect(result.executedJobs).toEqual([]);
    expect(invokers.counts).toEqual({ plan: 0, screening: 0, fullValidation: 0, evolution: 0 });
  });

  it('action=create_hypothesis → runPlanGeneration が呼ばれる', async () => {
    const invokers = makeInvokerMocks();
    const orchestrator = new TopLevelOrchestrator({
      prisma: makePrismaMock() as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aiProvider: makeAiProviderMock('create_hypothesis') as any,
      jobInvokers: invokers,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      promptRegistry: { getCompositeActive: async () => 'sys' } as any,
    });
    const result = await orchestrator.decideAndExecute('test');
    expect(result.output?.action).toBe('create_hypothesis');
    expect(invokers.counts.plan).toBe(1);
    expect(result.executedJobs).toEqual(['planGeneration']);
  });

  it('action=advance_validation → screening + fullValidation の両方が呼ばれる', async () => {
    const invokers = makeInvokerMocks();
    const orchestrator = new TopLevelOrchestrator({
      prisma: makePrismaMock() as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aiProvider: makeAiProviderMock('advance_validation') as any,
      jobInvokers: invokers,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      promptRegistry: { getCompositeActive: async () => 'sys' } as any,
    });
    const result = await orchestrator.decideAndExecute('test');
    expect(invokers.counts.screening).toBe(1);
    expect(invokers.counts.fullValidation).toBe(1);
    expect(result.executedJobs).toEqual(['screening', 'fullValidation']);
  });

  it('action=run_evolution → evolution のみ呼ばれる', async () => {
    const invokers = makeInvokerMocks();
    const orchestrator = new TopLevelOrchestrator({
      prisma: makePrismaMock() as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aiProvider: makeAiProviderMock('run_evolution') as any,
      jobInvokers: invokers,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      promptRegistry: { getCompositeActive: async () => 'sys' } as any,
    });
    const result = await orchestrator.decideAndExecute('test');
    expect(invokers.counts.evolution).toBe(1);
    expect(result.executedJobs).toEqual(['evolution']);
  });

  it('action=run_all → 3 種類が並列で呼ばれる (= plan + screening + evolution)', async () => {
    const invokers = makeInvokerMocks();
    const aiProvider = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          action: 'run_all',
          reasoning: 'parallel',
          runAllBudget: { maxParallel: 3 },
        }),
        usage: { totalTokens: 100 },
      }),
    };
    const orchestrator = new TopLevelOrchestrator({
      prisma: makePrismaMock() as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aiProvider: aiProvider as any,
      jobInvokers: invokers,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      promptRegistry: { getCompositeActive: async () => 'sys' } as any,
    });
    const result = await orchestrator.decideAndExecute('test');
    expect(invokers.counts.plan).toBe(1);
    expect(invokers.counts.screening).toBe(1);
    expect(invokers.counts.evolution).toBe(1);
    expect(result.executedJobs.sort()).toEqual(['evolution', 'planGeneration', 'screening']);
  });

  it('run_all の budget.maxParallel=1 は 1 件だけ実行 (= clamp)', async () => {
    const invokers = makeInvokerMocks();
    const aiProvider = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          action: 'run_all',
          reasoning: 'limited',
          runAllBudget: { maxParallel: 1 },
        }),
        usage: { totalTokens: 100 },
      }),
    };
    const orchestrator = new TopLevelOrchestrator({
      prisma: makePrismaMock() as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aiProvider: aiProvider as any,
      jobInvokers: invokers,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      promptRegistry: { getCompositeActive: async () => 'sys' } as any,
    });
    const result = await orchestrator.decideAndExecute('test');
    // maxParallel=1 で先頭 1 件 (= planGeneration) のみ
    expect(invokers.counts.plan).toBe(1);
    expect(invokers.counts.screening).toBe(0);
    expect(invokers.counts.evolution).toBe(0);
    expect(result.executedJobs).toEqual(['planGeneration']);
  });

  it('LLM 出力が invalid JSON なら throw', async () => {
    const invokers = makeInvokerMocks();
    const aiProvider = {
      chat: jest.fn().mockResolvedValue({
        content: 'not a json',
        usage: { totalTokens: 100 },
      }),
    };
    const orchestrator = new TopLevelOrchestrator({
      prisma: makePrismaMock() as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aiProvider: aiProvider as any,
      jobInvokers: invokers,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      promptRegistry: { getCompositeActive: async () => 'sys' } as any,
    });
    await expect(orchestrator.decideAndExecute('test')).rejects.toThrow(/JSON parse/);
  });

  it('PR #248 review #2: LLM が blockedActions の action を選んだら強制 wait に', async () => {
    const invokers = makeInvokerMocks();
    // prisma mock で EdgeHypothesis を 1500 件 (= 禁止事項 #4 発火) として返す
    const groupBy = jest.fn().mockResolvedValue([
      { status: 'unverified', _count: { _all: 1500 } },
    ]);
    const prismaMock = {
      edgeHypothesis: { groupBy, count: jest.fn().mockResolvedValue(0) },
      evolutionBacktestRun: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      agentRun: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002' }),
        update: jest.fn().mockResolvedValue({}),
      },
      agentRunStep: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    // LLM が blocked action='create_hypothesis' を選ぶ (= ルール無視)
    const aiProvider = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({ action: 'create_hypothesis', reasoning: 'ignore blockedActions' }),
        usage: { totalTokens: 100 },
      }),
    };
    const orchestrator = new TopLevelOrchestrator({
      prisma: prismaMock as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aiProvider: aiProvider as any,
      jobInvokers: invokers,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      promptRegistry: { getCompositeActive: async () => 'sys' } as any,
    });
    const result = await orchestrator.decideAndExecute('test');
    // 強制 'wait' に切替わる、reasoning に強制経緯を明示
    expect(result.output?.action).toBe('wait');
    expect(result.output?.reasoning).toMatch(/強制|blocked/);
    // planGeneration は呼ばれない
    expect(invokers.counts.plan).toBe(0);
    expect(result.executedJobs).toEqual([]);
  });

  it('PR #248 review #4/#10: コードフェンス付き JSON を剥がして parse できる', async () => {
    const invokers = makeInvokerMocks();
    const fencedContent = "```json\n" + JSON.stringify({ action: 'wait', reasoning: 'fenced' }) + "\n```";
    const aiProvider = {
      chat: jest.fn().mockResolvedValue({ content: fencedContent, usage: { totalTokens: 100 } }),
    };
    const orchestrator = new TopLevelOrchestrator({
      prisma: makePrismaMock() as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aiProvider: aiProvider as any,
      jobInvokers: invokers,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      promptRegistry: { getCompositeActive: async () => 'sys' } as any,
    });
    const result = await orchestrator.decideAndExecute('test');
    // フェンスが剥がれて parse 成功
    expect(result.output?.action).toBe('wait');
    expect(result.output?.reasoning).toBe('fenced');
  });

  it('Phase 2: 成功時に AgentRun.create (status=pending) + update (status=succeeded) が呼ばれる', async () => {
    const invokers = makeInvokerMocks();
    const prismaMock = makePrismaMock() as {
      agentRun: { create: jest.Mock; update: jest.Mock };
      agentRunStep: { create: jest.Mock };
    };
    const orchestrator = new TopLevelOrchestrator({
      prisma: prismaMock as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aiProvider: makeAiProviderMock('wait') as any,
      jobInvokers: invokers,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      promptRegistry: { getCompositeActive: async () => 'sys' } as any,
    });
    await orchestrator.decideAndExecute('test');

    // AgentRun が pending で作られた
    expect(prismaMock.agentRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'top_level_orchestrator',
        triggeredBy: 'test',
        status: 'pending',
      }),
    });
    // 完了時に succeeded で update された
    expect(prismaMock.agentRun.update).toHaveBeenCalledWith({
      where: { id: '00000000-0000-0000-0000-000000000001' },
      data: expect.objectContaining({
        status: 'succeeded',
        finishedAt: expect.any(Date),
        summary: expect.stringContaining('action=wait'),
      }),
    });
    // AgentRunStep に判断履歴が保存された
    expect(prismaMock.agentRunStep.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runId: '00000000-0000-0000-0000-000000000001',
        stepName: 'decide',
        status: 'succeeded',
        summary: expect.stringContaining('action=wait'),
      }),
    });
  });

  it('Phase 2: LLM 例外時は AgentRun.update (status=failed, errorCode=fatal_*) が呼ばれて throw', async () => {
    const invokers = makeInvokerMocks();
    const prismaMock = makePrismaMock() as {
      agentRun: { create: jest.Mock; update: jest.Mock };
    };
    // LLM が必ず throw する mock
    const aiProvider = {
      chat: jest.fn().mockRejectedValue(new Error('LLM API down')),
    };
    const orchestrator = new TopLevelOrchestrator({
      prisma: prismaMock as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aiProvider: aiProvider as any,
      jobInvokers: invokers,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      promptRegistry: { getCompositeActive: async () => 'sys' } as any,
    });

    await expect(orchestrator.decideAndExecute('test')).rejects.toThrow(/LLM API down/);

    // 失敗時 update が呼ばれた、fatal_ プレフィックスで isFatal 判定可能に
    expect(prismaMock.agentRun.update).toHaveBeenCalledWith({
      where: { id: '00000000-0000-0000-0000-000000000001' },
      data: expect.objectContaining({
        status: 'failed',
        errorCode: 'fatal_decideAndExecute',
        errorMessage: expect.stringContaining('LLM API down'),
      }),
    });
  });

  it('LLM 出力が schema 違反なら throw (Zod)', async () => {
    const invokers = makeInvokerMocks();
    const aiProvider = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({ action: 'unknown_action', reasoning: 'x' }),
        usage: { totalTokens: 100 },
      }),
    };
    const orchestrator = new TopLevelOrchestrator({
      prisma: makePrismaMock() as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aiProvider: aiProvider as any,
      jobInvokers: invokers,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      promptRegistry: { getCompositeActive: async () => 'sys' } as any,
    });
    await expect(orchestrator.decideAndExecute('test')).rejects.toThrow();
  });
});
