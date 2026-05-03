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
import { AI_MAX_TOKENS } from '../../config/aiTokenLimits';
import { extractJson } from './llmJsonExtract';
import { recordAgentUsage } from './scoringRecorder';

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

/**
 * 4a.PDCA: Zod 失敗時の最初の `path → message` を 1 行にまとめる (観測ログ用)。
 */
function summarizeZodIssues(error: import('zod').ZodError): string {
  const top = error.issues.slice(0, 3).map((iss) => {
    const path = iss.path.length > 0 ? iss.path.join('.') : '(root)';
    return `${path}: ${iss.message}`;
  });
  const more = error.issues.length > 3 ? ` …+${error.issues.length - 3} more` : '';
  return top.join(' | ') + more;
}

function parseStrategyArray(content: string): {
  parsed: StrategyDSL[];
  /** 4a.PDCA: 各 item の Zod 失敗内訳 (parsed と等しい長さなら全件成功) */
  zodFailures: string[];
} {
  const extracted = extractJson(content);
  if (!extracted.ok) {
    throw new Error(`LLM 応答を JSON として解釈できませんでした: ${extracted.error}`);
  }
  const data = extracted.data;
  if (!Array.isArray(data)) {
    throw new Error('応答は JSON 配列である必要があります');
  }
  const out: StrategyDSL[] = [];
  const zodFailures: string[] = [];
  for (const item of data) {
    const r = StrategyDSLSchema.safeParse(item);
    if (r.success) {
      out.push(r.data);
    } else {
      zodFailures.push(summarizeZodIssues(r.error));
    }
  }
  return { parsed: out, zodFailures };
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
        { temperature: 0.4, maxTokens: AI_MAX_TOKENS.HEAVY },
      ),
    );
    if (!res?.content) {
      // Critical-3 PR-2: LLM 失敗を score=0 で記録
      // 4a.PDCA: silent-empty を観測可能にする (LLM 応答自体が無い / 空のケース)
      console.warn(
        `[MutationAgent] generateMutants: LLM 応答に content が無い (res=${res ? 'has-no-content' : 'null'}) — mutants=0`,
      );
      await recordAgentUsage('mutation', { count }, null);
      return [];
    }
    try {
      const { parsed, zodFailures } = parseStrategyArray(res.content);
      if (parsed.length < count) {
        // 4a.PDCA: 部分成功 / 全失敗を Zod 失敗内訳付きで観測可能に
        const preview = res.content.slice(0, 1500).replace(/\s+/g, ' ');
        const failSummary = zodFailures.slice(0, 3).join(' || ');
        console.warn(
          `[MutationAgent] generateMutants: parsed=${parsed.length}/${count} (Zod 不適合 ${zodFailures.length} 件)。` +
            (failSummary ? ` 不適合内訳: ${failSummary}` : '') +
            ` 応答先頭: ${preview}`,
        );
      }
      const out = parsed.slice(0, count).map((p) => ({
        ...p,
        id: p.id && p.id.length > 0 ? p.id : `mut-${randomUUID()}`,
        generation: Math.max(...elites.map((e) => e.generation), 0) + 1,
        parentIds: elites.map((e) => e.id),
      }));
      await recordAgentUsage('mutation', { count }, out);
      return out;
    } catch (err) {
      // 4a.PDCA: 旧コードは catch を完全握り潰しで「LLM が JSON を返さなかった」情報が消えていた
      const preview = (res.content ?? '').slice(0, 1500).replace(/\s+/g, ' ');
      console.warn(
        `[MutationAgent] generateMutants: 応答 parse 失敗 (${err instanceof Error ? err.message : String(err)}) — mutants=0。応答先頭: ${preview}`,
      );
      await recordAgentUsage('mutation', { count }, null);
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
        { temperature: 0.8, maxTokens: AI_MAX_TOKENS.HEAVY },
      ),
    );
    if (!res?.content) {
      console.warn(
        `[MutationAgent] generateDiverse: LLM 応答に content が無い (res=${res ? 'has-no-content' : 'null'}) — diverse=0`,
      );
      await recordAgentUsage('mutation', { count }, null);
      return [];
    }
    try {
      const { parsed, zodFailures } = parseStrategyArray(res.content);
      if (parsed.length < count) {
        const preview = res.content.slice(0, 1500).replace(/\s+/g, ' ');
        const failSummary = zodFailures.slice(0, 3).join(' || ');
        console.warn(
          `[MutationAgent] generateDiverse: parsed=${parsed.length}/${count} (Zod 不適合 ${zodFailures.length} 件)。` +
            (failSummary ? ` 不適合内訳: ${failSummary}` : '') +
            ` 応答先頭: ${preview}`,
        );
      }
      const out = parsed
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
      await recordAgentUsage('mutation', { count }, out);
      return out;
    } catch (err) {
      const preview = (res.content ?? '').slice(0, 1500).replace(/\s+/g, ' ');
      console.warn(
        `[MutationAgent] generateDiverse: 応答 parse 失敗 (${err instanceof Error ? err.message : String(err)}) — diverse=0。応答先頭: ${preview}`,
      );
      await recordAgentUsage('mutation', { count }, null);
      return [];
    }
  }
}
