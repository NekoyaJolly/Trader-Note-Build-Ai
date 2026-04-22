/**
 * Phase 6: 専門家エージェントの共通処理
 *
 * - レンズスナップショットの担当レンズ絞り込み(ユーザープロンプト構築用)
 * - LLM 呼び出し(JSON レスポンス) + 3 回リトライ
 * - JSON パース
 */

import type { AIProvider, ChatMessage } from '../../agent/aiProvider';
import type { LensFeatureSnapshot } from '../../lenses';
import { extractJson } from '../llmJsonExtract';

export const SPECIALIST_REQUEST_TIMEOUT_MS = 60_000;

/** 指定したレンズ名だけを抽出した文字列ダンプを作る。存在しないレンズはセクション省略。 */
export function formatLensDump(
  snapshot: LensFeatureSnapshot,
  lensNames: readonly string[],
): string {
  const lines: string[] = [];
  for (const lensName of lensNames) {
    const feature = snapshot.features.get(lensName);
    if (!feature) {
      lines.push(`### ${lensName}\n(未取得)`);
      continue;
    }
    lines.push(`### ${lensName}`);
    for (const [k, v] of Object.entries(feature.features)) {
      lines.push(`- ${k}: ${JSON.stringify(v)}`);
    }
  }
  return lines.join('\n');
}

/**
 * LLM を呼び出して JSON 応答を取得する共通ルーチン。
 * 失敗時は null を返す(例外は投げない、呼び出し側でフォールバック可能にするため)。
 */
export async function callLLMForJson(
  ai: AIProvider,
  systemPrompt: string,
  userPrompt: string,
  retries = 3,
): Promise<unknown | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await ai.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ] as ChatMessage[],
        { temperature: 0.3, maxTokens: 4096 },
      );
      if (!res.content) continue;
      const parsed = parseJsonLoose(res.content);
      if (parsed !== null) return parsed;
    } catch (err) {
      // リトライ
      if (i === retries - 1) {
        console.error('[specialist LLM] リトライ尽くし:', err);
      }
    }
  }
  return null;
}

/**
 * Markdown フェンス付き / 前後に説明が付いた JSON を抜き出してパース。失敗時 null。
 *
 * Phase 6 hotfix: `extractJson` に統一 (raw → fence → bracket の 3 段階 fallback)。
 * 応答本文中の ``` 誤マッチを回避、max_tokens 打ち切りの Unterminated string にも
 * 対応。
 */
export function parseJsonLoose(content: string): unknown | null {
  const extracted = extractJson(content);
  return extracted.ok ? extracted.data : null;
}

/** 数値を [min, max] にクランプ。非数値は fallback。 */
export function clampNumber(x: unknown, min: number, max: number, fallback: number): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, x));
}

/** 文字列が与えられた列挙値のいずれかに一致するか。違えば fallback。 */
export function pickEnum<T extends string>(
  x: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof x === 'string' && (allowed as readonly string[]).includes(x)
    ? (x as T)
    : fallback;
}
