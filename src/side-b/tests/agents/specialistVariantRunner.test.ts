/**
 * Phase 6.6: runSpecialistWithVariant のユニットテスト
 *
 * - registry に active 無し → fallback 経路、recordUsage 呼ばれない
 * - experimental 選択 → recordUsage(experimentalId) に記録
 * - experimental 失敗 + active 成功 → recordUsage 2 回(exp 失敗、active 成功)
 * - experimental + active 両方失敗 → output=null、success=false
 * - 20% 制限(rand 注入による統計的検証)
 */

import { runSpecialistWithVariant } from '../../agents/specialists/specialistCommon';
import type { AIProvider } from '../../agent/aiProvider';
import type { PromptRegistry } from '../../prompts/registry/PromptRegistry';
import type { PromptVersion } from '../../prompts/registry/types';

function mockAi(responses: Array<string | Error>): AIProvider {
  let i = 0;
  return {
    chat: jest.fn(async () => {
      const cur = responses[i++];
      if (cur instanceof Error) throw cur;
      return {
        content: cur ?? '{}',
        toolCalls: [],
        tokenUsage: 10,
        model: 'mock',
        finishReason: 'stop',
      };
    }),
  } as unknown as AIProvider;
}

function makePrompt(id: string, status: 'active' | 'experimental', content = '# prompt'): PromptVersion {
  return {
    id,
    agentName: 'trend_specialist',
    version: id,
    content,
    createdBy: status === 'active' ? 'human' : 'mutation',
    status,
    usageCount: 0,
    successCount: 0,
    avgScore: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function mockRegistry(opts: { active: PromptVersion | null; experimentals?: PromptVersion[] }): PromptRegistry {
  const recorded: Array<{ id: string; score: number; success: boolean }> = [];
  const fake = {
    getActive: jest.fn(async () => opts.active),
    getExperimental: jest.fn(async () => opts.experimentals ?? []),
    recordUsage: jest.fn(async (id: string, usage: { score: number; success: boolean }) => {
      recorded.push({ id, score: usage.score, success: usage.success });
      return {} as any;
    }),
    // hoist recorded for test inspection
    __recorded: recorded,
  } as unknown as PromptRegistry & { __recorded: typeof recorded };
  return fake;
}

// trend_specialist のスコアが高くなる妥当な応答
const VALID_TREND = JSON.stringify({
  trendState: 'strong_up',
  trendStrength: 0.7,
  trendMaturity: 'middle',
  keyLevels: { support: [100], resistance: [110] },
  interpretation: 'x'.repeat(100),
  confidence: 0.6,
});

// trendSpecialistScoreFn が高スコアを付けられる完全な出力形式で返す(success=true を再現)
function validator(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.trendState !== 'string') return null;
  return r;
}

describe('runSpecialistWithVariant', () => {
  it('registry に active が無ければ fallback 経路で単純実行(recordUsage 呼ばれない)', async () => {
    const ai = mockAi([VALID_TREND]);
    const reg = mockRegistry({ active: null });
    const result = await runSpecialistWithVariant(ai, {
      agentName: 'trend_specialist',
      userPrompt: 'test',
      fallbackSystemPrompt: '# fallback',
      scoringInput: {},
      validate: validator,
      registry: reg,
    });
    expect(result.usedFallbackPrompt).toBe(true);
    expect((result.output as any)?.trendState).toBe('strong_up');
    expect((reg as any).__recorded.length).toBe(0);
  });

  it('experimental が選ばれて成功 → recordUsage は experimental ID に記録', async () => {
    const ai = mockAi([VALID_TREND]);
    const active = makePrompt('act', 'active', '# active');
    const exp = makePrompt('exp1', 'experimental', '# exp');
    const reg = mockRegistry({ active, experimentals: [exp] });
    const rand = (() => {
      const seq = [0.05, 0.0]; // 0.05 < 0.2 で experimental、次は index 0
      let i = 0;
      return () => seq[i++] ?? 0.5;
    })();
    const result = await runSpecialistWithVariant(ai, {
      agentName: 'trend_specialist',
      userPrompt: 'test',
      fallbackSystemPrompt: '# fallback',
      scoringInput: {},
      validate: validator,
      registry: reg,
      rand,
    });
    expect(result.wasExperimental).toBe(true);
    expect(result.fellBackToActive).toBe(false);
    expect(result.success).toBe(true);
    expect(result.usedVersionId).toBe('exp1');
    const recs = (reg as any).__recorded;
    expect(recs.length).toBe(1);
    expect(recs[0].id).toBe('exp1');
    expect(recs[0].success).toBe(true);
  });

  it('experimental が失敗(パース不能) → active で再試行して成功、recordUsage は 2 回', async () => {
    const ai = mockAi(['not json at all', VALID_TREND]);
    const active = makePrompt('act', 'active');
    const exp = makePrompt('exp1', 'experimental');
    const reg = mockRegistry({ active, experimentals: [exp] });
    const rand = (() => {
      const seq = [0.05, 0.0];
      let i = 0;
      return () => seq[i++] ?? 0.5;
    })();
    const result = await runSpecialistWithVariant(ai, {
      agentName: 'trend_specialist',
      userPrompt: 'test',
      fallbackSystemPrompt: '# fallback',
      scoringInput: {},
      validate: validator,
      registry: reg,
      rand,
    });
    expect(result.fellBackToActive).toBe(true);
    expect(result.success).toBe(true);
    expect(result.usedVersionId).toBe('act');
    const recs = (reg as any).__recorded;
    expect(recs.length).toBe(2);
    expect(recs[0]).toEqual(expect.objectContaining({ id: 'exp1', success: false }));
    expect(recs[1]).toEqual(expect.objectContaining({ id: 'act', success: true }));
  });

  it('experimental + active 両方失敗 → output=null, success=false、recordUsage 2 回', async () => {
    const ai = mockAi(['garbage', 'more garbage']);
    const active = makePrompt('act', 'active');
    const exp = makePrompt('exp1', 'experimental');
    const reg = mockRegistry({ active, experimentals: [exp] });
    const rand = (() => {
      const seq = [0.05, 0.0];
      let i = 0;
      return () => seq[i++] ?? 0.5;
    })();
    const result = await runSpecialistWithVariant(ai, {
      agentName: 'trend_specialist',
      userPrompt: 'test',
      fallbackSystemPrompt: '# fallback',
      scoringInput: {},
      validate: validator,
      registry: reg,
      rand,
    });
    expect(result.success).toBe(false);
    expect(result.output).toBeNull();
    const recs = (reg as any).__recorded;
    expect(recs.length).toBe(2);
    expect(recs.every((r: any) => r.success === false)).toBe(true);
  });

  it('active のみ(experimental なし)で失敗 → 再試行せず失敗で返る', async () => {
    const ai = mockAi(['garbage']);
    const active = makePrompt('act', 'active');
    const reg = mockRegistry({ active, experimentals: [] });
    const result = await runSpecialistWithVariant(ai, {
      agentName: 'trend_specialist',
      userPrompt: 'test',
      fallbackSystemPrompt: '# fallback',
      scoringInput: {},
      validate: validator,
      registry: reg,
    });
    expect(result.success).toBe(false);
    expect(result.fellBackToActive).toBe(false);
    const recs = (reg as any).__recorded;
    expect(recs.length).toBe(1);
    expect(recs[0].id).toBe('act');
  });

  it('roll >= 0.2 なら active が選ばれる(experimental 20% 制限)', async () => {
    const ai = mockAi([VALID_TREND]);
    const active = makePrompt('act', 'active');
    const exp = makePrompt('exp1', 'experimental');
    const reg = mockRegistry({ active, experimentals: [exp] });
    const result = await runSpecialistWithVariant(ai, {
      agentName: 'trend_specialist',
      userPrompt: 'test',
      fallbackSystemPrompt: '# fallback',
      scoringInput: {},
      validate: validator,
      registry: reg,
      rand: () => 0.5, // > 0.2 で必ず active
    });
    expect(result.wasExperimental).toBe(false);
    expect(result.usedVersionId).toBe('act');
  });

  it('registry.getActive が例外でも fallback 経路で実行される', async () => {
    const ai = mockAi([VALID_TREND]);
    const reg = {
      getActive: jest.fn(async () => {
        throw new Error('DB down');
      }),
      getExperimental: jest.fn(),
      recordUsage: jest.fn(),
    } as unknown as PromptRegistry;
    const result = await runSpecialistWithVariant(ai, {
      agentName: 'trend_specialist',
      userPrompt: 'test',
      fallbackSystemPrompt: '# fallback',
      scoringInput: {},
      validate: validator,
      registry: reg,
    });
    expect(result.usedFallbackPrompt).toBe(true);
    expect(result.success).toBe(true);
  });

  it('統計的に experimental 選択率 ≈ 20%(1000 試行)', async () => {
    // 成功応答で固定、初回選択の wasExperimental を計測する
    const active = makePrompt('act', 'active');
    const exp = makePrompt('exp1', 'experimental');
    let experimentalCount = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      const reg = mockRegistry({ active, experimentals: [exp] });
      const mockAi2 = {
        chat: jest.fn(async () => ({
          content: VALID_TREND,
          toolCalls: [],
          tokenUsage: 0,
          model: 'mock',
          finishReason: 'stop',
        })),
      } as unknown as AIProvider;
      const res = await runSpecialistWithVariant(mockAi2, {
        agentName: 'trend_specialist',
        userPrompt: '',
        fallbackSystemPrompt: '',
        scoringInput: {},
        validate: validator,
        registry: reg,
      });
      if (res.wasExperimental) experimentalCount++;
    }
    const ratio = experimentalCount / N;
    // 期待値 20% ± 7% の許容範囲(1000 試行の標準誤差 ≈ 1.3%、3σ で 4%、安全側に 7%)
    expect(ratio).toBeGreaterThan(0.13);
    expect(ratio).toBeLessThan(0.27);
  }, 15000);
});
