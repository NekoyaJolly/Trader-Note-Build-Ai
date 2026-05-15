/**
 * DiscoveryAgent のテスト（Phase 4a）
 *
 * EdgeLedger は DI でモック化。fetch は jest.mock で応答を固定。
 */

import { DiscoveryAgent, validateDiscoveryOutput } from '../../agents/DiscoveryAgent';
import type { AITradeNote } from '../../models/aiTradeNote';
import type { EdgeLedger } from '../../ledger/EdgeLedger';
import type { EdgeHypothesis, CreateEdgeHypothesisInput } from '../../models/edgeHypothesis';
import { agentMemory } from '../../agent/agentMemory';

global.fetch = jest.fn();

function makeNote(
    outcome: 'win' | 'loss',
    features: Record<string, Record<string, number | string | boolean>>,
): AITradeNote {
    return {
        id: `note-${Math.random()}`,
        virtualTradeId: 'vt',
        planId: 'plan',
        date: '2026-04-15',
        symbol: 'XAUUSD',
        direction: 'long',
        result: {
            outcome,
            pnlPips: outcome === 'win' ? 30 : -20,
            pnlPercentage: 0.3,
            riskRewardActual: 1.5,
            holdingDuration: 60,
        },
        entryAnalysis: {} as AITradeNote['entryAnalysis'],
        exitAnalysis: {} as AITradeNote['exitAnalysis'],
        planEvaluation: {} as AITradeNote['planEvaluation'],
        marketReview: {} as AITradeNote['marketReview'],
        learnings: {} as AITradeNote['learnings'],
        lensSnapshot: {
            timestamp: new Date().toISOString(),
            features,
        },
        aiModel: 'test',
        createdAt: new Date(),
    };
}

function mockFetchWith(output: unknown) {
    (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
            Promise.resolve({
                choices: [{ message: { content: JSON.stringify(output) } }],
                usage: { total_tokens: 800 },
                model: 'gpt-4o',
            }),
    });
}

function makeLedgerStub(): { ledger: EdgeLedger; created: CreateEdgeHypothesisInput[] } {
    const created: CreateEdgeHypothesisInput[] = [];
    const ledger = {
        findByStatus: async (): Promise<EdgeHypothesis[]> => [],
        create: async (input: CreateEdgeHypothesisInput): Promise<EdgeHypothesis> => {
            created.push(input);
            return {
                id: `edge-${created.length}`,
                statement: input.statement,
                category: input.category,
                conditions: input.conditions,
                expectedDirection: input.expectedDirection,
                status: input.status,
                statusUpdatedAt: new Date(),
                symbols: input.symbols,
                timeframes: input.timeframes,
                observationCount: 0,
                winCount: 0,
                lossCount: 0,
                breakevenCount: 0,
                totalPnlPips: 0,
                avgRR: 0,
                source: input.source,
                lensRelevance: input.lensRelevance,
                firstObservedAt: new Date(),
                lastObservedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
                parentIds: [],
                relatedNoteIds: [],
            };
        },
    } as unknown as EdgeLedger;
    return { ledger, created };
}

describe('validateDiscoveryOutput', () => {
    const availableLenses = new Set(['volatility_regime', 'dow_theory']);

    it('正常出力を受け入れる', () => {
        const output = {
            interpretations: [
                {
                    lensName: 'volatility_regime',
                    featureKey: 'bb_width_percentile',
                    interpretation: '低パーセンタイルで勝率が高い',
                },
            ],
            newHypotheses: [
                {
                    statement: '低ボラ圧縮中に順張りエントリーする',
                    category: 'volatility',
                    expectedDirection: 'either',
                    reasoning: 'ボラ拡大直前の仕込みが有利',
                    conditions: [
                        { lensName: 'volatility_regime', featureKey: 'bb_width_percentile', op: '<', value: 20 },
                        { lensName: 'dow_theory', featureKey: 'trend_state', op: '==', value: 'uptrend' },
                    ],
                },
            ],
            weeklyNote: '今週はボラ圧縮期の精度が高かった',
        };
        const result = validateDiscoveryOutput(output, availableLenses);
        expect(result.newHypotheses).toHaveLength(1);
        expect(result.weeklyNote).toContain('ボラ');
    });

    it('架空レンズ名を拒否', () => {
        const output = {
            interpretations: [],
            newHypotheses: [
                {
                    statement: '架空レンズを使った仮説のテストケース',
                    category: 'other',
                    expectedDirection: 'long',
                    reasoning: '理由テキスト',
                    conditions: [
                        { lensName: 'ghost_lens', featureKey: 'x', op: '>', value: 1 },
                        { lensName: 'dow_theory', featureKey: 'trend_state', op: '==', value: 'uptrend' },
                    ],
                },
            ],
            weeklyNote: '',
        };
        expect(() => validateDiscoveryOutput(output, availableLenses)).toThrow(/unknown lensName/);
    });
});

describe('DiscoveryAgent.analyze', () => {
    let agent: DiscoveryAgent;
    let stub: ReturnType<typeof makeLedgerStub>;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.AI_API_KEY = 'test-key';
        stub = makeLedgerStub();
        agent = new DiscoveryAgent({ minSeparationScore: 0.1 }, stub.ledger);
    });

    afterEach(() => {
        delete process.env.AI_API_KEY;
    });

    it('ノートがない場合は空レポート', async () => {
        const report = await agent.analyze([], new Date('2026-04-10'), new Date('2026-04-17'));
        expect(report.newHypotheses).toEqual([]);
        expect(report.lensInsights).toEqual([]);
        expect(report.analyzedTradeCount).toBe(0);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('API キー未設定では LLM を呼ばず統計のみ', async () => {
        delete process.env.AI_API_KEY;
        agent = new DiscoveryAgent({ apiKey: '', minSeparationScore: 0.1 }, stub.ledger);

        const notes: AITradeNote[] = [
            makeNote('win', { volatility_regime: { bb_width_percentile: 10 } }),
            makeNote('win', { volatility_regime: { bb_width_percentile: 12 } }),
            makeNote('win', { volatility_regime: { bb_width_percentile: 15 } }),
            makeNote('loss', { volatility_regime: { bb_width_percentile: 70 } }),
            makeNote('loss', { volatility_regime: { bb_width_percentile: 80 } }),
            makeNote('loss', { volatility_regime: { bb_width_percentile: 75 } }),
        ];

        const report = await agent.analyze(notes, new Date('2026-04-10'), new Date('2026-04-17'));
        expect(report.lensInsights.length).toBeGreaterThan(0);
        expect(report.newHypotheses).toEqual([]);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    // STEP 5 Phase D (2026-05-16): Discovery が `newHypotheses` を EdgeLedger に
    // 直接挿入していたブロックを削除した変更を verify。Discovery は調査員役で、
    // 仮説生成は HypothesisGenerator の責務。LLM が newHypotheses を返しても
    // EdgeLedger には書き込まない (= report.newHypotheses は常に []、stub.created
    // は 0 件)。
    it('LLM が newHypotheses を返しても EdgeLedger には書き込まない (調査員役を遵守)', async () => {
        mockFetchWith({
            interpretations: [
                {
                    lensName: 'volatility_regime',
                    featureKey: 'bb_width_percentile',
                    interpretation: '低パーセンタイルで勝率が高い',
                },
            ],
            newHypotheses: [
                {
                    statement: '低ボラ期間中の順張りは勝率が高い',
                    category: 'volatility',
                    expectedDirection: 'either',
                    reasoning: 'ボラ圧縮後のブレイクは継続しやすい',
                    conditions: [
                        { lensName: 'volatility_regime', featureKey: 'bb_width_percentile', op: '<', value: 20 },
                        { lensName: 'volatility_regime', featureKey: 'is_squeeze', op: '==', value: true },
                    ],
                },
            ],
            weeklyNote: '今週の主要発見',
        });

        const notes: AITradeNote[] = [
            makeNote('win', { volatility_regime: { bb_width_percentile: 10, is_squeeze: true } }),
            makeNote('win', { volatility_regime: { bb_width_percentile: 12, is_squeeze: true } }),
            makeNote('win', { volatility_regime: { bb_width_percentile: 15, is_squeeze: true } }),
            makeNote('loss', { volatility_regime: { bb_width_percentile: 70, is_squeeze: false } }),
            makeNote('loss', { volatility_regime: { bb_width_percentile: 80, is_squeeze: false } }),
            makeNote('loss', { volatility_regime: { bb_width_percentile: 75, is_squeeze: false } }),
        ];

        const report = await agent.analyze(notes, new Date('2026-04-10'), new Date('2026-04-17'));
        // Discovery は調査員役のため、LLM が newHypotheses を返しても EdgeLedger には
        // 挿入しない。report.newHypotheses は常に空配列、stub.created も 0 件。
        expect(report.newHypotheses).toEqual([]);
        expect(stub.created).toHaveLength(0);
        expect(report.weeklyNote).toBe('今週の主要発見');
        expect(report.tokenUsage).toBe(800);
    });

    it('解析後に hintsForHG を AgentMemory にキャッシュする (Critical-7)', async () => {
        agentMemory.clearLatestDiscoveryHints();
        mockFetchWith({
            interpretations: [],
            newHypotheses: [],
            hintsForHG: [
                {
                    promisingDirection: 'low_vol_breakout',
                    lensFocusAreas: ['volatility_regime'],
                    rationale: 'BB幅が極小のとき後続のブレイクが優位',
                },
            ],
            weeklyNote: '',
        });

        const notes: AITradeNote[] = [
            makeNote('win', { volatility_regime: { bb_width_percentile: 10, is_squeeze: true } }),
            makeNote('win', { volatility_regime: { bb_width_percentile: 12, is_squeeze: true } }),
            makeNote('win', { volatility_regime: { bb_width_percentile: 15, is_squeeze: true } }),
            makeNote('loss', { volatility_regime: { bb_width_percentile: 70, is_squeeze: false } }),
            makeNote('loss', { volatility_regime: { bb_width_percentile: 80, is_squeeze: false } }),
            makeNote('loss', { volatility_regime: { bb_width_percentile: 75, is_squeeze: false } }),
        ];

        await agent.analyze(notes, new Date('2026-04-10'), new Date('2026-04-17'));

        const cached = agentMemory.getLatestDiscoveryHints();
        expect(cached).toBeDefined();
        expect(cached?.hints).toHaveLength(1);
        expect(cached?.hints[0].promisingDirection).toBe('low_vol_breakout');
        expect(cached?.analyzedTradeCount).toBe(notes.length);

        // 後続テストへの影響を避けるためクリア
        agentMemory.clearLatestDiscoveryHints();
    });

    it('LLM 失敗時も統計結果だけ返す', async () => {
        (global.fetch as jest.Mock).mockRejectedValue(new Error('boom'));

        const notes: AITradeNote[] = [
            makeNote('win', { volatility_regime: { bb_width_percentile: 10 } }),
            makeNote('win', { volatility_regime: { bb_width_percentile: 12 } }),
            makeNote('win', { volatility_regime: { bb_width_percentile: 15 } }),
            makeNote('loss', { volatility_regime: { bb_width_percentile: 70 } }),
            makeNote('loss', { volatility_regime: { bb_width_percentile: 80 } }),
            makeNote('loss', { volatility_regime: { bb_width_percentile: 75 } }),
        ];

        const report = await agent.analyze(notes, new Date(), new Date());
        expect(report.newHypotheses).toEqual([]);
        expect(report.lensInsights.length).toBeGreaterThan(0);
    });
});
