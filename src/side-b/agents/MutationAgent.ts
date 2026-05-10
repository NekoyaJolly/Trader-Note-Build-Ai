/**
 * 変異オペレーター（LLM）（Phase 5）
 *
 * @see docs/design/phase_5_specification.md §4.5
 */

import { randomUUID } from 'crypto';

import type { ZodError } from 'zod';

import { AIProvider, type ChatMessage } from '../agent/aiProvider';
import { formatIndicatorMetadataTable } from '../../shared/indicators/promptTable';
import { formatPatternMetadataTable } from '../../shared/patterns/promptTable';
import { loadPromptWithGlobal, type PromptMacros } from '../prompts/loader';
import { promptRegistry } from '../prompts/registry/PromptRegistry';
import { StrategyDSLSchema, type StrategyDSL } from '../strategy_dsl/schema';
import { modelFor } from '../../config';
import { AI_MAX_TOKENS } from '../../config/aiTokenLimits';
import { extractJson } from './llmJsonExtract';
import { recordAgentUsage } from './scoringRecorder';
import type { RepairHint } from '../evolution/repairHintPolicy';
// Phase C: lessons 注入の共有 helper。CrossoverAgent と同じ module から import することで
// 両 agent 間の結合 (= MutationAgent → CrossoverAgent の依存) を避ける (PR #141 Copilot review #1/#2)。
import { buildLessonsPromptBlock } from './lessonsPrompt';
import { safeStringify } from '../../utils/safeStringify';

/**
 * PR #100: 親候補 ID → RepairHint の対応表。
 * `MutationAgent.generateMutants` の optional 引数として渡され、prompt の補助情報になる。
 *
 * - 既存呼び出し (= repairHints 未指定) は従来挙動を完全に維持する
 * - shouldUseForRepairMutation=false の hint は prompt に含めない (mutation 対象外)
 * - mutation agent には「失敗理由」「target」「変更幅」だけ渡し、修復方針自体は
 *   deterministic に決まっている (= LLM に推測させない)
 */
export type RepairHintMap = ReadonlyMap<string, RepairHint>;

/**
 * 4a.PDCA: API 失敗 (リトライ尽くし) と「応答 content 無し」を区別するため、
 *   discriminated union で結果を返すよう変更。
 *   - { ok: true, value }: fn が成功
 *   - { ok: false, error }: 全リトライ失敗 (HTTP 4xx/5xx, ネットワーク, 認証 等)
 *   PR #100: lint 厳格化に合わせ `unknown` を排除し、Error に正規化して保持する。
 */
type RetryResult<T> = { ok: true; value: T } | { ok: false; error: Error };

async function withRetries<T>(fn: () => Promise<T>, times = 3): Promise<RetryResult<T>> {
  let last: Error = new Error('unknown failure');
  for (let i = 0; i < times; i++) {
    try {
      return { ok: true, value: await fn() };
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
    }
  }
  console.error('[MutationAgent] リトライ尽くし', last);
  return { ok: false, error: last };
}

/**
 * 4a.PDCA: Zod 失敗時の最初の `path → message` を 1 行にまとめる (観測ログ用)。
 */
function summarizeZodIssues(error: ZodError): string {
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
   *
   * PR #117e: `{{INDICATOR_METADATA_TABLE}}` macro を registry から動的に注入する。
   * Registry 経路もファイル経路も同じ macros 辞書を渡すため、両方で展開される。
   *
   * PR ②-2: `{{PATTERN_METADATA_TABLE}}` macro を pattern registry から注入。
   * LLM が pattern (= ローソク足パターン 12 種) の意味 / 用法を理解して
   * pattern ベース戦略を生成できるようにする。
   */
  private async resolveSystemPrompt(): Promise<string> {
    const macros: PromptMacros = {
      INDICATOR_METADATA_TABLE: formatIndicatorMetadataTable(),
      PATTERN_METADATA_TABLE: formatPatternMetadataTable(),
    };
    try {
      return await promptRegistry.getCompositeActive('mutation', macros);
    } catch (err) {
      console.warn(
        '[MutationAgent] Registry 合成に失敗、ファイル fallback:',
        safeStringify(err),
      );
      return loadPromptWithGlobal('mutation', macros);
    }
  }

  /**
   * エリート群とスコア説明を渡し、変異個体を生成
   *
   * PR #100: optional `repairHints` を渡すと、各親 (elite.id) に紐づく failureReason /
   *   target / 変更幅を prompt に同梱する。`shouldUseForRepairMutation=false` の hint は
   *   prompt から除外され、mutation 対象外となる。`repairHints` 未指定時は従来挙動を維持。
   */
  async generateMutants(
    elites: StrategyDSL[],
    scores: Map<string, number>,
    count: number,
    repairHints?: RepairHintMap,
  ): Promise<StrategyDSL[]> {
    if (elites.length === 0) return [];

    // PR #100 review: shouldExcludeFromParentPool=true の親 (= dsl_missing 等の fatal 系) は
    // payload (= elites JSON) からも完全に除外する。prompt 節から落とすだけでは LLM が
    // 親 DSL 自体を mutation 材料にしてしまい、設計書 §基本方針.4 に反する。
    let effectiveElites = elites;
    let excludedCount = 0;
    if (repairHints && repairHints.size > 0) {
      effectiveElites = elites.filter((e) => {
        const hint = repairHints.get(e.id);
        if (hint && hint.shouldExcludeFromParentPool) {
          excludedCount += 1;
          return false;
        }
        return true;
      });
      if (excludedCount > 0) {
        console.log(
          `[MutationAgent] repairHint除外: fatal 親 ${excludedCount}/${elites.length} 件を mutation 対象から除外`,
        );
      }
    }
    if (effectiveElites.length === 0) {
      console.warn(
        `[MutationAgent] generateMutants: 全親が fatal 除外で空 — mutants=0`,
      );
      await recordAgentUsage('mutation', { count }, null);
      return [];
    }

    const perfLines = effectiveElites.map(
      (e) => `- ${e.id}: score=${(scores.get(e.id) ?? 0).toFixed(4)}`,
    );
    const payload = JSON.stringify(effectiveElites, null, 2);
    const system = await this.resolveSystemPrompt();

    // PR #100: 親 ID と repairHint を 1:1 で並べる。fatal 系は親から既に除外済み。
    const repairLines: string[] = [];
    if (repairHints && repairHints.size > 0) {
      for (const e of effectiveElites) {
        const hint = repairHints.get(e.id);
        if (!hint || !hint.shouldUseForRepairMutation) continue;
        const targets = hint.actions.map((a) => a.target).join(',');
        const scope = hint.actions.map((a) => a.allowedChangeScope).join(',');
        repairLines.push(
          `- ${e.id}: reason=${hint.failureReason} severity=${hint.severity} ` +
            `targets=${targets} scope=${scope} guidance=${hint.mutationGuidance}`,
        );
      }
    }
    const repairSection =
      repairLines.length > 0
        ? `\n失敗修復ヒント (前世代の正式 BT 失敗から deterministic 生成):\n${repairLines.join('\n')}\n` +
          `上記の target を優先して修復し、allowedChangeScope を超える大改変は行わないでください。\n`
        : '';

    // Phase C: エリートの先頭 (= 主たる親) の symbol で agentMemory から lessons を取得して
    // prompt 末尾に注入。複数 symbol が混在する場合は先頭採用 (= 通常 evolutionRegimes は
    // symbol 単位で運用される想定)。lessons 0 件なら何もしない (= 既存挙動と同等)。
    const primarySymbol = effectiveElites[0]?.symbol;
    const lessonsResult = buildLessonsPromptBlock(primarySymbol);
    const lessonsBlock = lessonsResult?.block ?? '';
    if (lessonsResult) {
      console.info(
        `[MutationAgent] Phase C lessons injected symbol=${primarySymbol} count=${lessonsResult.count}`,
      );
    }

    const user =
      `エリート戦略（JSON）:\n${payload}\n\n` +
      `スコア:\n${perfLines.join('\n')}\n` +
      repairSection +
      lessonsBlock +
      `\n上記を参考に、異なる変異を含む戦略をちょうど ${count} 件、JSON 配列のみで返してください。`;

    if (repairLines.length > 0) {
      console.log(
        `[MutationAgent] repairHint適用: ${repairLines.length}/${effectiveElites.length} 親に修復ヒントを反映`,
      );
    }

    const result = await withRetries(() =>
      this.ai.chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ] as ChatMessage[],
        { temperature: 0.4, maxTokens: AI_MAX_TOKENS.HEAVY },
      ),
    );
    if (!result.ok) {
      // 4a.PDCA: API 失敗 (HTTP 4xx/5xx / 認証 / ネットワーク) — silent-empty とは区別
      const reason = result.error instanceof Error ? result.error.message : String(result.error);
      console.warn(
        `[MutationAgent] generateMutants: API 失敗 (リトライ尽くし) — mutants=0。理由: ${reason}`,
      );
      await recordAgentUsage('mutation', { count }, null);
      return [];
    }
    const res = result.value;
    if (!res?.content) {
      // Critical-3 PR-2: LLM 失敗を score=0 で記録
      // 4a.PDCA: API は 200 だが content が空のケース (応答フォーマット異常 / 拒否応答 等)
      console.warn(
        `[MutationAgent] generateMutants: LLM 応答 content が空 (API は成功) — mutants=0`,
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
        // PR #100 review: fatal 除外後の effectiveElites を親系譜の根拠にする。
        generation: Math.max(...effectiveElites.map((e) => e.generation), 0) + 1,
        parentIds: effectiveElites.map((e) => e.id),
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

    const result = await withRetries(() =>
      this.ai.chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ] as ChatMessage[],
        { temperature: 0.8, maxTokens: AI_MAX_TOKENS.HEAVY },
      ),
    );
    if (!result.ok) {
      const reason = result.error instanceof Error ? result.error.message : String(result.error);
      console.warn(
        `[MutationAgent] generateDiverse: API 失敗 (リトライ尽くし) — diverse=0。理由: ${reason}`,
      );
      await recordAgentUsage('mutation', { count }, null);
      return [];
    }
    const res = result.value;
    if (!res?.content) {
      console.warn(
        `[MutationAgent] generateDiverse: LLM 応答 content が空 (API は成功) — diverse=0`,
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
