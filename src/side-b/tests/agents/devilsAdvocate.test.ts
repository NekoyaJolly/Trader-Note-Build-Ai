/**
 * DevilsAdvocateAgent のテスト
 *
 * モック戦略: fetch をモックし、AI API 呼び出しを制御する。
 * 実 API は叩かない（料金発生なし）。
 */

import {
    DevilsAdvocateAgent,
    validateDevilsAdvocateOutput,
} from '../../agents/DevilsAdvocateAgent';
import type { AITradeScenario, PlanMarketAnalysis } from '../../models';

global.fetch = jest.fn();

const mockScenario: AITradeScenario = {
    id: 'test-1',
    name: 'レンジ下限反発シナリオ',
    direction: 'long',
    priority: 'primary',
    entry: {
        type: 'limit',
        price: 2620,
        condition: 'BB下限かつRSI<30',
        triggerIndicators: ['BB', 'RSI'],
    },
    stopLoss: { price: 2605, pips: 15, reason: 'サポート割れ' },
    takeProfit: { price: 2660, pips: 40, reason: '中心線到達' },
    riskReward: 2.67,
    confidence: 65,
    rationale: 'レンジ下限からの反発を狙う',
    invalidationConditions: ['2605割れ'],
};

const mockMarket: PlanMarketAnalysis = {
    regime: 'range',
    regimeConfidence: 75,
    trendDirection: 'sideways',
    volatility: 'medium',
    keyLevels: {
        strongResistance: [2680],
        resistance: [2660],
        support: [2620],
        strongSupport: [2600],
    },
    summary: 'レンジ相場継続',
    additionalInsights: [],
};

function mockAIResponse(output: unknown) {
    (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
            Promise.resolve({
                choices: [{ message: { content: JSON.stringify(output) } }],
                usage: { total_tokens: 900 },
                model: 'gpt-4o',
            }),
    });
}

describe('validateDevilsAdvocateOutput', () => {
    const validOutput = {
        failureScenarios: [
            {
                description: '2620を一時的に下抜けしてSL',
                triggerConditions: '米雇用統計サプライズ',
                estimatedLikelihood: 'medium',
            },
        ],
        weakestAssumption: {
            description: 'レンジ継続の仮定',
            whyVulnerable: '上位足ではトレンドが出ている',
        },
        recommendation: {
            action: 'proceed',
            rationale: '概ね妥当',
        },
    };

    it('正常な出力を受け入れる', () => {
        const result = validateDevilsAdvocateOutput(validOutput);
        expect(result.recommendation.action).toBe('proceed');
        expect(result.failureScenarios).toHaveLength(1);
    });

    it('不正な action を拒否する', () => {
        const bad = {
            ...validOutput,
            recommendation: { action: 'invalid_action', rationale: 'x' },
        };
        expect(() => validateDevilsAdvocateOutput(bad)).toThrow(/recommendation\.action/);
    });

    it('不正な estimatedLikelihood を拒否する', () => {
        const bad = {
            ...validOutput,
            failureScenarios: [
                {
                    description: 'x',
                    triggerConditions: 'y',
                    estimatedLikelihood: 'extreme',
                },
            ],
        };
        expect(() => validateDevilsAdvocateOutput(bad)).toThrow(/estimatedLikelihood/);
    });

    it('必須フィールド欠落を拒否する (weakestAssumption)', () => {
        const bad = { ...validOutput, weakestAssumption: undefined };
        expect(() => validateDevilsAdvocateOutput(bad)).toThrow(/weakestAssumption/);
    });

    it('オブジェクトでない入力を拒否する', () => {
        expect(() => validateDevilsAdvocateOutput(null)).toThrow();
        expect(() => validateDevilsAdvocateOutput('string')).toThrow();
    });

    it('suggestedModifications は省略可', () => {
        const result = validateDevilsAdvocateOutput(validOutput);
        expect(result.recommendation.suggestedModifications).toBeUndefined();
    });

    it('suggestedModifications があれば文字列配列として返す', () => {
        const withMods = {
            ...validOutput,
            recommendation: {
                action: 'modify',
                rationale: 'SLを広げるべき',
                suggestedModifications: ['SLを2600まで広げる', 'エントリー価格を下げる'],
            },
        };
        const result = validateDevilsAdvocateOutput(withMods);
        expect(result.recommendation.suggestedModifications).toEqual([
            'SLを2600まで広げる',
            'エントリー価格を下げる',
        ]);
    });
});

describe('DevilsAdvocateAgent.critique', () => {
    let agent: DevilsAdvocateAgent;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.AI_API_KEY = 'test-key';
        agent = new DevilsAdvocateAgent();
    });

    afterEach(() => {
        delete process.env.AI_API_KEY;
    });

    it('正常応答をパースして返す', async () => {
        mockAIResponse({
            failureScenarios: [
                {
                    description: 'レンジ下抜け',
                    triggerConditions: '重要指標発表',
                    estimatedLikelihood: 'medium',
                },
            ],
            weakestAssumption: {
                description: 'レンジ継続',
                whyVulnerable: '上位足で下降圧力',
            },
            recommendation: {
                action: 'modify',
                rationale: 'SLを深くすべき',
                suggestedModifications: ['SLを2605→2590'],
            },
        });

        const result = await agent.critique(mockScenario, mockMarket);
        expect(result.output.recommendation.action).toBe('modify');
        expect(result.tokenUsage).toBe(900);
    });

    it('API キーなしでは fallback を返す', async () => {
        delete process.env.AI_API_KEY;
        agent = new DevilsAdvocateAgent({ apiKey: '' });

        const result = await agent.critique(mockScenario, mockMarket);
        expect(result.model).toBe('fallback');
        expect(result.output.recommendation.action).toBe('proceed');
        expect(result.tokenUsage).toBe(0);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('API エラー時は fallback を返す', async () => {
        (global.fetch as jest.Mock).mockRejectedValue(new Error('500 Internal'));

        const result = await agent.critique(mockScenario, mockMarket);
        expect(result.model).toBe('fallback');
        expect(result.output.recommendation.action).toBe('proceed');
    });

    it('不正な JSON ボディの時も fallback に落ちる', async () => {
        mockAIResponse({ invalid: 'schema' });

        const result = await agent.critique(mockScenario, mockMarket);
        expect(result.model).toBe('fallback');
    });

    it('abandon 判定は正しくパースされる', async () => {
        mockAIResponse({
            failureScenarios: [
                {
                    description: 'トレンド反転',
                    triggerConditions: '上位足でゴールデンクロス',
                    estimatedLikelihood: 'high',
                },
            ],
            weakestAssumption: {
                description: 'レンジ相場の前提',
                whyVulnerable: '既に上位足がトレンド入り',
            },
            recommendation: {
                action: 'abandon',
                rationale: '戦略の前提が崩れている',
            },
        });

        const result = await agent.critique(mockScenario, mockMarket);
        expect(result.output.recommendation.action).toBe('abandon');
    });
});
