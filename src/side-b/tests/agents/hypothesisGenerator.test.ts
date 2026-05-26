/**
 * HypothesisGeneratorAgent のテスト（Phase 4a）
 */

import {
    HypothesisGeneratorAgent,
    validateHypothesisGeneratorOutput,
} from '../../agents/HypothesisGeneratorAgent';
import type { LensFeatureSnapshot, LensFeature } from '../../lenses';
import type { EdgeHypothesis } from '../../models/edgeHypothesis';

global.fetch = jest.fn();

function makeSnapshot(): LensFeatureSnapshot {
    const features = new Map<string, LensFeature>();
    features.set('dow_theory', {
        lensName: 'dow_theory',
        lensVersion: '1.0.0',
        features: { trend_state: 'uptrend', trend_phase: 'early' },
        computedAt: new Date(),
        computeDurationMs: 1,
        confidence: 0.8,
    });
    features.set('volatility_regime', {
        lensName: 'volatility_regime',
        lensVersion: '1.0.0',
        features: { bb_width_percentile: 25, is_squeeze: false },
        computedAt: new Date(),
        computeDurationMs: 1,
        confidence: 0.9,
    });
    return {
        timestamp: new Date(),
        symbol: 'XAUUSD',
        features,
        totalComputeDurationMs: 2,
    };
}

function mockFetchWith(output: unknown) {
    (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
            Promise.resolve({
                choices: [{ message: { content: JSON.stringify(output) } }],
                usage: { total_tokens: 500 },
                model: 'gpt-4o',
            }),
    });
}

const validOutput = {
    hypotheses: [
        {
            statement: '上昇トレンド初期でボラが圧縮されているとき、押し目買いが有効である',
            category: 'structure',
            expectedDirection: 'long',
            reasoning: '低ボラ期間の蓄積後、トレンド初期は継続確率が高い市場構造がある',
            conditions: [
                { lensName: 'dow_theory', featureKey: 'trend_state', op: '==', value: 'uptrend' },
                { lensName: 'volatility_regime', featureKey: 'bb_width_percentile', op: '<', value: 30 },
            ],
            lensRelevance: { dow_theory: 0.8, volatility_regime: 0.7 },
        },
    ],
    noveltyClaim: '既存仮説には「トレンド初期×ボラ圧縮」の組み合わせがないため新規',
};

describe('validateHypothesisGeneratorOutput', () => {
    const snapshot = makeSnapshot();

    it('正常な出力を受け入れる', () => {
        const result = validateHypothesisGeneratorOutput(validOutput, snapshot);
        expect(result.hypotheses).toHaveLength(1);
        expect(result.hypotheses[0].category).toBe('structure');
    });

    it('架空のレンズを使うと拒否', () => {
        const bad = {
            ...validOutput,
            hypotheses: [
                {
                    ...validOutput.hypotheses[0],
                    conditions: [
                        { lensName: 'fake_lens', featureKey: 'x', op: '>', value: 10 },
                        { lensName: 'dow_theory', featureKey: 'trend_state', op: '==', value: 'uptrend' },
                    ],
                },
            ],
        };
        expect(() => validateHypothesisGeneratorOutput(bad, snapshot)).toThrow(/unknown lensName/);
    });

    it('条件が1個以下だと拒否', () => {
        const bad = {
            ...validOutput,
            hypotheses: [
                {
                    ...validOutput.hypotheses[0],
                    conditions: [
                        { lensName: 'dow_theory', featureKey: 'trend_state', op: '==', value: 'uptrend' },
                    ],
                },
            ],
        };
        expect(() => validateHypothesisGeneratorOutput(bad, snapshot)).toThrow(/2-5/);
    });

    it('不正な category を拒否', () => {
        const bad = {
            ...validOutput,
            hypotheses: [
                {
                    ...validOutput.hypotheses[0],
                    category: 'invalid_category',
                },
            ],
        };
        expect(() => validateHypothesisGeneratorOutput(bad, snapshot)).toThrow(/invalid category/);
    });

    it('空の hypotheses を受け入れる（新規性がない場合）', () => {
        const result = validateHypothesisGeneratorOutput(
            { hypotheses: [], noveltyClaim: '既存と重複' },
            snapshot,
        );
        expect(result.hypotheses).toEqual([]);
    });
});

describe('HypothesisGeneratorAgent.generate', () => {
    let agent: HypothesisGeneratorAgent;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.AI_API_KEY = 'test-key';
        agent = new HypothesisGeneratorAgent();
    });

    afterEach(() => {
        delete process.env.AI_API_KEY;
    });

    it('API キー未設定で空を返す', async () => {
        agent = new HypothesisGeneratorAgent({ apiKey: '' });
        const result = await agent.generate({
            symbol: 'XAUUSD',
            timeframe: '15m',
            lensSnapshot: makeSnapshot(),
            existingHypotheses: [],
        });
        expect(result.output.hypotheses).toEqual([]);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('正常応答を処理', async () => {
        mockFetchWith(validOutput);
        const result = await agent.generate({
            symbol: 'XAUUSD',
            timeframe: '15m',
            lensSnapshot: makeSnapshot(),
            existingHypotheses: [],
        });
        expect(result.output.hypotheses).toHaveLength(1);
        expect(result.tokenUsage).toBe(500);
    });

    it('Phase 6.8: indicatorAnalysis 未指定時は prompt に IndicatorSpecialist セクションが含まれない', async () => {
        mockFetchWith(validOutput);
        await agent.generate({
            symbol: 'XAUUSD',
            timeframe: '15m',
            lensSnapshot: makeSnapshot(),
            existingHypotheses: [],
        });
        const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);
        const userMessage = body.messages.find((m: { role: string }) => m.role === 'user').content;
        expect(userMessage).not.toContain('IndicatorSpecialist 分析');
    });

    it('Phase 6.8: indicatorAnalysis 指定時は prompt に IndicatorSpecialist 分析セクションが注入される', async () => {
        mockFetchWith(validOutput);
        await agent.generate({
            symbol: 'XAUUSD',
            timeframe: '15m',
            lensSnapshot: makeSnapshot(),
            existingHypotheses: [],
            indicatorAnalysis: {
                interpretation: 'テクニカル統合解釈、RSI と MACD の根拠による上昇継続シグナル',
                confidence: 0.7,
                current: {
                    trendState: 'weak_up',
                    trendStrength: 0.6,
                    trendMaturity: 'middle',
                    keyLevels: { support: [1.4], resistance: [1.55] },
                    momentum: 'bullish',
                    divergence: 'none',
                    volatilityRegime: 'normal',
                    breakoutRisk: 'medium',
                    volumeSignal: 'normal',
                },
                higher: {
                    trendState: 'weak_up',
                    trendStrength: 0.5,
                    keyLevels: { support: [1.35], resistance: [1.6] },
                    momentum: 'bullish',
                },
                mtfAlignment: {
                    trendAlignment: 'aligned_bullish',
                    pullbackOpportunity: false,
                    counterTrendSignal: false,
                },
                primaryIndicators: { current: ['rsi', 'macd'], higher: ['ichimoku'] },
            },
        });
        const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);
        const userMessage = body.messages.find((m: { role: string }) => m.role === 'user').content;
        expect(userMessage).toContain('IndicatorSpecialist 分析');
        expect(userMessage).toContain('aligned_bullish');
    });

    it('fetch エラー時は空を返す（throw しない）', async () => {
        (global.fetch as jest.Mock).mockRejectedValue(new Error('network down'));
        const result = await agent.generate({
            symbol: 'XAUUSD',
            timeframe: '15m',
            lensSnapshot: makeSnapshot(),
            existingHypotheses: [],
        });
        expect(result.output.hypotheses).toEqual([]);
    });

    it('空 lensSnapshot の場合はスキップ', async () => {
        const emptySnap: LensFeatureSnapshot = {
            timestamp: new Date(),
            symbol: 'XAUUSD',
            features: new Map(),
            totalComputeDurationMs: 0,
        };
        const result = await agent.generate({
            symbol: 'XAUUSD',
            timeframe: '15m',
            lensSnapshot: emptySnap,
            existingHypotheses: [],
        });
        expect(result.output.hypotheses).toEqual([]);
        expect(global.fetch).not.toHaveBeenCalled();
    });
});

describe('HypothesisGeneratorAgent.toCreateInputs', () => {
    const agent = new HypothesisGeneratorAgent({ apiKey: '' });
    const snapshot = makeSnapshot();

    it('既存仮説と重複するものを除外する', () => {
        const existing: EdgeHypothesis[] = [
            {
                id: 'e1',
                statement: '上昇トレンド初期でボラが圧縮されているとき、押し目買いが有効である',
                category: 'structure',
                conditions: [],
                expectedDirection: 'long',
                status: 'unverified',
                statusUpdatedAt: new Date(),
                symbols: ['XAUUSD'],
                timeframes: ['15m'],
                observationCount: 0,
                winCount: 0,
                lossCount: 0,
                breakevenCount: 0,
                totalPnlPips: 0,
                avgRR: 0,
                source: 'ai_generated',
                firstObservedAt: new Date(),
                lastObservedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ];
        const validated = validateHypothesisGeneratorOutput(validOutput, snapshot);
        const inputs = agent.toCreateInputs(validated, {
            symbol: 'XAUUSD',
            timeframe: '15m',
            lensSnapshot: snapshot,
            existingHypotheses: existing,
        });
        expect(inputs).toEqual([]);
    });

    it('新規のみ CreateInput に変換', () => {
        const validated = validateHypothesisGeneratorOutput(validOutput, snapshot);
        const inputs = agent.toCreateInputs(validated, {
            symbol: 'XAUUSD',
            timeframe: '15m',
            lensSnapshot: snapshot,
            existingHypotheses: [],
        });
        expect(inputs).toHaveLength(1);
        expect(inputs[0].status).toBe('unverified');
        expect(inputs[0].source).toBe('ai_generated');
        expect(inputs[0].symbols).toEqual(['XAUUSD']);
    });
});
