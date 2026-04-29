/**
 * StrategistAgent（Phase 4c Step E）
 *
 * Phase 4c 検証パイプラインの最上位層。BacktesterAgent が統合した
 * レポートを決定論的に判定し、LLM で解釈を付与して EdgeLedger に永続化する。
 *
 * 設計原則（仕様書 §4.9 + CLAUDE.md 原則3, 5）:
 * - 昇格/棄却の判定は StatusManager の決定論的ロジック（LLM は関与しない）
 * - LLM は結果解釈・改善提案の言語化のみ（失敗時もフォールバック）
 * - LLM プロバイダは AIProvider 経由で config.ai.model（既定 Gemini）
 *   を使用。モデルのハードコード禁止
 *
 * @see docs/design/phase_4c_specification.md §4.9
 */

import type {
    EdgeHypothesis,
    ConsolidatedValidationReport,
} from '../models/edgeHypothesis';
import type { EdgeLedger} from '../ledger/EdgeLedger';
import { edgeLedger as defaultEdgeLedger } from '../ledger/EdgeLedger';
import type {
    StatusManager} from '../ledger/statusManager';
import {
    statusManager as defaultStatusManager,
    type PromoteCheck,
} from '../ledger/statusManager';
import { BacktesterAgent } from './BacktesterAgent';
import { AIProvider } from '../agent/aiProvider';
import { loadPromptWithGlobal } from '../prompts/loader';
import { promptRegistry } from '../prompts/registry/PromptRegistry';
import { modelFor } from '../../config';

// ===========================================
// 型
// ===========================================

export type PromotionVerdictType =
    | 'confirmed'
    | 'rejected'
    | 'insufficient_data'
    | 'not_testable';

export interface PromotionVerdict {
    verdict: PromotionVerdictType;
    hypothesisId: string;
    /** not_testable / insufficient_data の場合は undefined */
    report?: ConsolidatedValidationReport;
    /** 決定論的判定の理由群（棄却時は複数、通過時は空） */
    baseCriteriaReasons: string[];
    /** LLM による自然言語解釈（失敗時は undefined） */
    interpretation?: string;
    /** LLM による改善提案（失敗時は undefined） */
    actionableInsights?: string[];
    decidedAt: Date;
}

export interface StrategistAgentOptions {
    /** 検証対象期間（既定: 直近1年） */
    period?: { start: string; end: string };
    /** LLM 呼び出しを完全スキップ（テスト・デバッグ用） */
    skipLLM?: boolean;
}

// ===========================================
// Agent 本体
// ===========================================

export class StrategistAgent {
    constructor(
        private readonly edgeLedger: EdgeLedger = defaultEdgeLedger,
        private readonly backtester: BacktesterAgent = new BacktesterAgent(),
        private readonly statusManager: StatusManager = defaultStatusManager,
        private readonly ai: AIProvider = new AIProvider({ model: modelFor('strategist') }),
    ) {}

    /**
     * 仮説を本格検証し、confirmed / rejected / not_testable のいずれかに
     * 遷移させて PromotionVerdict を返す。
     *
     * 前提:
     *   - hypothesis.status === 'screening_passed'（Phase 4b 通過）
     *   - hypothesis.materializedTradeNoteIds に少なくとも 1 件
     *
     * LLM 失敗は致命的ではない（interpretation=undefined で判定は進む）。
     */
    async validate(
        hypothesisId: string,
        options: StrategistAgentOptions = {},
    ): Promise<PromotionVerdict> {
        const hypothesis = await this.edgeLedger.get(hypothesisId);
        if (!hypothesis) {
            throw new Error(`Hypothesis not found: ${hypothesisId}`);
        }

        const period = options.period ?? this.defaultPeriod();
        const tradeNoteId = hypothesis.materializedTradeNoteIds?.[0];
        if (!tradeNoteId) {
            const reason = 'materializedTradeNoteId が無い（Phase 4b 未通過か、materialize 失敗）';
            await this.edgeLedger.markNotTestable(hypothesisId, reason);
            return this.buildVerdict('not_testable', hypothesisId, undefined, [reason]);
        }

        // testing に遷移
        await this.edgeLedger.markTesting(hypothesisId);

        let report: ConsolidatedValidationReport;
        try {
            report = await this.backtester.runFullValidation(hypothesis, tradeNoteId, period);
        } catch (err) {
            const reason = `BacktesterAgent 実行失敗: ${err instanceof Error ? err.message : String(err)}`;
            await this.edgeLedger.markNotTestable(hypothesisId, reason);
            return this.buildVerdict('not_testable', hypothesisId, undefined, [reason]);
        }

        const check = this.statusManager.canPromoteToConfirmedFull(hypothesis, report);

        // LLM 解釈（best-effort）
        let interpretation: string | undefined;
        let insights: string[] | undefined;
        if (!options.skipLLM) {
            try {
                const parsed = await this.interpretWithLLM(hypothesis, report, check);
                interpretation = parsed.interpretation;
                insights = parsed.actionableInsights;
            } catch (err) {
                console.warn('[Strategist] LLM 解釈失敗（判定のみで継続）:', err);
            }
        }

        if (check.ok) {
            await this.edgeLedger.markConfirmedFull(
                hypothesisId,
                report,
                interpretation,
                insights,
            );
            return this.buildVerdict(
                'confirmed',
                hypothesisId,
                report,
                check.reasons,
                interpretation,
                insights,
            );
        }

        await this.edgeLedger.markRejectedFull(
            hypothesisId,
            check.reasons.join('; '),
            report,
            interpretation,
            insights,
        );
        return this.buildVerdict(
            'rejected',
            hypothesisId,
            report,
            check.reasons,
            interpretation,
            insights,
        );
    }

    // ===========================================
    // LLM 呼び出し（best-effort）
    // ===========================================

    /**
     * Phase 6.7a: PromptRegistry.getCompositeActive で DB の __global__ + strategist active を合成。
     * Registry 未 seed / DB 不整合時は loadPromptWithGlobal にフォールバック。
     */
    private async resolveSystemPrompt(): Promise<string> {
        try {
            return await promptRegistry.getCompositeActive('strategist');
        } catch (err) {
            console.warn(
                '[Strategist] Registry 合成に失敗、ファイル fallback:',
                err instanceof Error ? err.message : err,
            );
            return loadPromptWithGlobal('strategist');
        }
    }

    private async interpretWithLLM(
        hyp: EdgeHypothesis,
        report: ConsolidatedValidationReport,
        check: PromoteCheck,
    ): Promise<{ interpretation: string; actionableInsights: string[] }> {
        const systemPrompt = await this.resolveSystemPrompt();
        const userPrompt = this.buildUserPrompt(hyp, report, check);

        const response = await this.ai.chat(
            [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            { maxTokens: 4096 },
        );

        return this.parseLLMOutput(response.content);
    }

    private buildUserPrompt(
        hyp: EdgeHypothesis,
        report: ConsolidatedValidationReport,
        check: PromoteCheck,
    ): string {
        const verdictLabel = check.ok ? '✅ 通過（confirmed 予定）' : '❌ 棄却（rejected 予定）';

        const tool = (label: string, r: typeof report.screening) => {
            if (!r) return `  - ${label}: 未実行 / 失敗`;
            const metricsLines = Object.entries(r.metrics)
                .map(([k, v]) => `      - ${k}: ${typeof v === 'number' ? v : v}`)
                .join('\n');
            const status = r.success ? (r.passed ? 'passed' : 'not passed') : `failed (${r.error ?? 'unknown'})`;
            return `  - ${label}: ${status}\n${metricsLines}`;
        };

        return [
            `# 検証結果の解釈依頼`,
            ``,
            `## 仮説`,
            `- id: ${hyp.id}`,
            `- statement: ${hyp.statement}`,
            `- category: ${hyp.category}`,
            `- expectedDirection: ${hyp.expectedDirection}`,
            `- symbols: ${hyp.symbols.join(', ')}`,
            `- timeframes: ${hyp.timeframes.join(', ')}`,
            ``,
            `## 判定（決定論的、覆さない）`,
            `- ${verdictLabel}`,
            check.reasons.length > 0 ? `- 理由:\n${check.reasons.map((r) => `  - ${r}`).join('\n')}` : '- 理由: （なし）',
            ``,
            `## 4ツール結果`,
            tool('Screening (Phase 4b)', report.screening),
            tool('WalkForward', report.walkForward),
            tool('MonteCarlo', report.monteCarlo),
            tool('BuyAndHold', report.buyAndHold),
            ``,
            report.errors.length > 0 ? `## 実行エラー\n${report.errors.map((e) => `- ${e}`).join('\n')}` : '',
            ``,
            `上記の事実を 2-4 文で言語化し、改善提案があれば 0-3 件添えて JSON で返してください。`,
        ]
            .filter((line) => line !== undefined)
            .join('\n');
    }

    /**
     * LLM の生レスポンスから JSON を抽出して契約を検証する。
     * フォーマット外れは throw（呼び出し側で fallback）。
     */
    private parseLLMOutput(content: string | null): {
        interpretation: string;
        actionableInsights: string[];
    } {
        if (!content) {
            throw new Error('LLM response had no content');
        }
        // ```json ... ``` でラップされている可能性に備えて最初の { ... } を抽出
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) {
            throw new Error(`LLM output contained no JSON object: ${content.slice(0, 200)}`);
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(match[0]);
        } catch (err) {
            throw new Error(
                `LLM output JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('LLM output is not a JSON object');
        }
        const p = parsed as Record<string, unknown>;
        if (typeof p.interpretation !== 'string' || p.interpretation.trim() === '') {
            throw new Error('LLM output missing interpretation field');
        }
        const insightsRaw = p.actionableInsights;
        const insights = Array.isArray(insightsRaw)
            ? insightsRaw.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
            : [];
        return {
            interpretation: p.interpretation.trim(),
            actionableInsights: insights,
        };
    }

    // ===========================================
    // ユーティリティ
    // ===========================================

    private buildVerdict(
        verdict: PromotionVerdictType,
        hypothesisId: string,
        report: ConsolidatedValidationReport | undefined,
        baseCriteriaReasons: string[],
        interpretation?: string,
        actionableInsights?: string[],
    ): PromotionVerdict {
        return {
            verdict,
            hypothesisId,
            report,
            baseCriteriaReasons,
            interpretation,
            actionableInsights,
            decidedAt: new Date(),
        };
    }

    private defaultPeriod(): { start: string; end: string } {
        const end = new Date();
        const start = new Date(end);
        start.setFullYear(start.getFullYear() - 1);
        return {
            start: start.toISOString().split('T')[0],
            end: end.toISOString().split('T')[0],
        };
    }
}

export const strategistAgent = new StrategistAgent();
