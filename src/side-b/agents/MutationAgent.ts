/**
 * 変異オペレーター（LLM）（Phase 5）
 *
 * @see docs/design/phase_5_specification.md §4.5
 */

import { randomUUID } from 'crypto';

import { AIProvider, type ChatMessage } from '../agent/aiProvider';
import { loadPromptWithGlobal } from '../prompts/loader';
import { promptRegistry } from '../prompts/registry/PromptRegistry';
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
  console.error('[MutationAgent] リトライ尽くし', last);
  return null;
}

function parseStrategyArray(content: string): StrategyDSL[] {
  const extracted = extractJson(content);
  if (!extracted.ok) {
    throw new Error(`LLM 応答を JSON として解釈できませんでした: ${extracted.error}`);
  }
  const data = extracted.data;
  if (!Array.isArray(data)) {
    throw new Error('応答は JSON 配列である必要があります');
  }
  const out: StrategyDSL[] = [];
  for (const item of data) {
    const r = StrategyDSLSchema.safeParse(item);
    if (r.success) out.push(r.data);
  }
  return out;
}

export class MutationAgent {
  constructor(private readonly ai = new AIProvider({ model: modelFor('mutation') })) {}

  /**
   * Phase 6.7a: PromptRegistry.getCompositeActive で DB の __global__ + mutation active を合成。
   * Registry 未 seed / DB 不整合時は loadPromptWithGlobal にフォールバック。
   */
  private async resolveSystemPrompt(): Promise<string> {
    try {
      return await promptRegistry.getCompositeActive('mutation');
    } catch (err) {
      console.warn(
        '[MutationAgent] Registry 合成に失敗、ファイル fallback:',
        err instanceof Error ? err.message : err,
      );
      return loadPromptWithGlobal('mutation');
    }
  }

  /**
   * エリート群とスコア説明を渡し、変異個体を生成
   */
  async generateMutants(
    elites: StrategyDSL[],
    scores: Map<string, number>,
    count: number,
  ): Promise<StrategyDSL[]> {
    if (elites.length === 0) return [];
    const perfLines = elites.map((e) => `- ${e.id}: score=${(scores.get(e.id) ?? 0).toFixed(4)}`);
    const payload = JSON.stringify(elites, null, 2);
    const system = await this.resolveSystemPrompt();
    const user =
      `エリート戦略（JSON）:\n${payload}\n\n` +
      `スコア:\n${perfLines.join('\n')}\n\n` +
      `上記を参考に、異なる変異を含む戦略をちょうど ${count} 件、JSON 配列のみで返してください。`;

    const res = await withRetries(() =>
      this.ai.chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ] as ChatMessage[],
        { temperature: 0.4, maxTokens: 4096 },
      ),
    );
    if (!res?.content) return [];
    try {
      const parsed = parseStrategyArray(res.content).slice(0, count);
      return parsed.map((p) => ({
        ...p,
        id: p.id && p.id.length > 0 ? p.id : `mut-${randomUUID()}`,
        generation: Math.max(...elites.map((e) => e.generation), 0) + 1,
        parentIds: elites.map((e) => e.id),
      }));
    } catch {
      return [];
    }
  }

  /** 多様性が低いときの探索的変異 */
  async generateDiverse(regime: string, count: number): Promise<StrategyDSL[]> {
    const system = await this.resolveSystemPrompt();
    const user =
      `レジーム: ${regime}\n` +
      `既存と重複しないよう、ランダム性の高い戦略を ${count} 件、JSON 配列のみで返してください。`;

    const res = await withRetries(() =>
      this.ai.chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ] as ChatMessage[],
        { temperature: 0.8, maxTokens: 4096 },
      ),
    );
    if (!res?.content) return [];
    try {
      return parseStrategyArray(res.content)
        .slice(0, count)
        .map((p) => ({
          ...p,
          id: `div-${randomUUID()}`,
          regimeTarget: regime,
          generation: 0,
          parentIds: [],
          metadata: {
            ...p.metadata,
            createdBy: 'llm_generated' as const,
          },
        }));
    } catch {
      return [];
    }
  }
}
