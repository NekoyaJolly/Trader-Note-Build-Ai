/**
 * 交配オペレーター（LLM）（Phase 5）
 *
 * @see docs/design/phase_5_specification.md §4.6
 */

import { randomUUID } from 'crypto';

import { AIProvider, type ChatMessage } from '../agent/aiProvider';
import { loadPromptWithGlobal } from '../prompts/loader';
import { PromptRegistry } from '../prompts/registry/PromptRegistry';
import { StrategyDSLSchema, type StrategyDSL } from '../strategy_dsl/schema';
import { modelFor } from '../../config';
import { extractJson } from './llmJsonExtract';

async function withRetries<T>(fn: () => Promise<T>, times = 3): Promise<T | null> {
  let last: unknown;
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
    }
  }
  console.error('[CrossoverAgent] リトライ尽くし', last);
  return null;
}

export class CrossoverAgent {
  constructor(private readonly ai = new AIProvider({ model: modelFor('crossover') })) {}

  /**
   * Phase 6.7a: PromptRegistry.getCompositeActive で DB の __global__ + crossover active を合成。
   * Registry 未 seed / DB 不整合時は loadPromptWithGlobal にフォールバック。
   */
  private async resolveSystemPrompt(): Promise<string> {
    const registry = new PromptRegistry();
    try {
      return await registry.getCompositeActive('crossover');
    } catch (err) {
      console.warn(
        '[Crossover] Registry 合成に失敗、ファイル fallback:',
        err instanceof Error ? err.message : err,
      );
      return loadPromptWithGlobal('crossover');
    }
  }

  /**
   * エリート集合からペアを組み、子個体を生成
   */
  async generateCrossovers(
    elites: StrategyDSL[],
    scores: Map<string, number>,
    pairCount: number,
  ): Promise<StrategyDSL[]> {
    if (elites.length < 2) return [];
    const out: StrategyDSL[] = [];
    const system = await this.resolveSystemPrompt();
    let attempts = 0;
    outer: for (let i = 0; i < elites.length; i++) {
      for (let j = i + 1; j < elites.length; j++) {
        if (attempts >= pairCount) break outer;
        const a = elites[i];
        const b = elites[j];
        attempts++;
        const line =
          `親A score=${(scores.get(a.id) ?? 0).toFixed(4)}\n親B score=${(scores.get(b.id) ?? 0).toFixed(4)}`;
        const user =
          `${line}\n\n親A:\n${JSON.stringify(a, null, 2)}\n\n親B:\n${JSON.stringify(b, null, 2)}\n\n` +
          `上記2つを交配した「1件」の StrategyDSL だけを JSON オブジェクトで返してください（配列にしない）。`;

        const res = await withRetries(() =>
          this.ai.chat(
            [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ] as ChatMessage[],
            { temperature: 0.3, maxTokens: 4096 },
          ),
        );
        if (!res?.content) continue;
        try {
          const extracted = extractJson(res.content);
          if (!extracted.ok) continue;
          const r = StrategyDSLSchema.safeParse(extracted.data);
          if (!r.success) continue;
          out.push({
            ...r.data,
            id: `x-${randomUUID()}`,
            generation: Math.max(a.generation, b.generation) + 1,
            parentIds: [a.id, b.id],
          });
        } catch {
          // skip
        }
      }
    }
    return out;
  }
}
