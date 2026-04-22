/**
 * Devil's Advocate Agent
 *
 * 目的: Strategy Thinker が提案した戦略を受け取り、
 *       その戦略が失敗するシナリオを生成して弱点を暴く。
 *
 * 設計思想:
 * - 代替戦略は提案しない（純粋な反証専任）
 * - 出力は構造化 JSON（recommendation.action で後続処理を分岐）
 * - AIProvider を再利用（OpenAI 互換 API）
 *
 * 使い方:
 *   const agent = new DevilsAdvocateAgent();
 *   const critique = await agent.critique(scenario, marketAnalysis);
 *   if (critique.recommendation.action === 'abandon') { ... }
 */

import { config, modelFor } from '../../config';
import { loadPrompt } from '../prompts/loader';
import type { AITradeScenario, PlanMarketAnalysis } from '../models';

// ===========================================
// 型定義
// ===========================================

/**
 * Devil's Advocate の出力
 */
export interface DevilsAdvocateOutput {
    failureScenarios: Array<{
        description: string;
        triggerConditions: string;
        estimatedLikelihood: 'low' | 'medium' | 'high';
    }>;
    weakestAssumption: {
        description: string;
        whyVulnerable: string;
    };
    recommendation: {
        action: 'proceed' | 'modify' | 'abandon';
        rationale: string;
        suggestedModifications?: string[];
    };
}

/**
 * Devil's Advocate 実行結果（トークン使用量等のメタ情報付き）
 */
export interface DevilsAdvocateResult {
    output: DevilsAdvocateOutput;
    tokenUsage: number;
    model: string;
}

const VALID_ACTIONS = ['proceed', 'modify', 'abandon'] as const;
const VALID_LIKELIHOODS = ['low', 'medium', 'high'] as const;

// ===========================================
// バリデーション
// ===========================================

/**
 * AI レスポンスを DevilsAdvocateOutput にバリデーションして変換する
 */
export function validateDevilsAdvocateOutput(data: unknown): DevilsAdvocateOutput {
    if (!data || typeof data !== 'object') {
        throw new Error("Devil's Advocate output must be an object");
    }
    const obj = data as Record<string, unknown>;

    if (!Array.isArray(obj.failureScenarios)) {
        throw new Error('failureScenarios must be an array');
    }
    const failureScenarios = obj.failureScenarios.map((raw) => {
        const s = raw as Record<string, unknown>;
        if (typeof s.description !== 'string' || typeof s.triggerConditions !== 'string') {
            throw new Error('failureScenario missing description/triggerConditions');
        }
        const likelihood = s.estimatedLikelihood as string;
        if (!VALID_LIKELIHOODS.includes(likelihood as (typeof VALID_LIKELIHOODS)[number])) {
            throw new Error(`Invalid estimatedLikelihood: ${likelihood}`);
        }
        return {
            description: s.description,
            triggerConditions: s.triggerConditions,
            estimatedLikelihood: likelihood as DevilsAdvocateOutput['failureScenarios'][number]['estimatedLikelihood'],
        };
    });

    const wa = obj.weakestAssumption as Record<string, unknown> | undefined;
    if (!wa || typeof wa.description !== 'string' || typeof wa.whyVulnerable !== 'string') {
        throw new Error('weakestAssumption missing required fields');
    }

    const rec = obj.recommendation as Record<string, unknown> | undefined;
    if (!rec || typeof rec.rationale !== 'string') {
        throw new Error('recommendation missing rationale');
    }
    const action = rec.action as string;
    if (!VALID_ACTIONS.includes(action as (typeof VALID_ACTIONS)[number])) {
        throw new Error(`Invalid recommendation.action: ${action}`);
    }

    const suggestedModifications = Array.isArray(rec.suggestedModifications)
        ? (rec.suggestedModifications as unknown[]).map(String)
        : undefined;

    return {
        failureScenarios,
        weakestAssumption: {
            description: wa.description,
            whyVulnerable: wa.whyVulnerable,
        },
        recommendation: {
            action: action as DevilsAdvocateOutput['recommendation']['action'],
            rationale: rec.rationale,
            ...(suggestedModifications ? { suggestedModifications } : {}),
        },
    };
}

// ===========================================
// エージェント本体
// ===========================================

export interface DevilsAdvocateAgentConfig {
    apiKey?: string;
    baseURL?: string;
    model?: string;
}

export class DevilsAdvocateAgent {
    private apiKey: string;
    private baseURL: string;
    private model: string;

    constructor(cfg?: DevilsAdvocateAgentConfig) {
        // cfg で明示された値は空文字列も含めて尊重する（テストで "キーなし" を再現するため）
        this.apiKey = cfg?.apiKey !== undefined
            ? cfg.apiKey
            : (process.env.AI_API_KEY || config.ai.apiKey || '');
        this.baseURL = cfg?.baseURL !== undefined
            ? cfg.baseURL
            : (process.env.AI_BASE_URL || config.ai.baseURL || 'https://api.openai.com/v1');
        this.model = cfg?.model !== undefined
            ? cfg.model
            : modelFor('devils_advocate');
    }

    /**
     * 戦略シナリオを批評する。
     *
     * API キー未設定時は安全なデフォルト（proceed）を返し、上位ロジックを
     * 壊さないようにする。
     */
    async critique(
        scenario: Omit<AITradeScenario, 'id'> & { id?: string },
        marketContext: PlanMarketAnalysis,
    ): Promise<DevilsAdvocateResult> {
        if (!this.apiKey) {
            console.warn("[DevilsAdvocate] APIキー未設定。safe-default の proceed を返します。");
            return this.fallback('APIキー未設定のため、Devil\'s Advocate をスキップしました。');
        }

        try {
            const systemPrompt = loadPrompt('devils_advocate');
            const userPrompt = this.buildUserPrompt(scenario, marketContext);
            const raw = await this.callAI(systemPrompt, userPrompt);
            const validated = validateDevilsAdvocateOutput(raw.content);
            return {
                output: validated,
                tokenUsage: raw.tokenUsage,
                model: raw.model,
            };
        } catch (error) {
            console.error("[DevilsAdvocate] 批評失敗:", error);
            return this.fallback('Devil\'s Advocate の呼び出しに失敗しました。');
        }
    }

    private buildUserPrompt(
        scenario: Omit<AITradeScenario, 'id'> & { id?: string },
        context: PlanMarketAnalysis,
    ): string {
        return `# 戦略批評リクエスト

以下の戦略の弱点を3つ、最も脆弱な仮定を1つ、そして改善提案を出してください。
反証専任なので、戦略の擁護や代替提案はしないでください。

## 提案された戦略
\`\`\`json
${JSON.stringify(scenario, null, 2)}
\`\`\`

## 市場状況
\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\`

出力は指定された JSON 形式のみ。`;
    }

    private async callAI(
        systemPrompt: string,
        userPrompt: string,
    ): Promise<{ content: unknown; tokenUsage: number; model: string }> {
        const response = await fetch(`${this.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.4,
                max_tokens: 4096,
            }),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Devil's Advocate API エラー: ${response.status} - ${body}`);
        }

        const data = (await response.json()) as {
            choices?: { message?: { content?: string } }[];
            usage?: { total_tokens?: number };
            model?: string;
        };

        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error("Devil's Advocate API からの応答が空です");
        }

        return {
            content: JSON.parse(content),
            tokenUsage: data.usage?.total_tokens || 0,
            model: data.model || this.model,
        };
    }

    private fallback(rationale: string): DevilsAdvocateResult {
        return {
            output: {
                failureScenarios: [],
                weakestAssumption: {
                    description: 'Devil\'s Advocate をスキップしたため未評価',
                    whyVulnerable: rationale,
                },
                recommendation: {
                    action: 'proceed',
                    rationale,
                },
            },
            tokenUsage: 0,
            model: 'fallback',
        };
    }
}

export const devilsAdvocateAgent = new DevilsAdvocateAgent();
