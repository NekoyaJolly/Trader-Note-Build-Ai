/**
 * Critical-4 段階 4a.PDCA: MutationAgent silent-empty 観測ログのテスト
 *
 * AIProvider をモックし、応答パターンごとに観測ログ分岐が正しく発火することを検証する。
 *   - API 全リトライ失敗 (withRetries result.ok=false)
 *   - API 成功だが content 空
 *   - JSON 抽出失敗 (応答が JSON でない)
 *   - JSON 配列パース成功 + Zod 不適合 → parsed.length < count を観測
 *
 * これらは「mutantsReceived=0 が出た時に原因を追える」運用要件 (4a.PDCA) を保証する。
 */

import { MutationAgent } from '../../agents/MutationAgent';
import type { AIProvider } from '../../agent/aiProvider';
import { StrategyDSLSchema, type StrategyDSL } from '../../strategy_dsl/schema';
import { createRepairHintV1 } from '../../evolution/repairHintPolicy';

function mockAi(impl: jest.Mock): AIProvider {
  return {
    chat: impl,
  } as unknown as AIProvider;
}

function validDsl(id: string): unknown {
  return {
    id,
    generation: 0,
    parentIds: [],
    regimeTarget: 'breakout',
    symbol: 'EURUSD',
    timeframe: '1h',
    entry: {
      direction: 'long',
      trigger: {
        logic: 'AND',
        conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 }],
      },
      orderType: 'market',
    },
    stopLoss: { type: 'fixed_pips', value: 30 },
    takeProfit: { type: 'rr_ratio', value: 1.5 },
    parameters: {},
    metadata: { createdAt: new Date().toISOString(), createdBy: 'mutation' },
  };
}

const eliteSeed: StrategyDSL = StrategyDSLSchema.parse({
  ...(validDsl('elite-1') as object),
  id: 'elite-1',
  metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
});
const eliteScores = new Map([['elite-1', 0.5]]);

describe('MutationAgent silent-empty 観測ログ (4a.PDCA)', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('API 全リトライ失敗時は "API 失敗 (リトライ尽くし)" ログを出して空配列を返す', async () => {
    const chatMock = jest.fn().mockRejectedValue(new Error('429 Too Many Requests'));
    const agent = new MutationAgent(mockAi(chatMock));
    const out = await agent.generateMutants([eliteSeed], eliteScores, 5);
    expect(out).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('API 失敗 (リトライ尽くし)'),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('429 Too Many Requests'));
  });

  it('API 成功だが content が空のとき "LLM 応答 content が空" ログを出す', async () => {
    const chatMock = jest.fn().mockResolvedValue({ content: '', toolCalls: [] });
    const agent = new MutationAgent(mockAi(chatMock));
    const out = await agent.generateMutants([eliteSeed], eliteScores, 5);
    expect(out).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/LLM 応答 content が空.*API は成功/),
    );
    // API 失敗ログは出ない
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('リトライ尽くし'));
  });

  it('JSON 抽出失敗時は "応答 parse 失敗" ログ + 応答先頭をプレビュー出力する', async () => {
    const chatMock = jest
      .fn()
      .mockResolvedValue({ content: 'not a json at all just plain text', toolCalls: [] });
    const agent = new MutationAgent(mockAi(chatMock));
    const out = await agent.generateMutants([eliteSeed], eliteScores, 5);
    expect(out).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('応答 parse 失敗'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not a json'));
  });

  it('Zod 部分失敗 (parsed=1/3) 時は内訳と path:message を含むログを出す', async () => {
    const validItem = validDsl('mut-good');
    const invalidItem = {
      ...(validItem as object),
      id: 'mut-bad',
      // entry.direction を不正値にして Zod を弾く
      entry: { ...((validItem as { entry: object }).entry), direction: 'sideways' },
    };
    const response = JSON.stringify([validItem, invalidItem, invalidItem]);
    const chatMock = jest.fn().mockResolvedValue({ content: response, toolCalls: [] });
    const agent = new MutationAgent(mockAi(chatMock));
    const out = await agent.generateMutants([eliteSeed], eliteScores, 3);

    expect(out.length).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/parsed=1\/3.*Zod 不適合 2 件/),
    );
    // path:message 形式が含まれる (Zod は union の root で `entry: Invalid input` を出す)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/entry:.*Invalid input/));
  });

  it('全件 Zod 失敗時は parsed=0 で空配列、内訳ログあり', async () => {
    const invalidItem = {
      ...(validDsl('mut-1') as object),
      entry: {
        direction: 'sideways', // Zod 不正
        trigger: {
          logic: 'AND',
          conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 }],
        },
        orderType: 'market',
      },
    };
    const response = JSON.stringify([invalidItem, invalidItem]);
    const chatMock = jest.fn().mockResolvedValue({ content: response, toolCalls: [] });
    const agent = new MutationAgent(mockAi(chatMock));
    const out = await agent.generateMutants([eliteSeed], eliteScores, 2);

    expect(out).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/parsed=0\/2/),
    );
  });
});

describe('PR #100: MutationAgent repairHint 統合', () => {
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('repairHint 未指定なら従来挙動 (prompt に修復ヒント節が含まれない)', async () => {
    const validItem = validDsl('mut-1');
    const chatMock = jest
      .fn()
      .mockResolvedValue({ content: JSON.stringify([validItem]), toolCalls: [] });
    const agent = new MutationAgent(mockAi(chatMock));

    const out = await agent.generateMutants([eliteSeed], eliteScores, 1);
    expect(out).toHaveLength(1);

    expect(chatMock).toHaveBeenCalledTimes(1);
    const messages = chatMock.mock.calls[0][0] as Array<{ role: string; content: string }>;
    const userContent = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).not.toMatch(/失敗修復ヒント/);
    // repairHint 適用ログも出ない
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('repairHint適用'),
    );
  });

  it('shouldUseForRepairMutation=true の repairHint は user prompt に含まれる + ログが出る', async () => {
    const validItem = validDsl('mut-1');
    const chatMock = jest
      .fn()
      .mockResolvedValue({ content: JSON.stringify([validItem]), toolCalls: [] });
    const agent = new MutationAgent(mockAi(chatMock));

    const hint = createRepairHintV1({
      candidateId: eliteSeed.id,
      failureReason: 'low_pf',
      metrics: { pf: 0.7 },
    });
    const repairHints = new Map([[eliteSeed.id, hint]]);

    await agent.generateMutants([eliteSeed], eliteScores, 1, repairHints);

    expect(chatMock).toHaveBeenCalledTimes(1);
    const messages = chatMock.mock.calls[0][0] as Array<{ role: string; content: string }>;
    const userContent = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).toMatch(/失敗修復ヒント/);
    expect(userContent).toMatch(/reason=low_pf/);
    expect(userContent).toMatch(/severity=medium/);
    // ログ確認 (mutation が repair を受け取ったことの観測経路)
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/repairHint適用.*1\/1/),
    );
  });

  it('shouldUseForRepairMutation=false (dsl_missing) の hint は prompt から除外される', async () => {
    const validItem = validDsl('mut-1');
    const chatMock = jest
      .fn()
      .mockResolvedValue({ content: JSON.stringify([validItem]), toolCalls: [] });
    const agent = new MutationAgent(mockAi(chatMock));

    const hint = createRepairHintV1({
      candidateId: eliteSeed.id,
      failureReason: 'dsl_missing',
    });
    expect(hint.shouldUseForRepairMutation).toBe(false);
    const repairHints = new Map([[eliteSeed.id, hint]]);

    // fatal で唯一の親が除外されるため mutants=0 になる (= 親 DSL 自体が payload に乗らない)
    const out = await agent.generateMutants([eliteSeed], eliteScores, 1, repairHints);
    expect(out).toEqual([]);

    // chat 自体が呼ばれない (= 全親 fatal で early return)
    expect(chatMock).not.toHaveBeenCalled();
    // 除外ログが出る
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/repairHint除外.*1\/1/),
    );
  });

  it('PR #100 review: shouldExcludeFromParentPool=true の親は payload (elites JSON) からも除外される', async () => {
    // 健全な親 (eliteSeed) と fatal 親 (excluded) の 2 体を渡し、fatal だけが除外されることを確認
    const fatalElite: StrategyDSL = StrategyDSLSchema.parse({
      ...(validDsl('elite-fatal') as object),
      id: 'elite-fatal',
      metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
    });
    const validItem = validDsl('mut-out');
    const chatMock = jest
      .fn()
      .mockResolvedValue({ content: JSON.stringify([validItem]), toolCalls: [] });
    const agent = new MutationAgent(mockAi(chatMock));

    const hints = new Map([
      [
        fatalElite.id,
        createRepairHintV1({ candidateId: fatalElite.id, failureReason: 'dsl_missing' }),
      ],
      [
        eliteSeed.id,
        createRepairHintV1({
          candidateId: eliteSeed.id,
          failureReason: 'low_pf',
          metrics: { pf: 0.7 },
        }),
      ],
    ]);
    const scores = new Map([
      ['elite-fatal', 0.4],
      ['elite-1', 0.5],
    ]);

    await agent.generateMutants([fatalElite, eliteSeed], scores, 1, hints);

    expect(chatMock).toHaveBeenCalledTimes(1);
    const messages = chatMock.mock.calls[0][0] as Array<{ role: string; content: string }>;
    const userContent = messages.find((m) => m.role === 'user')?.content ?? '';
    // fatal 親の id は payload (elites JSON) に乗らない
    expect(userContent).not.toMatch(/elite-fatal/);
    // 健全な親は残る
    expect(userContent).toMatch(/elite-1/);
    // 除外ログ + 適用ログの両方が出る
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/repairHint除外.*1\/2/));
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/repairHint適用.*1\/1/));
  });
});
