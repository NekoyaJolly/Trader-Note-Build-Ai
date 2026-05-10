/**
 * 世代単位 Reflection エージェント (Filter Evolution Phase D-1b)
 *
 * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.D
 *
 * Phase D の役割分担:
 * - Phase D-1a (PR #144): GenerationLesson テーブル + repo + AgentMemory API ✅
 * - Phase D-1b (本 PR): GenerationReflectionAgent 骨格 + multiGenerationRunner 接続
 * - Phase D-2 (観察後): prompt 品質改善 (= 本ファイルの prompt md を継続的に向上)
 *
 * 機能:
 * - `multiGenerationRunner` の各世代終了直後に `reflect()` を呼ぶ経路 (= runner 側で接続)
 * - 入力: 当世代 GenerationReport + 直前 N 世代の summary
 * - 出力: 1〜3 件の lesson (category / lesson / metrics) + summary + confidence
 * - 失敗時 (LLM API 失敗 / Zod 不適合) は null を返し、runner 側は世代結果に影響させない
 */

import type { ZodError } from 'zod';
import { z } from 'zod';

import { AIProvider, type ChatMessage } from '../agent/aiProvider';
import { loadPromptWithGlobal } from '../prompts/loader';
import { promptRegistry } from '../prompts/registry/PromptRegistry';
import { modelFor } from '../../config';
import { AI_MAX_TOKENS } from '../../config/aiTokenLimits';
import type { JsonValue } from '../../utils/jsonValue';
import { extractJson } from './llmJsonExtract';
import { recordAgentUsage } from './scoringRecorder';
// PR #145 Copilot review #7: category enum は副作用のない独立モジュールから import
// (= 旧経路は repo から import で prisma client を引き込んでいた)
import { GenerationLessonCategorySchema } from '../../schemas/generationLessonCategory';

// =================================================================
// 型定義
// =================================================================

/**
 * 入力として渡す GenerationReport の最小サマリ。
 *
 * 構造的型として定義し、`EvolutionLoop.GenerationReport` 全体を import せず循環依存を避ける
 * (= sideBScheduler / multiGenerationRunner 側で抜粋して構築する)。
 */
export interface GenerationReflectionInput {
  /** 当 regime (= 'breakout' / 'reversal' 等) */
  readonly regime: string;
  /** 0-indexed の世代番号 */
  readonly generationIndex: number;
  /** 全世代数 (= 単世代経路では 1) */
  readonly generationsTotal: number;
  /** GenerationReport.promotionCandidates.length */
  readonly promotionCandidates: number;
  /** GenerationReport.oosAwarePromotionSummary.validationConfirmed */
  readonly validationConfirmed: number;
  /** GenerationReport.formalBtVerifiedCandidates のうち formalBtPassed=true の件数 */
  readonly formalBtPassed: number;
  /** GenerationReport.mutantsReceived */
  readonly mutantsReceived: number;
  /** GenerationReport.crossoversReceived */
  readonly crossoversReceived: number;
  /**
   * `[info] win rate lift ...` 形式の観測ログ抜粋 (= GenerationReport.errors[] からフィルタ)。
   * Phase D-1b では生文字列で渡す (= LLM が解釈)、構造化は Phase D-2 以降に必要なら検討。
   */
  readonly winRateLiftLogs: ReadonlyArray<string>;
  /** 直前世代の同 regime summary (= 直近 3 世代まで)。なければ空配列。 */
  readonly priorGenerations: ReadonlyArray<{
    readonly generationIndex: number;
    readonly promotionCandidates: number;
    readonly validationConfirmed: number;
    readonly formalBtPassed: number;
  }>;
}

/**
 * LLM 出力 lesson 1 件の Zod schema。
 *
 * PR #145 Copilot review #6: prompt 側で「metrics 空オブジェクト禁止」と明記されているが
 * Zod 側で弾いていなかったため、`refine` で `Object.keys(metrics).length > 0` を必須化。
 * 根拠の薄い lesson が DB に永続化されるのを防ぐ。
 */
export const ReflectionLessonOutputSchema = z
  .object({
    category: GenerationLessonCategorySchema,
    lesson: z.string().min(10).max(500),
    // metrics は LLM が自由形式で返す。値は number / string / boolean / null のみ許容 (= JsonValue サブセット)。
    metrics: z.record(
      z.string(),
      z.union([z.number(), z.string(), z.boolean(), z.null()]),
    ),
  })
  .refine((v) => Object.keys(v.metrics).length > 0, {
    message: 'metrics は空オブジェクト禁止 (= 数値根拠を必ず含めること)',
    path: ['metrics'],
  });
export type ReflectionLessonOutput = z.infer<typeof ReflectionLessonOutputSchema>;

/**
 * 過信検知 confidence 上限。
 *
 * 設計書 §5.D「常に 0.9 以上を出すのは禁止」と整合。LLM が常に 0.95+ を出すと
 * 「過信」が検知できなくなるため、Zod 側で 0.9 以下に制限する。
 */
export const REFLECTION_CONFIDENCE_MAX = 0.9;

/**
 * LLM 出力 wrapper の Zod schema。
 *
 * PR #145 Copilot review #1: prompt 制約を Zod で厳密検証する:
 * - `lessons` 内の category 一意性 (= 同 category 重複禁止)
 * - confidence は `REFLECTION_CONFIDENCE_MAX` 以下 (= 過信検知)
 */
export const GenerationReflectionOutputSchema = z
  .object({
    lessons: z.array(ReflectionLessonOutputSchema).min(1).max(3),
    summary: z.string().min(5).max(300),
    confidence: z.number().min(0).max(REFLECTION_CONFIDENCE_MAX),
  })
  .refine(
    (v) => {
      const cats = v.lessons.map((l) => l.category);
      return new Set(cats).size === cats.length;
    },
    {
      message: 'lessons の category は一意でなければならない (= 同 category 重複は 1 lesson に統合)',
      path: ['lessons'],
    },
  );
export type GenerationReflectionOutput = z.infer<typeof GenerationReflectionOutputSchema>;

// =================================================================
// helpers
// =================================================================

type RetryResult<T> = { ok: true; value: T } | { ok: false; error: Error };

async function withRetries<T>(fn: () => Promise<T>, times = 3): Promise<RetryResult<T>> {
  let last: Error = new Error('GenerationReflectionAgent withRetries: 例外なしで終了 (到達不能)');
  for (let i = 0; i < times; i++) {
    try {
      return { ok: true, value: await fn() };
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
    }
  }
  console.error('[GenerationReflectionAgent] リトライ尽くし', last);
  return { ok: false, error: last };
}

function summarizeZodError(err: ZodError): string {
  const top = err.issues.slice(0, 3).map((iss) => {
    const path = iss.path.length > 0 ? iss.path.join('.') : '(root)';
    return `${path}: ${iss.message}`;
  });
  const more = err.issues.length > 3 ? ` …+${err.issues.length - 3} more` : '';
  return top.join(' | ') + more;
}

/**
 * Phase D-1b: input をユーザープロンプトの payload として整形する。
 *
 * 設計書 §5.D.2 の prompt 入力形式に合わせて、当世代 + 直前世代のサマリを 1 つの JSON object
 * として LLM に渡す。winRateLiftLogs は別ブロックで生文字列のまま付与する (= 量が多い場合の
 * truncation は呼び出し側で行う想定)。
 */
function buildUserPrompt(input: GenerationReflectionInput): string {
  const currentGenSummary = {
    regime: input.regime,
    generationIndex: input.generationIndex,
    generationsTotal: input.generationsTotal,
    promotionCandidates: input.promotionCandidates,
    validationConfirmed: input.validationConfirmed,
    formalBtPassed: input.formalBtPassed,
    mutantsReceived: input.mutantsReceived,
    crossoversReceived: input.crossoversReceived,
  };

  // winRateLiftLogs は最大 30 行で truncate (= prompt 肥大化抑制)
  const liftLogsTruncated = input.winRateLiftLogs.slice(0, 30);
  const liftLogsBlock =
    liftLogsTruncated.length > 0
      ? `\n\n当世代の Win Rate Lift 観測ログ抜粋 (${liftLogsTruncated.length}/${input.winRateLiftLogs.length} 件):\n${liftLogsTruncated.join('\n')}`
      : '\n\n当世代の Win Rate Lift 観測ログ: なし';

  const priorBlock =
    input.priorGenerations.length > 0
      ? `\n\n直前世代の同 regime サマリ:\n${JSON.stringify(input.priorGenerations, null, 2)}`
      : '\n\n直前世代: なし (= 当世代が初回)';

  return (
    `当世代 GenerationReport (= サマリ抜粋):\n${JSON.stringify(currentGenSummary, null, 2)}` +
    liftLogsBlock +
    priorBlock +
    `\n\n上記を観察して、世代単位の reflection lesson を 1〜3 件、JSON wrapper 形式で返してください。`
  );
}

// =================================================================
// GenerationReflectionAgent
// =================================================================

/**
 * GenerationReflectionAgent が依存する AIProvider の最小 interface。
 *
 * PR #145 Copilot review #2 対応: 内部で `chat` のみ呼ぶため `Pick<AIProvider, 'chat'>`
 * に緩和する。テストで `as unknown as AIProvider` の二重キャスト無しに最小 mock を渡せる。
 */
export type AIProviderForReflection = Pick<AIProvider, 'chat'>;

export class GenerationReflectionAgent {
  constructor(
    private readonly ai: AIProviderForReflection = new AIProvider({
      model: modelFor('generation_reflection'),
    }),
  ) {}

  /**
   * Phase 6.7a と同じパターン: PromptRegistry の active prompt → ファイル fallback。
   */
  private async resolveSystemPrompt(): Promise<string> {
    try {
      return await promptRegistry.getCompositeActive('generation_reflection');
    } catch (err) {
      console.warn(
        '[GenerationReflectionAgent] Registry 合成に失敗、ファイル fallback:',
        err instanceof Error ? `${err.name}: ${err.message || '(empty message)'}` : JSON.stringify(err),
      );
      return loadPromptWithGlobal('generation_reflection');
    }
  }

  /**
   * 1 世代分の reflection を実行する。
   *
   * - LLM 失敗 / 応答 content 空 / JSON 解釈失敗 / Zod 不適合 → null を返す
   *   (= runner 側は世代結果に影響させない、observation log のみ)
   * - 成功時は GenerationReflectionOutput を返す
   */
  async reflect(input: GenerationReflectionInput): Promise<GenerationReflectionOutput | null> {
    const system = await this.resolveSystemPrompt();
    const user = buildUserPrompt(input);

    const result = await withRetries(() =>
      this.ai.chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ] as ChatMessage[],
        { temperature: 0.3, maxTokens: AI_MAX_TOKENS.MEDIUM },
      ),
    );
    if (!result.ok) {
      console.warn(
        `[GenerationReflectionAgent] reflect: API 失敗 (リトライ尽くし) — null 返却。理由: ${result.error.message}`,
      );
      await recordAgentUsage('generation_reflection', { regime: input.regime, gen: input.generationIndex }, null);
      return null;
    }

    const res = result.value;
    if (!res?.content) {
      console.warn('[GenerationReflectionAgent] reflect: LLM 応答 content が空 — null 返却');
      await recordAgentUsage('generation_reflection', { regime: input.regime, gen: input.generationIndex }, null);
      return null;
    }

    const extracted = extractJson<JsonValue>(res.content);
    if (!extracted.ok) {
      console.warn(
        `[GenerationReflectionAgent] reflect: JSON 抽出失敗 — null 返却。応答先頭: ${res.content.slice(0, 200).replace(/\s+/g, ' ')}`,
      );
      await recordAgentUsage('generation_reflection', { regime: input.regime, gen: input.generationIndex }, null);
      return null;
    }

    const parsed = GenerationReflectionOutputSchema.safeParse(extracted.data);
    if (!parsed.success) {
      console.warn(
        `[GenerationReflectionAgent] reflect: Zod 不適合 — null 返却。issues: ${summarizeZodError(parsed.error)}`,
      );
      await recordAgentUsage('generation_reflection', { regime: input.regime, gen: input.generationIndex }, null);
      return null;
    }

    await recordAgentUsage(
      'generation_reflection',
      { regime: input.regime, gen: input.generationIndex },
      parsed.data,
    );
    console.info(
      `[GenerationReflectionAgent] reflect 成功: regime=${input.regime} gen=${input.generationIndex} ` +
        `lessons=${parsed.data.lessons.length} confidence=${parsed.data.confidence.toFixed(2)} ` +
        `categories=${parsed.data.lessons.map((l) => l.category).join(',')}`,
    );
    return parsed.data;
  }
}

/**
 * 既定の singleton。本番 sideBScheduler / multiGenerationRunner で使う想定。
 */
export const generationReflectionAgent = new GenerationReflectionAgent();
