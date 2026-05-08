/**
 * 交配オペレーター（LLM）（Phase 5）
 *
 * @see docs/design/phase_5_specification.md §4.6
 */

import { randomUUID } from 'crypto';

import { AIProvider, type ChatMessage } from '../agent/aiProvider';
import { formatIndicatorMetadataTable } from '../../shared/indicators/promptTable';
import { formatPatternMetadataTable } from '../../shared/patterns/promptTable';
import { loadPromptWithGlobal, type PromptMacros } from '../prompts/loader';
import { promptRegistry } from '../prompts/registry/PromptRegistry';
import { StrategyDSLSchema, type StrategyDSL } from '../strategy_dsl/schema';
// Filter Evolution M4: ModuleParent 受領経路 (interface のみ、本 PR では prompt 未連携、M3 で接続)。
import type { ModuleParent } from '../evolution/moduleParentRegistry';
import { modelFor } from '../../config';
import { AI_MAX_TOKENS } from '../../config/aiTokenLimits';
import { extractJson } from './llmJsonExtract';
import { recordAgentUsage } from './scoringRecorder';

/**
 * 4a.PDCA: API 失敗とパース失敗を分離するため、discriminated union を返す。
 *
 * PR #117e lint fix: `unknown` を Error に narrow (catch ブロックの例外を必ず Error 化)。
 * memory feedback_no_any_unknown.md「any/unknown 禁止」を満たすため。
 */
type RetryResult<T> = { ok: true; value: T } | { ok: false; error: Error };

async function withRetries<T>(fn: () => Promise<T>, times = 3): Promise<RetryResult<T>> {
  let last: Error = new Error('CrossoverAgent withRetries: 例外なしで終了 (到達不能)');
  for (let i = 0; i < times; i++) {
    try {
      return { ok: true, value: await fn() };
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
    }
  }
  console.error('[CrossoverAgent] リトライ尽くし', last);
  return { ok: false, error: last };
}

export class CrossoverAgent {
  constructor(private readonly ai = new AIProvider({ model: modelFor('crossover') })) {}

  /**
   * Phase 6.7a: PromptRegistry.getCompositeActive で DB の __global__ + crossover active を合成。
   * Registry 未 seed / DB 不整合時は loadPromptWithGlobal にフォールバック。
   *
   * PR #117e: `{{INDICATOR_METADATA_TABLE}}` macro を registry から動的に注入する。
   * PR ②-2: `{{PATTERN_METADATA_TABLE}}` macro を pattern registry から注入する。
   */
  private async resolveSystemPrompt(): Promise<string> {
    const macros: PromptMacros = {
      INDICATOR_METADATA_TABLE: formatIndicatorMetadataTable(),
      PATTERN_METADATA_TABLE: formatPatternMetadataTable(),
    };
    try {
      return await promptRegistry.getCompositeActive('crossover', macros);
    } catch (err) {
      console.warn(
        '[CrossoverAgent] Registry 合成に失敗、ファイル fallback:',
        err instanceof Error ? err.message : err,
      );
      return loadPromptWithGlobal('crossover', macros);
    }
  }

  /**
   * エリート集合からペアを組み、子個体を生成
   *
   * Filter Evolution M4: `moduleParents` (= フィルタ素材) を optional 引数として
   * 受け取れるように拡張。本 PR では受領のみで prompt には未連携 (= 観測経路の確保
   * のみ)。M3 で「親 A の負けトレードに対してどの ModuleParent を選んで filter
   * 追加するか」を LLM に判断させる prompt 改修を行う。
   */
  async generateCrossovers(
    elites: StrategyDSL[],
    scores: Map<string, number>,
    pairCount: number,
    options?: {
      /** Filter Evolution M4: フィルタ素材候補 (= moduleParentRegistry から選別済) */
      readonly moduleParents?: readonly ModuleParent[];
    },
  ): Promise<StrategyDSL[]> {
    // M4 観測ログ: moduleParents を受領した事実だけ残す (= 件数・カテゴリ集計、prompt 未使用)
    if (options?.moduleParents && options.moduleParents.length > 0) {
      const byCategory: Record<string, number> = {};
      for (const m of options.moduleParents) {
        byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
      }
      console.info(
        `[CrossoverAgent] M4 moduleParents received count=${options.moduleParents.length} byCategory=${JSON.stringify(byCategory)} (= prompt 未連携、M3 で接続予定)`,
      );
    }
    if (elites.length < 2) return [];
    const out: StrategyDSL[] = [];
    const system = await this.resolveSystemPrompt();
    let llmAttempted = false;
    let attempts = 0;
    // 4a.PDCA: 失敗バケットを集計してループ後に 1 回だけログ (per-iteration ログだとノイズが多いため)
    const failureBuckets = {
      apiError: 0, // withRetries 全失敗 (4xx/5xx/ネットワーク)
      noContent: 0, // API は成功したが content が空
      jsonExtract: 0,
      zodInvalid: 0,
      other: 0,
    };
    let lastPreview: string | null = null;
    let lastApiError: string | null = null;
    outer: for (let i = 0; i < elites.length; i++) {
      for (let j = i + 1; j < elites.length; j++) {
        if (attempts >= pairCount) break outer;
        const a = elites[i];
        const b = elites[j];
        attempts++;
        llmAttempted = true;
        const line =
          `親A score=${(scores.get(a.id) ?? 0).toFixed(4)}\n親B score=${(scores.get(b.id) ?? 0).toFixed(4)}`;
        const user =
          `${line}\n\n親A:\n${JSON.stringify(a, null, 2)}\n\n親B:\n${JSON.stringify(b, null, 2)}\n\n` +
          `上記2つを交配した「1件」の StrategyDSL だけを JSON オブジェクトで返してください（配列にしない）。`;

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
          failureBuckets.apiError++;
          lastApiError = result.error instanceof Error ? result.error.message : String(result.error);
          continue;
        }
        const res = result.value;
        if (!res?.content) {
          failureBuckets.noContent++;
          continue;
        }
        lastPreview = res.content.slice(0, 240).replace(/\s+/g, ' ');
        try {
          const extracted = extractJson(res.content);
          if (!extracted.ok) {
            failureBuckets.jsonExtract++;
            continue;
          }
          const r = StrategyDSLSchema.safeParse(extracted.data);
          if (!r.success) {
            failureBuckets.zodInvalid++;
            continue;
          }
          out.push({
            ...r.data,
            id: `x-${randomUUID()}`,
            generation: Math.max(a.generation, b.generation) + 1,
            parentIds: [a.id, b.id],
          });
        } catch {
          failureBuckets.other++;
        }
      }
    }
    // 4a.PDCA: 試行に対して 1 件も成功しなかったら、失敗内訳をログに残す
    if (llmAttempted && out.length === 0) {
      console.warn(
        `[CrossoverAgent] generateCrossovers: ${attempts} 試行で 0 件成功。` +
          `内訳 apiError=${failureBuckets.apiError} noContent=${failureBuckets.noContent} ` +
          `jsonExtract=${failureBuckets.jsonExtract} zodInvalid=${failureBuckets.zodInvalid} ` +
          `other=${failureBuckets.other}` +
          (lastApiError ? `。最後の API エラー: ${lastApiError}` : '') +
          (lastPreview ? `。最後の応答先頭: ${lastPreview}` : ''),
      );
    }
    // Critical-3 PR-2: LLM を 1 回でも試みた場合のみ recordUsage(全失敗なら null で score=0)
    if (llmAttempted) {
      await recordAgentUsage('crossover', { pairCount }, out.length > 0 ? out : null);
    }
    return out;
  }
}
