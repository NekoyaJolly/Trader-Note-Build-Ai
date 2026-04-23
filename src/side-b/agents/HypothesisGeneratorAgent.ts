/**
 * HypothesisGeneratorAgent（Phase 4a）
 *
 * 役割: レンズ出力から「まだ誰も気付いていない偏り」を構造的に発見し、
 *       EdgeLedger に未検証の仮説候補として追加する。
 *
 * 設計原則:
 * - 代替戦略や戦略化は行わない（Strategy Thinker の仕事）
 * - 既存仮説と類似する候補は除外する（重複防止）
 * - LLM が架空のレンズ/特徴量を指定した場合はバリデーションで弾く
 *
 * @see docs/design/phase_4_specification.md セクション4.4
 */

import { config, modelFor } from '../../config';
import { loadPrompt } from '../prompts/loader';
import type { LensFeatureSnapshot } from '../lenses';
import type {
    EdgeHypothesis,
    EdgeCategory,
    MachineReadableCondition,
    CreateEdgeHypothesisInput,
    DefaultRiskManagement,
    StopLossSpec,
    TakeProfitSpec,
} from '../models/edgeHypothesis';
import {
    isEdgeCategory,
    validateCondition,
    DEFAULT_RISK_MANAGEMENT,
} from '../models/edgeHypothesis';
import { PromptRegistry } from '../prompts/registry/PromptRegistry';
import { selectVariant, type RandomGenerator } from '../prompts/registry/variantSelector';
import { getScoringFunction } from '../prompts/abtest/scoringFunctions';
import type { PromptVersion } from '../prompts/registry/types';
import { extractJson } from './llmJsonExtract';

// ===========================================
// 型定義
// ===========================================

/**
 * LLM の生出力（バリデーション後の型）
 */
export interface HypothesisGeneratorOutput {
    hypotheses: Array<{
        statement: string;
        category: EdgeCategory;
        expectedDirection: 'long' | 'short' | 'either';
        reasoning: string;
        conditions: MachineReadableCondition[];
        defaultRiskManagement?: DefaultRiskManagement;
        lensRelevance?: Record<string, number>;
    }>;
    noveltyClaim: string;
}

/**
 * Phase 4b で許容される SL タイプ
 */
const PHASE_4B_ALLOWED_SL_TYPES: StopLossSpec['type'][] = ['atr_multiple'];
/**
 * Phase 4b で許容される TP タイプ
 */
const PHASE_4B_ALLOWED_TP_TYPES: TakeProfitSpec['type'][] = ['atr_multiple', 'rr_ratio'];

function validateRiskManagement(raw: unknown): DefaultRiskManagement | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const r = raw as Record<string, unknown>;

    const sl = r.stopLoss as Record<string, unknown> | undefined;
    const tp = r.takeProfit as Record<string, unknown> | undefined;
    if (!sl || !tp) return undefined;

    // Phase 4b 制限: 許容外の type は無視（呼び出し側で DEFAULT 補完）
    if (
        typeof sl.type !== 'string' ||
        !PHASE_4B_ALLOWED_SL_TYPES.includes(sl.type as StopLossSpec['type'])
    ) {
        return undefined;
    }
    if (
        typeof tp.type !== 'string' ||
        !PHASE_4B_ALLOWED_TP_TYPES.includes(tp.type as TakeProfitSpec['type'])
    ) {
        return undefined;
    }
    if (typeof sl.value !== 'number' || typeof tp.value !== 'number') return undefined;

    const stopLoss = { type: sl.type, value: sl.value } as StopLossSpec;
    const takeProfit = { type: tp.type, value: tp.value } as TakeProfitSpec;
    const maxHoldingBars =
        typeof r.maxHoldingBars === 'number' && r.maxHoldingBars > 0
            ? r.maxHoldingBars
            : undefined;

    return {
        stopLoss,
        takeProfit,
        ...(maxHoldingBars !== undefined ? { maxHoldingBars } : {}),
    };
}

export interface HypothesisGeneratorInput {
    symbol: string;
    timeframe: string;
    lensSnapshot: LensFeatureSnapshot;
    existingHypotheses: EdgeHypothesis[];
    /**
     * Phase 6: 下位専門家エージェントによる事前分析(任意)。
     * 渡された場合はプロンプトの ステップ0 で統合する。
     * 渡されない場合、従来通りレンズ特徴量だけを参照する(後方互換)。
     */
    specialistAnalyses?: {
        trend?: unknown;
        oscillator?: unknown;
        volatilityVolume?: unknown;
    };
}

export interface HypothesisGeneratorResult {
    output: HypothesisGeneratorOutput;
    tokenUsage: number;
    model: string;
}

// ===========================================
// バリデーション
// ===========================================

export function validateHypothesisGeneratorOutput(
    data: unknown,
    snapshot: LensFeatureSnapshot,
): HypothesisGeneratorOutput {
    if (!data || typeof data !== 'object') {
        throw new Error('HypothesisGenerator output must be an object');
    }
    const obj = data as Record<string, unknown>;

    if (!Array.isArray(obj.hypotheses)) {
        throw new Error('hypotheses must be an array');
    }

    const availableLenses = new Set(snapshot.features.keys());

    const hypotheses = (obj.hypotheses as unknown[]).map((raw, idx) => {
        const h = raw as Record<string, unknown>;
        if (typeof h.statement !== 'string' || h.statement.length < 10) {
            throw new Error(`hypotheses[${idx}]: invalid statement`);
        }
        if (!isEdgeCategory(h.category)) {
            throw new Error(`hypotheses[${idx}]: invalid category=${String(h.category)}`);
        }
        if (
            h.expectedDirection !== 'long' &&
            h.expectedDirection !== 'short' &&
            h.expectedDirection !== 'either'
        ) {
            throw new Error(`hypotheses[${idx}]: invalid expectedDirection`);
        }
        if (typeof h.reasoning !== 'string') {
            throw new Error(`hypotheses[${idx}]: invalid reasoning`);
        }
        if (!Array.isArray(h.conditions) || h.conditions.length < 2 || h.conditions.length > 5) {
            throw new Error(`hypotheses[${idx}]: conditions must be 2-5 items`);
        }

        const conditions = (h.conditions as unknown[]).map(validateCondition);
        // 架空のレンズが指定されていないかチェック
        for (const c of conditions) {
            if (!availableLenses.has(c.lensName)) {
                throw new Error(
                    `hypotheses[${idx}]: unknown lensName "${c.lensName}" (available: ${Array.from(availableLenses).join(',')})`,
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

        const defaultRiskManagement = validateRiskManagement(h.defaultRiskManagement);

        return {
            statement: h.statement as string,
            category: h.category as EdgeCategory,
            expectedDirection: h.expectedDirection as 'long' | 'short' | 'either',
            reasoning: h.reasoning as string,
            conditions,
            ...(defaultRiskManagement ? { defaultRiskManagement } : {}),
            ...(lensRelevance ? { lensRelevance } : {}),
        };
    });

    const noveltyClaim = typeof obj.noveltyClaim === 'string' ? obj.noveltyClaim : '';

    return { hypotheses, noveltyClaim };
}

// ===========================================
// エージェント本体
// ===========================================

export interface HypothesisGeneratorConfig {
    apiKey?: string;
    baseURL?: string;
    model?: string;
    /** Phase 6.6: テスト差し替え用の PromptRegistry(省略時はデフォルトを使う)。 */
    registry?: PromptRegistry;
    /** Phase 6.6: テスト差し替え用の乱数生成器(省略時は Math.random)。 */
    rand?: RandomGenerator;
}

export class HypothesisGeneratorAgent {
    private apiKey: string;
    private baseURL: string;
    private model: string;
    /**
     * registry は遅延生成。コンストラクタで new PromptRegistry() を呼ぶと
     * module-load 時のデフォルトエクスポート生成で副作用が見えやすいので、
     * 最初の generate() 呼び出し時まで初期化を遅らせる。テスト時は cfg.registry
     * を渡せば遅延生成経路には入らない。
     */
    private _registry: PromptRegistry | null;
    private readonly rand: RandomGenerator;

    constructor(cfg?: HypothesisGeneratorConfig) {
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
                : modelFor('hypothesis_generator');
        this._registry = cfg?.registry ?? null;
        this.rand = cfg?.rand ?? Math.random;
    }

    /** registry の遅延アクセサ。未指定時は初回参照で PromptRegistry を生成。 */
    private get registry(): PromptRegistry {
        if (!this._registry) {
            this._registry = new PromptRegistry();
        }
        return this._registry;
    }

    /**
     * レンズスナップショットと既存仮説から、新規候補を生成する。
     * API キーなしや失敗時は空の hypotheses を返す（呼び出し側は継続可能）。
     *
     * Phase 6.6: プロンプトは PromptRegistry + variantSelector で選択
     *   1. getActive + getExperimental で候補取得(registry 未登録ならファイル loadPrompt に fallback)
     *   2. selectVariant で確率的選択(experimental は 20% 以下)
     *   3. 選ばれたプロンプトで LLM 呼び出し
     *   4. scoringFunctions で即時スコアリング → recordUsage
     *   5. experimental が失敗したら active で自動再試行
     */
    async generate(input: HypothesisGeneratorInput): Promise<HypothesisGeneratorResult> {
        if (!this.apiKey) {
            console.warn('[HypothesisGenerator] APIキー未設定。空の候補を返します。');
            return this.emptyResult('APIキー未設定');
        }
        if (input.lensSnapshot.features.size === 0) {
            console.warn('[HypothesisGenerator] lensSnapshot が空。候補生成スキップ。');
            return this.emptyResult('lensSnapshot が空');
        }

        const userPrompt = this.buildUserPrompt(input);
        // Phase 6.6: registry から active / experimental を取得(失敗時は fallback)
        const { active, experimentals } = await this.loadVariants();
        const fallbackSystem = loadPrompt('hypothesis_generator');

        // registry に active が無ければ従来通り loadPrompt() で単純実行(後方互換)
        if (!active) {
            return this.runSingleWithPrompt(fallbackSystem, userPrompt, input);
        }

        // 1 回目: variantSelector で選択
        const selection = selectVariant(active, experimentals, this.rand);
        const primary = await this.runAndScore(
            selection.selected.content,
            userPrompt,
            input,
            selection.selected.id,
        );
        // recordUsage (primary)
        await this.safeRecordUsage(selection.selected.id, primary.score, primary.success);

        if (primary.success) {
            return {
                output: primary.output,
                tokenUsage: primary.tokenUsage,
                model: primary.model,
            };
        }

        // experimental 失敗 → active で再試行
        if (selection.isExperimental) {
            const fallback = await this.runAndScore(
                active.content,
                userPrompt,
                input,
                active.id,
            );
            await this.safeRecordUsage(active.id, fallback.score, fallback.success);
            return {
                output: fallback.output,
                tokenUsage: fallback.tokenUsage,
                model: fallback.model,
            };
        }

        // active 自体の失敗 → 既存仕様通り空応答
        return {
            output: primary.output,
            tokenUsage: primary.tokenUsage,
            model: primary.model,
        };
    }

    /**
     * registry から variant 候補を取得。
     * active と experimental を独立した try/catch で扱う:
     *   - active 失敗 → fallback 経路 (loadPrompt 単純実行) へ
     *   - experimental 失敗 → active のみで続行
     */
    private async loadVariants(): Promise<{
        active: PromptVersion | null;
        experimentals: PromptVersion[];
    }> {
        let active: PromptVersion | null = null;
        try {
            active = await this.registry.getActive('hypothesis_generator');
        } catch (err) {
            console.warn(
                '[HypothesisGenerator] active prompt の registry 読込失敗、ファイル fallback へ:',
                err instanceof Error ? err.message : err,
            );
            return { active: null, experimentals: [] };
        }
        if (!active) return { active: null, experimentals: [] };
        let experimentals: PromptVersion[] = [];
        try {
            experimentals = await this.registry.getExperimental('hypothesis_generator');
        } catch (err) {
            console.warn(
                '[HypothesisGenerator] experimental prompt の registry 読込失敗、active のみで続行:',
                err instanceof Error ? err.message : err,
            );
        }
        return { active, experimentals };
    }

    /** recordUsage を try/catch で wrap(DB 失敗でエージェント本体は止めない)。 */
    private async safeRecordUsage(versionId: string, score: number, success: boolean): Promise<void> {
        try {
            await this.registry.recordUsage(versionId, { score, success });
        } catch (err) {
            console.warn(
                `[HypothesisGenerator] recordUsage 失敗 (id=${versionId}):`,
                err instanceof Error ? err.message : err,
            );
        }
    }

    /**
     * 指定プロンプトで LLM 呼出 + バリデーション + スコアリング。
     * 例外は捕捉し、success=false として返す。
     */
    private async runAndScore(
        systemPrompt: string,
        userPrompt: string,
        input: HypothesisGeneratorInput,
        _versionId: string,
    ): Promise<{
        output: HypothesisGeneratorOutput;
        tokenUsage: number;
        model: string;
        score: number;
        success: boolean;
    }> {
        try {
            const raw = await this.callAI(systemPrompt, userPrompt);
            const validated = validateHypothesisGeneratorOutput(raw.content, input.lensSnapshot);
            const scoreFn = getScoringFunction('hypothesis_generator');
            const score = scoreFn ? clamp01(scoreFn(input, validated)) : 1;
            const success = score >= 0.3 && validated.hypotheses.length > 0;
            return {
                output: validated,
                tokenUsage: raw.tokenUsage,
                model: raw.model,
                score,
                success,
            };
        } catch (err) {
            console.error('[HypothesisGenerator] 生成失敗:', err);
            return {
                output: { hypotheses: [], noveltyClaim: '生成失敗' },
                tokenUsage: 0,
                model: 'empty',
                score: 0,
                success: false,
            };
        }
    }

    /**
     * registry 不使用の単純実行(fallback 経路、従来互換)。
     * registry が空 or 接続失敗時に使う。recordUsage は呼ばない。
     */
    private async runSingleWithPrompt(
        systemPrompt: string,
        userPrompt: string,
        input: HypothesisGeneratorInput,
    ): Promise<HypothesisGeneratorResult> {
        try {
            const raw = await this.callAI(systemPrompt, userPrompt);
            const validated = validateHypothesisGeneratorOutput(raw.content, input.lensSnapshot);
            return {
                output: validated,
                tokenUsage: raw.tokenUsage,
                model: raw.model,
            };
        } catch (error) {
            console.error('[HypothesisGenerator] 候補生成失敗:', error);
            return this.emptyResult('生成失敗');
        }
    }

    /**
     * 出力から EdgeLedger の create 入力に変換する。
     * 既存仮説と statement ベースで類似度判定し、重複は除く。
     */
    toCreateInputs(
        result: HypothesisGeneratorOutput,
        input: HypothesisGeneratorInput,
    ): CreateEdgeHypothesisInput[] {
        return result.hypotheses
            .filter((h) => !this.isDuplicateOfExisting(h.statement, input.existingHypotheses))
            .map<CreateEdgeHypothesisInput>((h) => ({
                statement: h.statement,
                category: h.category,
                conditions: h.conditions,
                expectedDirection: h.expectedDirection,
                status: 'unverified',
                statusNote: undefined,
                symbols: [input.symbol],
                timeframes: [input.timeframe],
                observationCount: 0,
                winCount: 0,
                lossCount: 0,
                breakevenCount: 0,
                totalPnlPips: 0,
                avgRR: 0,
                source: 'ai_generated',
                lensRelevance: h.lensRelevance,
                parentIds: [],
                relatedNoteIds: [],
                // Phase 4b: 欠落時は DEFAULT_RISK_MANAGEMENT で補完
                defaultRiskManagement: h.defaultRiskManagement ?? DEFAULT_RISK_MANAGEMENT,
                materializedTradeNoteIds: [],
            }));
    }

    // ===========================================
    // 内部
    // ===========================================

    private buildUserPrompt(input: HypothesisGeneratorInput): string {
        const lensDump: string[] = [];
        for (const [lensName, feature] of input.lensSnapshot.features.entries()) {
            lensDump.push(`### ${lensName}`);
            for (const [k, v] of Object.entries(feature.features)) {
                lensDump.push(`- ${k}: ${JSON.stringify(v)}`);
            }
        }

        const existingDump =
            input.existingHypotheses.length === 0
                ? '（まだ台帳は空）'
                : input.existingHypotheses
                      .slice(0, 30)
                      .map((h) => `- [${h.status}] ${h.statement}`)
                      .join('\n');

        const specialistsDump = this.formatSpecialistAnalyses(input.specialistAnalyses);

        return `# 仮説生成リクエスト

## 対象
- シンボル: ${input.symbol}
- 時間足: ${input.timeframe}

## 現在のレンズスナップショット
${lensDump.join('\n')}
${specialistsDump}
## 既存仮説リスト（重複回避）
${existingDump}

上記の既存仮説と**意味的に異なる**新規仮説を最大3個生成してください。
新規性がなければ 0 個で構いません。`;
    }

    /**
     * Phase 6: specialistAnalyses のダンプをプロンプト向けに整形する。
     * 未指定時は空文字を返し、プロンプト本文に影響を与えない(後方互換)。
     */
    private formatSpecialistAnalyses(
        specialistAnalyses?: HypothesisGeneratorInput['specialistAnalyses'],
    ): string {
        if (!specialistAnalyses) return '';
        const entries: string[] = [];
        if (specialistAnalyses.trend) {
            entries.push(`### Trend Specialist\n${JSON.stringify(specialistAnalyses.trend, null, 2)}`);
        }
        if (specialistAnalyses.oscillator) {
            entries.push(
                `### Oscillator Specialist\n${JSON.stringify(specialistAnalyses.oscillator, null, 2)}`,
            );
        }
        if (specialistAnalyses.volatilityVolume) {
            entries.push(
                `### Volatility/Volume Specialist\n${JSON.stringify(specialistAnalyses.volatilityVolume, null, 2)}`,
            );
        }
        if (entries.length === 0) return '';
        return `\n## 下位専門家の分析(統合して使う)\n${entries.join('\n\n')}\n`;
    }

    private isDuplicateOfExisting(
        statement: string,
        existing: readonly EdgeHypothesis[],
    ): boolean {
        const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
        const target = normalize(statement);
        if (target.length === 0) return true;
        for (const e of existing) {
            const n = normalize(e.statement);
            if (n === target) return true;
            // 簡易類似度: 長さ差が小さく、先頭 60 文字が一致したら重複扱い
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
                temperature: 0.6,
                max_tokens: 4096,
            }),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`HypothesisGenerator API エラー: ${response.status} - ${body}`);
        }

        const data = (await response.json()) as {
            choices?: { message?: { content?: string } }[];
            usage?: { total_tokens?: number };
            model?: string;
        };

        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('HypothesisGenerator API からの応答が空です');
        }

        // フェンス付き応答 (```json ... ```) や前置き混在に対応
        // Phase 6 hotfix の extractJson を使う(raw → fence → bracket の 3 段階 fallback)
        const extracted = extractJson(content);
        if (!extracted.ok) {
            throw new Error(
                `HypothesisGenerator 応答を JSON として解釈できませんでした: ${extracted.error}`,
            );
        }

        return {
            content: extracted.data,
            tokenUsage: data.usage?.total_tokens || 0,
            model: data.model || this.model,
        };
    }

    private emptyResult(reason: string): HypothesisGeneratorResult {
        return {
            output: { hypotheses: [], noveltyClaim: reason },
            tokenUsage: 0,
            model: 'empty',
        };
    }
}

function clamp01(x: number): number {
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
}

export const hypothesisGeneratorAgent = new HypothesisGeneratorAgent();
