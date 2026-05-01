/**
 * Phase 6: PromptMutationAgent
 *
 * 既存プロンプトから改善案を 3 個生成する専門エージェント。
 * PromptRegistry への登録(status='experimental')は呼び出し側で行う設計とし、
 * このエージェント自身は純粋に「提案を作る」責務だけを持つ。
 *
 * 設計原則:
 * - API キー未設定 / 失敗時は空配列を返す(呼び出し側は継続可能)
 * - JSON パースは 3 回リトライ、失敗後は空配列
 * - モックプロバイダーでの動作確認可能(constructor injection)
 * - プロンプトは src/side-b/prompts/prompt_mutation.md から読み込み
 */

import { AIProvider, type ChatMessage } from '../agent/aiProvider';
import { loadPromptWithGlobal } from '../prompts/loader';
import { modelFor } from '../../config';
import type { PromptVersion } from '../prompts/registry/types';
import { extractJson } from './llmJsonExtract';
import {
  GLOBAL_AGENT_NAME,
  SPECIALIST_COMMON_AGENT_NAME,
  promptRegistry,
} from '../prompts/registry/PromptRegistry';
import { recordAgentUsage } from './scoringRecorder';

export interface PromptMutationProposal {
  /** 提案バージョン識別子(呼び出し側で suffix 付与してもよい) */
  version: string;
  /** 新プロンプト本文 */
  content: string;
  /** 変更意図 */
  notes?: string;
  /** 期待される改善 */
  expectedImprovement?: string;
}

export interface RecentFailure {
  /** 失敗した入力(サマリでよい) */
  context: unknown;
  /** 失敗した出力 / エラー概要 */
  output: unknown;
}

export interface ProposeImprovementsInput {
  agentName: string;
  currentPrompt: PromptVersion;
  recentPerformance: {
    avgScore: number;
    recentFailures: RecentFailure[];
  };
  /** 期待する提案数(既定 3) */
  count?: number;
}

async function withRetries<T>(fn: () => Promise<T>, times = 3): Promise<T | null> {
  let last: unknown;
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
    }
  }
  console.error('[PromptMutationAgent] リトライ尽くし', last);
  return null;
}

/**
 * LLM 応答から改善案配列を抽出する。
 *
 * Phase 6 hotfix: `extractJson` 経由で 3 段階 fallback (raw → fence → bracket) を
 * 使うため、応答本文中に ``` を含むプレーン JSON でも誤マッチせずに parse できる。
 * parse 不能なら空配列を返す(呼び出し側はフォールバック可)。
 */
function parseProposalArray(content: string): PromptMutationProposal[] {
  const extracted = extractJson(content);
  if (!extracted.ok) {
    throw new Error(`LLM 応答を JSON として解釈できませんでした: ${extracted.error}`);
  }
  const data = extracted.data;
  if (!Array.isArray(data)) {
    throw new Error('応答は JSON 配列である必要があります');
  }
  const out: PromptMutationProposal[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.version !== 'string' || typeof o.content !== 'string') continue;
    if (o.content.trim().length < 50) continue; // 短すぎる改善案は除外
    out.push({
      version: o.version,
      content: o.content,
      notes: typeof o.notes === 'string' ? o.notes : undefined,
      expectedImprovement:
        typeof o.expectedImprovement === 'string' ? o.expectedImprovement : undefined,
    });
  }
  return out;
}

export class PromptMutationAgent {
  private readonly usesInjectedAi: boolean;

  constructor(ai?: AIProvider) {
    this.ai = ai ?? new AIProvider({ model: modelFor('prompt_mutation') });
    this.usesInjectedAi = ai !== undefined;
  }

  private readonly ai: AIProvider;

  /**
   * Phase 6.7a: PromptRegistry.getCompositeActive で DB の __global__ + prompt_mutation active を合成。
   * Registry 未 seed / DB 不整合時は loadPromptWithGlobal にフォールバック。
   */
  private async resolveSystemPrompt(): Promise<string> {
    try {
      return await promptRegistry.getCompositeActive('prompt_mutation');
    } catch (err) {
      console.warn(
        '[PromptMutationAgent] Registry 合成に失敗、ファイル fallback:',
        err instanceof Error ? err.message : err,
      );
      return loadPromptWithGlobal('prompt_mutation');
    }
  }

  /**
   * 改善案プロンプトを生成する。
   * 失敗時は空配列を返す(握りつぶしではなく、呼び出し側のフォールバックを前提にした設計)。
   *
   * Phase 6.7a: __global__ は変異対象外(安全装置)。
   * グローバルルールは人間承認フロー経由でのみ更新するため、LLM による自動変異を拒否する。
   */
  async proposeImprovements(
    input: ProposeImprovementsInput,
  ): Promise<PromptMutationProposal[]> {
    if (
      input.agentName === GLOBAL_AGENT_NAME ||
      input.agentName === SPECIALIST_COMMON_AGENT_NAME
    ) {
      console.warn(
        `[PromptMutationAgent] ${input.agentName} は変異対象外のため空配列を返します`,
      );
      return [];
    }
    if (
      process.env.NODE_ENV === 'test' &&
      process.env.AI_API_MOCK !== 'false' &&
      !this.usesInjectedAi
    ) {
      return [];
    }
    const count = input.count ?? 3;
    const system = await this.resolveSystemPrompt();
    const user = this.buildUserPrompt(input, count);

    const res = await withRetries(() =>
      this.ai.chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ] as ChatMessage[],
        { temperature: 0.6, maxTokens: 4096 },
      ),
    );
    if (!res?.content) {
      // Critical-3 PR-2: LLM 失敗を score=0 で記録
      await recordAgentUsage('prompt_mutation', { count }, null);
      return [];
    }
    try {
      const out = parseProposalArray(res.content).slice(0, count);
      await recordAgentUsage('prompt_mutation', { count }, out);
      return out;
    } catch (err) {
      console.error('[PromptMutationAgent] JSON パース失敗:', err);
      await recordAgentUsage('prompt_mutation', { count }, null);
      return [];
    }
  }

  private buildUserPrompt(input: ProposeImprovementsInput, count: number): string {
    const failuresDump =
      input.recentPerformance.recentFailures.length === 0
        ? '(失敗サンプルなし)'
        : input.recentPerformance.recentFailures
            .slice(0, 5)
            .map(
              (f, i) =>
                `### Failure ${i + 1}\n- context: ${safeStringify(f.context)}\n- output: ${safeStringify(f.output)}`,
            )
            .join('\n\n');

    return `# プロンプト改善依頼

## 対象エージェント
- agentName: ${input.agentName}
- 現行 version: ${input.currentPrompt.version}
- 現行 avgScore: ${input.recentPerformance.avgScore.toFixed(3)}
- 現行 usageCount: ${input.currentPrompt.usageCount}

## 現行プロンプト本文
\`\`\`
${input.currentPrompt.content}
\`\`\`

## 直近の失敗サンプル
${failuresDump}

## 依頼
上記を踏まえ、**互いに異なる方向性** の改善案プロンプトを ${count} 件、
指定された JSON 配列形式で返してください。`;
  }
}

function safeStringify(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 500 ? s.slice(0, 500) + '…' : s;
  } catch {
    return String(v);
  }
}
