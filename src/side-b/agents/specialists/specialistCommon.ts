/**
 * Phase 6: 専門家エージェントの共通処理
 *
 * - レンズスナップショットの担当レンズ絞り込み(ユーザープロンプト構築用)
 * - LLM 呼び出し(JSON レスポンス) + 3 回リトライ
 * - JSON パース
 */

import type { AIProvider, ChatMessage } from '../../agent/aiProvider';
import type { LensFeatureSnapshot } from '../../lenses';

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
        undefined,
        0.3,
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

/** Markdown フェンス付き / 前後に説明が付いた JSON を抜き出してパース。失敗時 null。 */
export function parseJsonLoose(content: string): unknown | null {
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fence ? fence[1] : content).trim();
  try {
    return JSON.parse(body);
  } catch {
    // 全体がダメなら最初の { から最後の } までを抜き出して再試行
    const first = body.indexOf('{');
    const last = body.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(body.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
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
