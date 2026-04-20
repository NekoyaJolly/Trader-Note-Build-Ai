/**
 * DiscoveryAgent（Phase 4a）
 *
 * 責務: 過去 N 日分の AITradeNote を集計し、勝敗を分けている
 *       レンズ特徴量を統計的に抽出 → LLM で解釈 → 新仮説を EdgeLedger に登録。
 *
 * 設計原則（CLAUDE.md 原則3）:
 * - 統計計算は TypeScript の決定論的コード（discoveryStats.ts）で実行
 * - LLM は「構造発見 / 解釈 / 命名」だけ担当
 * - 新規仮説は EdgeLedger に unverified で追加（Phase 4b で validator が検証）
 *
 * @see docs/design/phase_4_specification.md セクション4.6
 */

import { config, modelFor } from '../../config';
import { loadPrompt } from '../prompts/loader';
import type { AITradeNote } from '../models/aiTradeNote';
import type {
    EdgeHypothesis,
    CreateEdgeHypothesisInput,
    EdgeCategory,
    MachineReadableCondition,
} from '../models/edgeHypothesis';
import {
    isEdgeCategory,
    validateCondition,
} from '../models/edgeHypothesis';
import {
    aggregateFeatureValues,
    computeFeatureSeparations,
    type FeatureSeparation,
} from './discoveryStats';
import type { EdgeLedger } from '../ledger/EdgeLedger';
import { edgeLedger as defaultLedger } from '../ledger/EdgeLedger';

// ===========================================
// 型定義
// ===========================================

/**
 * 週次レポート
 */
export interface WeeklyDiscoveryReport {
    periodStart: Date;
    periodEnd: Date;
    analyzedTradeCount: number;

    lensInsights: Array<{
        lensName: string;
        effectiveFeatures: Array<{
            featureKey: string;
            separationScore: number;
            interpretation: string;
        }>;
    }>;

    /** 新規登録された仮説（既存と重複しなかったもの） */
    newHypotheses: EdgeHypothesis[];
    /** Phase 4b で promotion 対象として推薦 */
    promotionCandidates: string[];
    /** stale 推薦 */
    staleCandidates: string[];

    /** LLM 所感 */
    weeklyNote?: string;
    /** 使用トークン */
    tokenUsage: number;
    /** 使用モデル */
    model: string;
}

interface DiscoveryLLMOutput {
    interpretations: Array<{
        lensName: string;
        featureKey: string;
        interpretation: string;
    }>;
    newHypotheses: Array<{
        statement: string;
        category: EdgeCategory;
        expectedDirection: 'long' | 'short' | 'either';
        reasoning: string;
        conditions: MachineReadableCondition[];
        lensRelevance?: Record<string, number>;
    }>;
    weeklyNote: string;
}

// ===========================================
// バリデーション
// ===========================================

export function validateDiscoveryOutput(
    data: unknown,
    availableLenses: ReadonlySet<string>,
): DiscoveryLLMOutput {
    if (!data || typeof data !== 'object') {
        throw new Error('Discovery output must be an object');
    }
    const obj = data as Record<string, unknown>;

    if (!Array.isArray(obj.interpretations)) {
        throw new Error('interpretations must be an array');
    }
    const interpretations = (obj.interpretations as unknown[]).map((raw, i) => {
        const r = raw as Record<string, unknown>;
        if (
            typeof r.lensName !== 'string' ||
            typeof r.featureKey !== 'string' ||
            typeof r.interpretation !== 'string'
        ) {
            throw new Error(`interpretations[${i}]: missing fields`);
        }
        return {
            lensName: r.lensName,
            featureKey: r.featureKey,
            interpretation: r.interpretation,
        };
    });

    if (!Array.isArray(obj.newHypotheses)) {
        throw new Error('newHypotheses must be an array');
    }

    const newHypotheses = (obj.newHypotheses as unknown[]).map((raw, i) => {
        const h = raw as Record<string, unknown>;
        if (typeof h.statement !== 'string' || h.statement.length < 10) {
            throw new Error(`newHypotheses[${i}]: invalid statement`);
        }
        if (!isEdgeCategory(h.category)) {
            throw new Error(`newHypotheses[${i}]: invalid category`);
        }
        if (
            h.expectedDirection !== 'long' &&
            h.expectedDirection !== 'short' &&
            h.expectedDirection !== 'either'
        ) {
            throw new Error(`newHypotheses[${i}]: invalid expectedDirection`);
        }
        if (typeof h.reasoning !== 'string') {
            throw new Error(`newHypotheses[${i}]: invalid reasoning`);
        }
        if (!Array.isArray(h.conditions) || h.conditions.length < 2 || h.conditions.length > 5) {
            throw new Error(`newHypotheses[${i}]: conditions must be 2-5`);
        }
        const conditions = (h.conditions as unknown[]).map(validateCondition);
        for (const c of conditions) {
            if (!availableLenses.has(c.lensName)) {
                throw new Error(
                    `newHypotheses[${i}]: unknown lensName "${c.lensName}"`,
                );
            }
        }
        const lensRelevance =
            h.lensRelevance && typeof h.lensRelevance === 'object'
                ? Object.fromEntries(
                      Object.entries(h.lensRelevance as Record<string, unknown>)
                          .filter(([, v]) => typeof v === 'number')
                          .map(([k, v]) => [k, Math.max(0, Math.min(1, v as number))]),
                  )
                : undefined;

        return {
            statement: h.statement as string,
            category: h.category as EdgeCategory,
            expectedDirection: h.expectedDirection as 'long' | 'short' | 'either',
            reasoning: h.reasoning as string,
            conditions,
            ...(lensRelevance ? { lensRelevance } : {}),
        };
    });

    return {
        interpretations,
        newHypotheses,
        weeklyNote: typeof obj.weeklyNote === 'string' ? obj.weeklyNote : '',
    };
}

// ===========================================
// エージェント本体
// ===========================================

export interface DiscoveryAgentConfig {
    apiKey?: string;
    baseURL?: string;
    model?: string;
    /** 分析対象の最大ノート数（コスト制御） */
    maxNotes?: number;
    /** 分離度スコアのしきい値（これ未満は LLM に渡さない） */
    minSeparationScore?: number;
    /** LLM に渡す上位 N 個の特徴量 */
    topFeatureCount?: number;
}

export class DiscoveryAgent {
    private apiKey: string;
    private baseURL: string;
    private model: string;
    private maxNotes: number;
    private minSeparationScore: number;
    private topFeatureCount: number;
    private ledger: EdgeLedger;

    constructor(cfg?: DiscoveryAgentConfig, ledger?: EdgeLedger) {
        this.apiKey =
            cfg?.apiKey !== undefined
                ? cfg.apiKey
                : process.env.AI_API_KEY || config.ai.apiKey || '';
        this.baseURL =
            cfg?.baseURL !== undefined
                ? cfg.baseURL
                : process.env.AI_BASE_URL || config.ai.baseURL || 'https://api.openai.com/v1';
        this.model =
            cfg?.model !== undefined
                ? cfg.model
                : modelFor('discovery');
        this.maxNotes = cfg?.maxNotes ?? 1000;
        this.minSeparationScore = cfg?.minSeparationScore ?? 0.3;
        this.topFeatureCount = cfg?.topFeatureCount ?? 10;
        this.ledger = ledger ?? defaultLedger;
    }

    /**
     * 指定期間の AITradeNote からレンズ分析を行い、新規仮説を登録する。
     */
    async analyze(
        notes: readonly AITradeNote[],
        periodStart: Date,
        periodEnd: Date,
    ): Promise<WeeklyDiscoveryReport> {
        const truncated = notes.length > this.maxNotes ? notes.slice(-this.maxNotes) : notes;

        // 1. 統計集計（TypeScript）
        const splits = aggregateFeatureValues(truncated);
        const allSeparations = computeFeatureSeparations(splits);
        const topSeparations = allSeparations
            .filter((s) => s.separationScore >= this.minSeparationScore)
            .slice(0, this.topFeatureCount);

        // 2. LLM に解釈 + 新仮説生成を依頼
        const availableLenses = new Set<string>();
        for (const s of allSeparations) availableLenses.add(s.lensName);

        let llmOutput: DiscoveryLLMOutput = {
            interpretations: [],
            newHypotheses: [],
            weeklyNote: '',
        };
        let tokenUsage = 0;
        let usedModel = 'empty';

        if (topSeparations.length > 0 && this.apiKey) {
            try {
                const systemPrompt = loadPrompt('discovery');
                const userPrompt = this.buildUserPrompt(
                    truncated.length,
                    periodStart,
                    periodEnd,
                    topSeparations,
                );
                const raw = await this.callAI(systemPrompt, userPrompt);
                llmOutput = validateDiscoveryOutput(raw.content, availableLenses);
                tokenUsage = raw.tokenUsage;
                usedModel = raw.model;
            } catch (error) {
                console.error('[DiscoveryAgent] LLM 解釈失敗:', error);
            }
        } else if (!this.apiKey) {
            console.warn('[DiscoveryAgent] APIキー未設定。統計集計のみ返します。');
        }

        // 3. 新仮説を EdgeLedger に登録（重複は除外）
        const existing = await this.ledger.findByStatus('unverified');
        const existingConfirmed = await this.ledger.findByStatus('confirmed');
        const allExisting = [...existing, ...existingConfirmed];

        const newHypotheses: EdgeHypothesis[] = [];
        const symbolsInNotes = Array.from(new Set(truncated.map((n) => n.symbol)));
        for (const h of llmOutput.newHypotheses) {
            if (this.isDuplicate(h.statement, allExisting)) continue;
            const input: CreateEdgeHypothesisInput = {
                statement: h.statement,
                category: h.category,
                conditions: h.conditions,
                expectedDirection: h.expectedDirection,
                status: 'unverified',
                symbols: symbolsInNotes.length > 0 ? symbolsInNotes : [],
                timeframes: [],
                observationCount: 0,
                winCount: 0,
                lossCount: 0,
                breakevenCount: 0,
                totalPnlPips: 0,
                avgRR: 0,
                source: 'discovery',
                lensRelevance: h.lensRelevance,
                parentIds: [],
                relatedNoteIds: [],
            };
            const created = await this.ledger.create(input);
            newHypotheses.push(created);
        }

        // 4. レポート整形
        const lensInsights = this.groupByLens(topSeparations, llmOutput.interpretations);

        return {
            periodStart,
            periodEnd,
            analyzedTradeCount: truncated.length,
            lensInsights,
            newHypotheses,
            promotionCandidates: [], // Phase 4b で EdgeValidator と統合
            staleCandidates: [],
            weeklyNote: llmOutput.weeklyNote,
            tokenUsage,
            model: usedModel,
        };
    }

    // ===========================================
    // 内部
    // ===========================================

    private buildUserPrompt(
        tradeCount: number,
        periodStart: Date,
        periodEnd: Date,
        separations: readonly FeatureSeparation[],
    ): string {
        const lines: string[] = [
            `# 週次レンズ有効性レポート リクエスト`,
            ``,
            `## 期間`,
            `- 開始: ${periodStart.toISOString()}`,
            `- 終了: ${periodEnd.toISOString()}`,
            `- 分析対象トレード数: ${tradeCount}`,
            ``,
            `## 統計分析結果（分離度スコア降順）`,
        ];

        for (const s of separations) {
            lines.push(
                `### ${s.lensName} / ${s.featureKey}（分離度: ${s.separationScore.toFixed(3)}, 勝${s.winSampleCount} vs 負${s.lossSampleCount}）`,
            );
            if (s.numericSummary) {
                lines.push(
                    `- 勝ち時: 平均 ${s.numericSummary.winMean.toFixed(3)}, 標準偏差 ${s.numericSummary.winStd.toFixed(3)}`,
                    `- 負け時: 平均 ${s.numericSummary.lossMean.toFixed(3)}, 標準偏差 ${s.numericSummary.lossStd.toFixed(3)}`,
                );
            } else if (s.categoricalSummary) {
                lines.push(
                    `- ベース勝率: ${(s.categoricalSummary.baseWinRate * 100).toFixed(1)}%`,
                );
                for (const [k, rate] of Object.entries(
                    s.categoricalSummary.conditionalWinRate,
                )) {
                    lines.push(
                        `  - ${k} のとき勝率: ${(rate * 100).toFixed(1)}%（差分 ${((rate - s.categoricalSummary.baseWinRate) * 100).toFixed(1)}pp）`,
                    );
                }
            }
        }

        lines.push(
            ``,
            `上記データを解釈し、interpretations と newHypotheses を JSON で出力してください。`,
        );

        return lines.join('\n');
    }

    private groupByLens(
        separations: readonly FeatureSeparation[],
        interpretations: DiscoveryLLMOutput['interpretations'],
    ): WeeklyDiscoveryReport['lensInsights'] {
        const interpMap = new Map<string, string>();
        for (const i of interpretations) {
            interpMap.set(`${i.lensName}::${i.featureKey}`, i.interpretation);
        }

        const grouped = new Map<string, WeeklyDiscoveryReport['lensInsights'][number]>();
        for (const s of separations) {
            if (!grouped.has(s.lensName)) {
                grouped.set(s.lensName, { lensName: s.lensName, effectiveFeatures: [] });
            }
            grouped.get(s.lensName)!.effectiveFeatures.push({
                featureKey: s.featureKey,
                separationScore: s.separationScore,
                interpretation: interpMap.get(`${s.lensName}::${s.featureKey}`) ?? '',
            });
        }
        return Array.from(grouped.values());
    }

    private isDuplicate(
        statement: string,
        existing: readonly EdgeHypothesis[],
    ): boolean {
        const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
        const target = normalize(statement);
        if (target.length === 0) return true;
        for (const e of existing) {
            const n = normalize(e.statement);
            if (n === target) return true;
            if (
                Math.abs(n.length - target.length) < 20 &&
                n.substring(0, 60) === target.substring(0, 60)
            ) {
                return true;
            }
        }
        return false;
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
                temperature: 0.5,
                max_tokens: 3500,
            }),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Discovery API エラー: ${response.status} - ${body}`);
        }

        const data = (await response.json()) as {
            choices?: { message?: { content?: string } }[];
            usage?: { total_tokens?: number };
            model?: string;
        };

        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('Discovery API からの応答が空です');
        }

        return {
            content: JSON.parse(content),
            tokenUsage: data.usage?.total_tokens || 0,
            model: data.model || this.model,
        };
    }
}

export const discoveryAgent = new DiscoveryAgent();
