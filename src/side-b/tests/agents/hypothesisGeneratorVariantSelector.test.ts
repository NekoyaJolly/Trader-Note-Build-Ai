/**
 * Phase 6.6: HypothesisGeneratorAgent の variantSelector 接続テスト
 *
 * - registry に active が無ければ従来通り loadPrompt で動く(後方互換)
 * - registry に active + experimental があり、rand<0.2 で experimental が選ばれる
 * - experimental が失敗 → active で再試行、recordUsage 2 回
 * - 20% 制限の境界
 */

import { HypothesisGeneratorAgent } from '../../agents/HypothesisGeneratorAgent';
import type { LensFeatureSnapshot, LensFeature } from '../../lenses';
import type { PromptRegistry } from '../../prompts/registry/PromptRegistry';
import type { PromptVersion } from '../../prompts/registry/types';

global.fetch = jest.fn();

function makeSnapshot(): LensFeatureSnapshot {
  const features = new Map<string, LensFeature>();
  features.set('dow_theory', {
    lensName: 'dow_theory',
    lensVersion: '1.0.0',
    features: { trend_state: 'uptrend' },
    computedAt: new Date(),
  });
  return {
    timestamp: new Date(),
    symbol: 'XAUUSD',
    features,
    totalComputeDurationMs: 2,
  };
}

function validOutput() {
  return {
    hypotheses: [
      {
        statement: '上昇トレンド初期でボラ圧縮時、押し目買いが有効である',
        category: 'structure',
        expectedDirection: 'long',
        reasoning: '低ボラ蓄積後の初期トレンドは継続しやすい市場構造がある',
        conditions: [
          { lensName: 'dow_theory', featureKey: 'trend_state', op: '==', value: 'uptrend' },
          { lensName: 'dow_theory', featureKey: 'trend_state', op: '!=', value: 'downtrend' },
        ],
        lensRelevance: { dow_theory: 0.8 },
      },
    ],
    noveltyClaim: 'ok',
  };
}

function captureFetchWith(content: unknown) {
  const captured: { lastBody: any } = { lastBody: null };
  (global.fetch as jest.Mock).mockImplementation((_url: string, init?: any) => {
    captured.lastBody = JSON.parse(init.body);
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: JSON.stringify(content) } }],
          usage: { total_tokens: 300 },
          model: 'mock',
        }),
    });
  });
  return captured;
}

function makePrompt(id: string, status: 'active' | 'experimental', content: string): PromptVersion {
  return {
    id,
    agentName: 'hypothesis_generator',
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

function mockRegistry(opts: { active: PromptVersion | null; experimentals?: PromptVersion[] }) {
  const recorded: Array<{ id: string; score: number; success: boolean }> = [];
  const reg = {
    getActive: jest.fn(async () => opts.active),
    getExperimental: jest.fn(async () => opts.experimentals ?? []),
    recordUsage: jest.fn(async (id: string, usage: { score: number; success: boolean }) => {
      recorded.push({ id, score: usage.score, success: usage.success });
      return {} as any;
    }),
    __recorded: recorded,
  } as unknown as PromptRegistry & { __recorded: typeof recorded };
  return reg;
}

describe('HypothesisGeneratorAgent variantSelector 接続', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset();
  });

  it('registry に active なし → 従来通り loadPrompt 経路で動く(recordUsage 呼ばれない)', async () => {
    captureFetchWith(validOutput());
    const reg = mockRegistry({ active: null });
    const agent = new HypothesisGeneratorAgent({ apiKey: 'k', registry: reg });
    const res = await agent.generate({
      symbol: 'XAUUSD',
      timeframe: '15m',
      lensSnapshot: makeSnapshot(),
      existingHypotheses: [],
    });
    expect(res.output.hypotheses.length).toBe(1);
    expect((reg as any).__recorded.length).toBe(0);
  });

  it('experimental が選ばれて成功 → experimental ID に recordUsage', async () => {
    captureFetchWith(validOutput());
    const active = makePrompt('act', 'active', '# active');
    const exp = makePrompt('exp1', 'experimental', '# exp');
    const reg = mockRegistry({ active, experimentals: [exp] });
    const seq = [0.05, 0.0];
    let i = 0;
    const rand = () => seq[i++] ?? 0.5;
    const agent = new HypothesisGeneratorAgent({ apiKey: 'k', registry: reg, rand });
    const res = await agent.generate({
      symbol: 'XAUUSD',
      timeframe: '15m',
      lensSnapshot: makeSnapshot(),
      existingHypotheses: [],
    });
    expect(res.output.hypotheses.length).toBe(1);
    const recs = (reg as any).__recorded;
    expect(recs.length).toBe(1);
    expect(recs[0].id).toBe('exp1');
    expect(recs[0].success).toBe(true);
  });

  it('experimental が失敗 → active で再試行、recordUsage 2 回', async () => {
    // 1 回目(experimental)は parse 不能、2 回目(active)は成功
    let call = 0;
    (global.fetch as jest.Mock).mockImplementation((_url: string, init?: any) => {
      call++;
      const content = call === 1 ? 'not json' : JSON.stringify(validOutput());
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content } }],
            usage: { total_tokens: 100 },
            model: 'mock',
          }),
      });
    });
    const active = makePrompt('act', 'active', '# active');
    const exp = makePrompt('exp1', 'experimental', '# exp');
    const reg = mockRegistry({ active, experimentals: [exp] });
    const seq = [0.05, 0.0];
    let i = 0;
    const rand = () => seq[i++] ?? 0.5;
    const agent = new HypothesisGeneratorAgent({ apiKey: 'k', registry: reg, rand });
    const res = await agent.generate({
      symbol: 'XAUUSD',
      timeframe: '15m',
      lensSnapshot: makeSnapshot(),
      existingHypotheses: [],
    });
    expect(res.output.hypotheses.length).toBe(1);
    const recs = (reg as any).__recorded;
    expect(recs.length).toBe(2);
    expect(recs[0]).toEqual(expect.objectContaining({ id: 'exp1', success: false }));
    expect(recs[1]).toEqual(expect.objectContaining({ id: 'act', success: true }));
  });

  it('roll >= 0.2 で active が選ばれる(experimental 20% 制限)', async () => {
    captureFetchWith(validOutput());
    const active = makePrompt('act', 'active', '# active');
    const exp = makePrompt('exp1', 'experimental', '# exp');
    const reg = mockRegistry({ active, experimentals: [exp] });
    const agent = new HypothesisGeneratorAgent({
      apiKey: 'k',
      registry: reg,
      rand: () => 0.5,
    });
    const res = await agent.generate({
      symbol: 'XAUUSD',
      timeframe: '15m',
      lensSnapshot: makeSnapshot(),
      existingHypotheses: [],
    });
    expect(res.output.hypotheses.length).toBe(1);
    const recs = (reg as any).__recorded;
    expect(recs[0]!.id).toBe('act');
  });

  it('registry.getActive が例外でも fallback 経路で動く(recordUsage 呼ばれない)', async () => {
    captureFetchWith(validOutput());
    const reg = {
      getActive: jest.fn(async () => {
        throw new Error('DB down');
      }),
      getExperimental: jest.fn(),
      recordUsage: jest.fn(),
    } as unknown as PromptRegistry;
    const agent = new HypothesisGeneratorAgent({ apiKey: 'k', registry: reg });
    const res = await agent.generate({
      symbol: 'XAUUSD',
      timeframe: '15m',
      lensSnapshot: makeSnapshot(),
      existingHypotheses: [],
    });
    expect(res.output.hypotheses.length).toBe(1);
    expect((reg.recordUsage as jest.Mock).mock.calls.length).toBe(0);
  });
});
