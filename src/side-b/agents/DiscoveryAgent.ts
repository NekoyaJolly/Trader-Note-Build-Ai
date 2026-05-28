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
import { AI_MAX_TOKENS } from '../../config/aiTokenLimits';
import { loadPromptWithGlobal } from '../prompts/loader';
import { promptRegistry } from '../prompts/registry/PromptRegistry';
import { recordAgentUsage } from './scoringRecorder';
import type { AITradeNote } from '../models/aiTradeNote';
import { extractJson } from './llmJsonExtract';
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
import { agentMemory } from '../agent/agentMemory';
import type { JsonValue } from '../../utils/jsonValue';
import { AIProvider } from '../agent/aiProvider';
import { safeStringify } from '../../utils/safeStringify';

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
    /** Phase 6.7c: HG が読む週次探索ヒント */
    hintsForHG: Array<{
        promisingDirection: string;
        lensFocusAreas: string[];
        rationale: string;
    }>;
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
        lensName?: string;
        featureKey?: string;
        lensCombination?: string[];
        winRateDelta?: number;
        sampleSize?: number;
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
    hintsForHG: Array<{
        promisingDirection: string;
        lensFocusAreas: string[];
        rationale: string;
    }>;
    weeklyNote: string;
}

// ===========================================
// バリデーション
// ===========================================

export function validateDiscoveryOutput(
    data: JsonValue,
    availableLenses: ReadonlySet<string>,
): DiscoveryLLMOutput {
    if (!data || typeof data !== 'object') {
        throw new Error('Discovery output must be an object');
    }
    const obj = data as Record<string, JsonValue | undefined>;

    if (!Array.isArray(obj.interpretations)) {
        throw new Error('interpretations must be an array');
    }
    const interpretations = obj.interpretations.map((raw, i) => {
        const r = raw as Record<string, JsonValue | undefined>;
        if (typeof r.interpretation !== 'string') {
            throw new Error(`interpretations[${i}]: missing fields`);
        }
        const lensCombination = Array.isArray(r.lensCombination)
            ? r.lensCombination.filter((v): v is string => typeof v === 'string')
            : undefined;
        return {
            ...(typeof r.lensName === 'string' ? { lensName: r.lensName } : {}),
            ...(typeof r.featureKey === 'string' ? { featureKey: r.featureKey } : {}),
            ...(lensCombination && lensCombination.length > 0 ? { lensCombination } : {}),
            ...(typeof r.winRateDelta === 'number' ? { winRateDelta: r.winRateDelta } : {}),
            ...(typeof r.sampleSize === 'number' ? { sampleSize: r.sampleSize } : {}),
            interpretation: r.interpretation,
        };
    });

    const rawNewHypotheses = Array.isArray(obj.newHypotheses) ? obj.newHypotheses : [];
    const newHypotheses = rawNewHypotheses.map((raw, i) => {
        const h = raw as Record<string, JsonValue | undefined>;
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
        const conditions = h.conditions.map(validateCondition);
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
                      Object.entries(h.lensRelevance as Record<string, JsonValue | undefined>)
                          .filter(([, v]) => typeof v === 'number')
                          .map(([k, v]) => [k, Math.max(0, Math.min(1, v as number))]),
                  )
                : undefined;

        const expectedDirection: 'long' | 'short' | 'either' =
            h.expectedDirection === 'short'
                ? 'short'
                : h.expectedDirection === 'either'
                  ? 'either'
                  : 'long';
        return {
            statement: h.statement,
            category: h.category,
            expectedDirection,
            reasoning: h.reasoning,
            conditions,
            ...(lensRelevance ? { lensRelevance } : {}),
        };
    });
    const rawHints = Array.isArray(obj.hintsForHG) ? obj.hintsForHG : [];
    const hintsForHG = rawHints.map((raw, i) => {
        const h = raw as Record<string, JsonValue | undefined>;
        if (
            typeof h.promisingDirection !== 'string' ||
            !Array.isArray(h.lensFocusAreas) ||
            typeof h.rationale !== 'string'
        ) {
            throw new Error(`hintsForHG[${i}]: missing fields`);
        }
        const lensFocusAreas = h.lensFocusAreas.filter((v): v is string => typeof v === 'string');
        for (const lens of lensFocusAreas) {
            if (!availableLenses.has(lens)) {
                throw new Error(`hintsForHG[${i}]: unknown lens "${lens}"`);
            }
        }
        return {
            promisingDirection: h.promisingDirection,
            lensFocusAreas,
            rationale: h.rationale,
        };
    });

    return {
        interpretations,
        newHypotheses,
        hintsForHG,
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
    /**
     * Step D-4a: 組成役として newHypotheses を EdgeLedger に登録するか。
     * 既定は env `DISCOVERY_COMPOSE_ENABLED === 'true'`（未設定なら false）。
     * 観測導線 / UI が整う D-4b まで本番は OFF。
     */
    composeEnabled?: boolean;
}

export class DiscoveryAgent {
    private apiKey: string;
    private baseURL: string;
    private model: string;
    private maxNotes: number;
    private minSeparationScore: number;
    private topFeatureCount: number;
    private composeEnabled: boolean;
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
        this.composeEnabled =
            cfg?.composeEnabled !== undefined
                ? cfg.composeEnabled
                : process.env.DISCOVERY_COMPOSE_ENABLED === 'true';
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
            hintsForHG: [],
            weeklyNote: '',
        };
        let tokenUsage = 0;
        let usedModel = 'empty';
        let llmAttempted = false;
        let llmSucceeded = false;

        if (topSeparations.length > 0 && this.apiKey) {
            llmAttempted = true;
            try {
                const systemPrompt = await this.resolveSystemPrompt();
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
                llmSucceeded = true;
            } catch (error) {
                console.error('[DiscoveryAgent] LLM 解釈失敗:', error);
            }
        } else if (!this.apiKey) {
            console.warn('[DiscoveryAgent] APIキー未設定。統計集計のみ返します。');
        }

        // Critical-3 PR-2: LLM を実行した場合のみ recordUsage(失敗パスは score=0 で記録)
        if (llmAttempted) {
            await recordAgentUsage('discovery', {}, llmSucceeded ? llmOutput : null);
        }

        // Step D-4a (2026-05-29): Discovery を組成役に再活性。2026-05-16 に「調査員役」遵守の
        // ため削除した newHypotheses→EdgeLedger 登録を復活させる (HG は dormant 維持)。
        //
        // 過去の不整合 (XAUUSD データなのに symbols=['EURUSD'] 仮説を 95% 生成) を構造的に
        // 防ぐため、**symbol/timeframe は LLM に選ばせず、分析対象ノートの実値から決定論的に
        // クランプ**する。分析ノートが単一 (symbol, timeframe) でない場合は、どの仮説がどの
        // グループ由来か決められないため組成をスキップする (per-group 呼び出しは DiscoveryJob
        // 側の責務、D-4a 後続)。
        //
        // ゲート: `DISCOVERY_COMPOSE_ENABLED=true` のときのみ書き込む (既定 OFF)。観測導線 /
        // UI が整う D-4b まで本番は OFF。
        const newHypotheses: EdgeHypothesis[] = [];
        if (this.composeEnabled && llmOutput.newHypotheses.length > 0) {
            const symbolsInNotes = Array.from(new Set(truncated.map((n) => n.symbol)));
            const timeframesInNotes = Array.from(
                new Set(truncated.map((n) => n.timeframe).filter((t): t is string => !!t)),
            );
            if (symbolsInNotes.length !== 1 || timeframesInNotes.length !== 1) {
                console.warn(
                    `[DiscoveryAgent] D-4a 組成スキップ: 分析ノートが単一 (symbol, timeframe) でない ` +
                        `(symbols=${symbolsInNotes.length} timeframes=${timeframesInNotes.length})。` +
                        `クランプの一意性を保てないため per-group 呼び出しが必要。`,
                );
            } else {
                const clampSymbol = symbolsInNotes[0];
                const clampTimeframe = timeframesInNotes[0];
                const existing = await this.ledger.findByStatus('unverified');
                const existingConfirmed = await this.ledger.findByStatus('confirmed');
                const allExisting = [...existing, ...existingConfirmed];
                let registered = 0;
                let skippedDup = 0;
                for (const h of llmOutput.newHypotheses) {
                    if (this.isDuplicate(h.statement, allExisting)) {
                        skippedDup++;
                        continue;
                    }
                    const input: CreateEdgeHypothesisInput = {
                        statement: h.statement,
                        category: h.category,
                        conditions: h.conditions,
                        expectedDirection: h.expectedDirection,
                        status: 'unverified',
                        // symbol/timeframe は LLM 出力ではなく分析ノートの実値でクランプ
                        symbols: [clampSymbol],
                        timeframes: [clampTimeframe],
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
                    try {
                        const created = await this.ledger.create(input);
                        newHypotheses.push(created);
                        registered++;
                    } catch (err) {
                        // HypothesisHardlimit 等で弾かれても定期実行は止めない (ログのみ)。
                        console.warn(
                            `[DiscoveryAgent] 仮説登録スキップ (source=discovery): ${safeStringify(err)}`,
                        );
                    }
                }
                console.info(
                    `[DiscoveryAgent] D-4a 組成: symbol=${clampSymbol} timeframe=${clampTimeframe} ` +
                        `candidates=${llmOutput.newHypotheses.length} registered=${registered} dup=${skippedDup}`,
                );
            }
        }

        // 4. レポート整形
        const lensInsights = this.groupByLens(topSeparations, llmOutput.interpretations);

        // 5. Critical-7: hintsForHG を AgentMemory にキャッシュし、次の plan 生成で
        //    HypothesisGenerator が参照できるようにする。LLM 失敗等で hints が空の
        //    場合でも、明示的に空配列でキャッシュを更新して鮮度をリセットする。
        agentMemory.setLatestDiscoveryHints(llmOutput.hintsForHG, truncated.length);

        return {
            periodStart,
            periodEnd,
            analyzedTradeCount: truncated.length,
            lensInsights,
            newHypotheses,
            hintsForHG: llmOutput.hintsForHG,
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
            `上記データを解釈し、interpretations と hintsForHG を JSON で出力してください。`,
        );

        return lines.join('\n');
    }

    private groupByLens(
        separations: readonly FeatureSeparation[],
        interpretations: DiscoveryLLMOutput['interpretations'],
    ): WeeklyDiscoveryReport['lensInsights'] {
        const interpMap = new Map<string, string>();
        for (const i of interpretations) {
            if (i.lensName && i.featureKey) {
                interpMap.set(`${i.lensName}::${i.featureKey}`, i.interpretation);
            }
            for (const lens of i.lensCombination ?? []) {
                interpMap.set(`${lens}::*`, i.interpretation);
            }
        }

        const grouped = new Map<string, WeeklyDiscoveryReport['lensInsights'][number]>();
        for (const s of separations) {
            if (!grouped.has(s.lensName)) {
                grouped.set(s.lensName, { lensName: s.lensName, effectiveFeatures: [] });
            }
            grouped.get(s.lensName)!.effectiveFeatures.push({
                featureKey: s.featureKey,
                separationScore: s.separationScore,
                interpretation:
                    interpMap.get(`${s.lensName}::${s.featureKey}`) ??
                    interpMap.get(`${s.lensName}::*`) ??
                    '',
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

    /**
     * Phase 6.7a: PromptRegistry.getCompositeActive で DB の __global__ + discovery active を合成。
     * Registry 未 seed / DB 不整合時は loadPromptWithGlobal にフォールバック。
     */
    private async resolveSystemPrompt(): Promise<string> {
        try {
            return await promptRegistry.getCompositeActive('discovery');
        } catch (err) {
            console.warn(
                '[DiscoveryAgent] Registry 合成に失敗、ファイル fallback:',
                safeStringify(err),
            );
            return loadPromptWithGlobal('discovery');
        }
    }

    private async callAI(
        systemPrompt: string,
        userPrompt: string,
    ): Promise<{ content: JsonValue; tokenUsage: number; model: string }> {
        const provider = new AIProvider({
            apiKey: this.apiKey,
            model: this.model,
            baseURL: this.baseURL,
        });

        const aiResponse = await provider.chat(
            [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            { temperature: 0.5, maxTokens: AI_MAX_TOKENS.HEAVY, responseFormat: { type: 'json_object' } },
        );

        const content = aiResponse.content;
        if (!content) {
            throw new Error('Discovery API からの応答が空です');
        }

        // フェンス付き応答 (```json ... ```) や前置き混在に対応
        const extracted = extractJson(content);
        if (!extracted.ok) {
            throw new Error(
                `Discovery 応答を JSON として解釈できませんでした: ${extracted.error}`,
            );
        }

        return {
            content: extracted.data,
            tokenUsage: aiResponse.tokenUsage,
            model: aiResponse.model,
        };
    }
}

export const discoveryAgent = new DiscoveryAgent();
