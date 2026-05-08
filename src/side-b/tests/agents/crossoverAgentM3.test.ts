/**
 * Filter Evolution M3: CrossoverAgent の filter 追加器再設計テスト。
 *
 * 既存 (4a.PDCA) crossoverAgentParse.test.ts は direct DSL 形式の正常系・異常系を
 * 網羅済。本ファイルは M3 で追加された:
 *
 *   - wrapper 形式 `{ child_dsl, rejected_loss_count, preserved_win_count, rationale }` の受理
 *   - parentLossTrades / moduleParents が user prompt に注入されること
 *   - abs(pnl) 上位 30 件への絞り込み（30 件超の場合）
 *
 * を中心に検証する。LLM 応答の Zod 検証 / 失敗バケット集計は既存テストに任せる。
 */

import { CrossoverAgent } from '../../agents/CrossoverAgent';
import type { LossTradeSummary } from '../../agents/CrossoverAgent';
import type { AIProvider } from '../../agent/aiProvider';
import { StrategyDSLSchema, type StrategyDSL } from '../../strategy_dsl/schema';
import type { ModuleParent } from '../../evolution/moduleParentRegistry';

function mockAi(impl: jest.Mock): AIProvider {
  return {
    chat: impl,
  } as unknown as AIProvider;
}

function makeElite(id: string): StrategyDSL {
  return StrategyDSLSchema.parse({
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
    metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
  });
}

function makeValidChildDsl(): unknown {
  return {
    id: 'tmp-id',
    generation: 1,
    parentIds: ['elite-1', 'elite-2'],
    regimeTarget: 'breakout',
    symbol: 'EURUSD',
    timeframe: '1h',
    entry: {
      direction: 'long',
      trigger: {
        logic: 'AND',
        conditions: [
          { lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 },
          { lens: 'time_session', feature: 'overlap_london_ny', op: 'is_true' },
        ],
      },
      orderType: 'market',
    },
    stopLoss: { type: 'fixed_pips', value: 30 },
    takeProfit: { type: 'rr_ratio', value: 1.5 },
    parameters: {},
    metadata: { createdAt: new Date().toISOString(), createdBy: 'crossover' },
  };
}

const elites = [makeElite('elite-1'), makeElite('elite-2')];
const scores = new Map([
  ['elite-1', 0.5],
  ['elite-2', 0.4],
]);

describe('CrossoverAgent M3 (filter 追加器再設計)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('wrapper 形式の受理', () => {
    it('{ child_dsl, rejected_loss_count, preserved_win_count, rationale } 形式を受理する', async () => {
      const wrapper = {
        child_dsl: makeValidChildDsl(),
        rejected_loss_count: 12,
        preserved_win_count: 28,
        rationale:
          '親 A の負けは UTC 0-5h（流動性低）に集中していた。ロンドン NY オーバーラップに限定する filter を追加。',
      };
      const chatMock = jest
        .fn()
        .mockResolvedValue({ content: JSON.stringify(wrapper), toolCalls: [] });
      const agent = new CrossoverAgent(mockAi(chatMock));
      const out = await agent.generateCrossovers(elites, scores, 1);
      expect(out).toHaveLength(1);
      expect(out[0].metadata.createdBy).toBe('crossover');
      expect(out[0].parentIds).toEqual(['elite-1', 'elite-2']);
      // M3 観測ログが出ていることを確認
      const infoSpy = console.info as unknown as jest.Mock;
      const m3Log = infoSpy.mock.calls.find((c) =>
        typeof c[0] === 'string' ? c[0].includes('M3 child generated') : false,
      );
      expect(m3Log).toBeDefined();
      expect(m3Log?.[0]).toContain('rejected_loss=12');
      expect(m3Log?.[0]).toContain('preserved_win=28');
      expect(m3Log?.[0]).toContain('rationale=');
    });

    it('rejected_loss_count が文字列 / 負数 / NaN なら n/a として安全にログ出力される', async () => {
      const wrapper = {
        child_dsl: makeValidChildDsl(),
        rejected_loss_count: 'invalid',
        preserved_win_count: -5,
        rationale: '   ',
      };
      const chatMock = jest
        .fn()
        .mockResolvedValue({ content: JSON.stringify(wrapper), toolCalls: [] });
      const agent = new CrossoverAgent(mockAi(chatMock));
      const out = await agent.generateCrossovers(elites, scores, 1);
      expect(out).toHaveLength(1);
      const infoSpy = console.info as unknown as jest.Mock;
      const m3Log = infoSpy.mock.calls.find((c) =>
        typeof c[0] === 'string' ? c[0].includes('M3 child generated') : false,
      );
      expect(m3Log?.[0]).toContain('rejected_loss=n/a');
      // -5 は 0 に正規化される
      expect(m3Log?.[0]).toContain('preserved_win=0');
      // 空白 rationale はログに含まれない（rationale="..." セグメント自体が出ない）
      expect(m3Log?.[0]).not.toContain('rationale=');
    });

    it('direct DSL 形式（後方互換）も引き続き受理される', async () => {
      const directDsl = makeValidChildDsl();
      const chatMock = jest
        .fn()
        .mockResolvedValue({ content: JSON.stringify(directDsl), toolCalls: [] });
      const agent = new CrossoverAgent(mockAi(chatMock));
      const out = await agent.generateCrossovers(elites, scores, 1);
      expect(out).toHaveLength(1);
      // direct 形式では observation log は出ない
      const infoSpy = console.info as unknown as jest.Mock;
      const m3Log = infoSpy.mock.calls.find((c) =>
        typeof c[0] === 'string' ? c[0].includes('M3 child generated') : false,
      );
      expect(m3Log).toBeUndefined();
    });
  });

  describe('parentLossTrades / moduleParents の prompt 注入', () => {
    it('parentLossTrades が user prompt に注入される（負けトレード一覧 + 全件数）', async () => {
      const losses: LossTradeSummary[] = [
        { entryTime: '2024-01-01T03:00:00Z', side: 'long', pnl: -45 },
        { entryTime: '2024-01-02T04:30:00Z', side: 'long', pnl: -52 },
      ];
      const parentLossTrades = new Map<string, ReadonlyArray<LossTradeSummary>>([
        ['elite-1', losses],
      ]);

      const wrapper = {
        child_dsl: makeValidChildDsl(),
        rejected_loss_count: 1,
        preserved_win_count: 5,
        rationale: 'r',
      };
      const chatMock = jest
        .fn()
        .mockResolvedValue({ content: JSON.stringify(wrapper), toolCalls: [] });
      const agent = new CrossoverAgent(mockAi(chatMock));
      await agent.generateCrossovers(elites, scores, 1, { parentLossTrades });

      expect(chatMock).toHaveBeenCalled();
      const messages = chatMock.mock.calls[0][0] as Array<{ role: string; content: string }>;
      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg).toBeDefined();
      expect(userMsg?.content).toContain('親A_loss_trades');
      expect(userMsg?.content).toContain('2024-01-01T03:00:00Z');
      expect(userMsg?.content).toContain('-45');
      expect(userMsg?.content).toContain('全 2 件');
    });

    it('parentLossTrades が 30 件超なら abs(pnl) 上位 30 件に絞り込まれる', async () => {
      // 50 件作る。pnl = -i (= 0..49)、abs(pnl) 上位 30 = pnl in [-49..-20]
      const losses: LossTradeSummary[] = Array.from({ length: 50 }, (_, i) => ({
        entryTime: `2024-01-01T${String(i % 24).padStart(2, '0')}:00:00Z`,
        side: 'long',
        pnl: -i,
      }));
      const parentLossTrades = new Map<string, ReadonlyArray<LossTradeSummary>>([
        ['elite-1', losses],
      ]);

      const wrapper = {
        child_dsl: makeValidChildDsl(),
        rejected_loss_count: 1,
        preserved_win_count: 5,
        rationale: 'r',
      };
      const chatMock = jest
        .fn()
        .mockResolvedValue({ content: JSON.stringify(wrapper), toolCalls: [] });
      const agent = new CrossoverAgent(mockAi(chatMock));
      await agent.generateCrossovers(elites, scores, 1, { parentLossTrades });

      const messages = chatMock.mock.calls[0][0] as Array<{ role: string; content: string }>;
      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg?.content).toContain('全 50 件中');
      // 上位 30 件抜粋: pnl=-49 (= 最大 abs) は含まれる、pnl=-19 (= 31 番目) は含まれない
      expect(userMsg?.content).toContain('-49');
      expect(userMsg?.content).not.toMatch(/"pnl": -19[,\s]/);
    });

    it('parentLossTrades が空 / 未指定なら "資料なし" のメッセージが入る', async () => {
      const wrapper = { child_dsl: makeValidChildDsl() };
      const chatMock = jest
        .fn()
        .mockResolvedValue({ content: JSON.stringify(wrapper), toolCalls: [] });
      const agent = new CrossoverAgent(mockAi(chatMock));
      await agent.generateCrossovers(elites, scores, 1);

      const messages = chatMock.mock.calls[0][0] as Array<{ role: string; content: string }>;
      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg?.content).toContain('親A_loss_trades: なし');
    });

    it('moduleParents が user prompt に id / category / description で注入される', async () => {
      const moduleParents: ModuleParent[] = [
        {
          id: 'mtf-htf-trend-aligned',
          category: 'mtf',
          description: '上位足 (1h) のトレンドと方向が一致しているときだけ entry。',
          lensName: 'ohlcv@1h',
          featureKey: 'close',
          typicalOps: ['>', '<'],
          typicalValueHint: '上位足の EMA50',
          recommendedRegimes: ['breakout'],
        },
      ];
      const wrapper = { child_dsl: makeValidChildDsl() };
      const chatMock = jest
        .fn()
        .mockResolvedValue({ content: JSON.stringify(wrapper), toolCalls: [] });
      const agent = new CrossoverAgent(mockAi(chatMock));
      await agent.generateCrossovers(elites, scores, 1, { moduleParents });

      const messages = chatMock.mock.calls[0][0] as Array<{ role: string; content: string }>;
      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg?.content).toContain('module_parents');
      expect(userMsg?.content).toContain('mtf-htf-trend-aligned');
      expect(userMsg?.content).toContain('上位足 (1h)');
    });

    it('moduleParents 未指定なら "module_parents: なし" メッセージが入る', async () => {
      const wrapper = { child_dsl: makeValidChildDsl() };
      const chatMock = jest
        .fn()
        .mockResolvedValue({ content: JSON.stringify(wrapper), toolCalls: [] });
      const agent = new CrossoverAgent(mockAi(chatMock));
      await agent.generateCrossovers(elites, scores, 1);

      const messages = chatMock.mock.calls[0][0] as Array<{ role: string; content: string }>;
      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg?.content).toContain('module_parents: なし');
    });
  });
});
