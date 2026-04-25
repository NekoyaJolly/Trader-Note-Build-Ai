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
import { PromptRegistry } from '../../prompts/registry/PromptRegistry';
import {
  selectVariant,
  type RandomGenerator,
} from '../../prompts/registry/variantSelector';
import { getScoringFunction } from '../../prompts/abtest/scoringFunctions';
import type { PromptVersion } from '../../prompts/registry/types';

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

/**
 * Phase 6.6: 専門家エージェント共通の variantSelector 接続ランナー。
 *
 * 流れ:
 *   1. PromptRegistry から active / experimental を取得
 *   2. selectVariant で確率的選択(experimental は 20% 以下)
 *   3. 選ばれたプロンプトで LLM 呼出 + バリデーション
 *   4. scoringFunctions[agentName] で即時スコアリング → recordUsage
 *   5. experimental 失敗時は active で自動再試行(再度スコアリング・recordUsage)
 *
 * registry に active が無い / 読み込み失敗時は fallbackSystemPrompt で単純実行
 * (スコアリングなし、recordUsage なし、従来互換)。
 */
export interface SpecialistVariantRunOptions<TOutput> {
  agentName: string;
  userPrompt: string;
  /** registry 未登録時のフォールバックプロンプト(loadPrompt 結果を渡す) */
  fallbackSystemPrompt: string;
  /** スコアリング関数に渡す入力(snapshot など) */
  scoringInput: unknown;
  /** LLM 応答 JSON をバリデートする関数(null なら不合格扱い) */
  validate: (raw: unknown) => TOutput | null;
  /** PromptRegistry(テスト差し替え可) */
  registry?: PromptRegistry;
  /** 乱数生成器(テスト差し替え可) */
  rand?: RandomGenerator;
}

export interface SpecialistVariantRunResult<TOutput> {
  output: TOutput | null;
  usedVersionId: string | null;
  wasExperimental: boolean;
  fellBackToActive: boolean;
  score: number;
  success: boolean;
  /** fallback 経路(registry 未使用)で動いたか */
  usedFallbackPrompt: boolean;
}

export async function runSpecialistWithVariant<TOutput>(
  ai: AIProvider,
  options: SpecialistVariantRunOptions<TOutput>,
): Promise<SpecialistVariantRunResult<TOutput>> {
  const registry = options.registry ?? new PromptRegistry();
  const rand = options.rand ?? Math.random;
  const scoreFn = getScoringFunction(options.agentName);

  // 1. variant 候補取得
  //    getActive と getExperimental は独立した try/catch で処理する:
  //    - active 失敗 → 本当に fallbackSystemPrompt 経路へ (variant 選択できない)
  //    - experimental 失敗 → active のみで続行 (variant 選択の片方が欠けるだけ)
  let active: PromptVersion | null = null;
  let experimentals: PromptVersion[] = [];
  try {
    active = await registry.getActive(options.agentName);
  } catch (err) {
    console.warn(
      `[${options.agentName}] active prompt の registry 読込失敗、fallback 経路へ:`,
      err instanceof Error ? err.message : err,
    );
  }
  if (active) {
    try {
      experimentals = await registry.getExperimental(options.agentName);
    } catch (err) {
      console.warn(
        `[${options.agentName}] experimental prompt の registry 読込失敗、active のみで続行:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // registry に active が無ければ fallback 単純実行
  if (!active) {
    const out = await runSingle(ai, options.fallbackSystemPrompt, options.userPrompt, options.validate);
    return {
      output: out,
      usedVersionId: null,
      wasExperimental: false,
      fellBackToActive: false,
      score: out ? 1 : 0,
      success: !!out,
      usedFallbackPrompt: true,
    };
  }

  // 2. variant 選択
  const selection = selectVariant(active, experimentals, rand);

  // 3. 1 回目の試行 + スコア + recordUsage
  //    Phase 6.7a: Registry の `__global__` active + variant の content を合成（DB 正）
  const primarySystem = await composeSpecialistSystemPrompt(registry, selection.selected.content);
  const primaryOut = await runSingle(ai, primarySystem, options.userPrompt, options.validate);
  const primaryScore = scoreAndSuccess(primaryOut, options.scoringInput, scoreFn);
  await safeRecord(registry, selection.selected.id, primaryScore.score, primaryScore.success, options.agentName);

  if (primaryScore.success) {
    return {
      output: primaryOut,
      usedVersionId: selection.selected.id,
      wasExperimental: selection.isExperimental,
      fellBackToActive: false,
      score: primaryScore.score,
      success: true,
      usedFallbackPrompt: false,
    };
  }

  // 4. experimental 失敗時のみ active で再試行
  if (selection.isExperimental) {
    const activeSystem = await composeSpecialistSystemPrompt(registry, active.content);
    const fbOut = await runSingle(ai, activeSystem, options.userPrompt, options.validate);
    const fbScore = scoreAndSuccess(fbOut, options.scoringInput, scoreFn);
    await safeRecord(registry, active.id, fbScore.score, fbScore.success, options.agentName);
    return {
      output: fbOut,
      usedVersionId: active.id,
      wasExperimental: false,
      fellBackToActive: true,
      score: fbScore.score,
      success: fbScore.success,
      usedFallbackPrompt: false,
    };
  }

  // active 自体の失敗は諦めて結果をそのまま返す(null)
  return {
    output: primaryOut,
    usedVersionId: selection.selected.id,
    wasExperimental: false,
    fellBackToActive: false,
    score: primaryScore.score,
    success: false,
    usedFallbackPrompt: false,
  };
}

/** 単一プロンプトで LLM 呼出 → JSON 抽出 → バリデート。失敗時 null。 */
async function runSingle<TOutput>(
  ai: AIProvider,
  systemPrompt: string,
  userPrompt: string,
  validate: (raw: unknown) => TOutput | null,
): Promise<TOutput | null> {
  try {
    const res = await ai.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ] as ChatMessage[],
      { temperature: 0.3, maxTokens: 4096 },
    );
    if (!res.content) return null;
    const extracted = extractJson(res.content);
    if (!extracted.ok) return null;
    return validate(extracted.data);
  } catch (err) {
    console.error('[specialist LLM] 呼出失敗:', err);
    return null;
  }
}

async function composeSpecialistSystemPrompt(
  registry: PromptRegistry,
  content: string,
): Promise<string> {
  const maybeSpecialist = registry as {
    composeSpecialistWithGlobalAndCommon?: (localContent: string) => Promise<string>;
    composeGlobalWithContent?: (localContent: string) => Promise<string>;
  };
  if (typeof maybeSpecialist.composeSpecialistWithGlobalAndCommon === 'function') {
    return maybeSpecialist.composeSpecialistWithGlobalAndCommon(content);
  }
  if (typeof maybeSpecialist.composeGlobalWithContent === 'function') {
    return maybeSpecialist.composeGlobalWithContent(content);
  }
  return content;
}

function scoreAndSuccess<TOutput>(
  output: TOutput | null,
  scoringInput: unknown,
  scoreFn: ReturnType<typeof getScoringFunction>,
): { score: number; success: boolean } {
  if (!output) return { score: 0, success: false };
  const raw = scoreFn ? scoreFn(scoringInput, output as unknown) : 1;
  const score = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
  return { score, success: score >= 0.3 };
}

async function safeRecord(
  registry: PromptRegistry,
  versionId: string,
  score: number,
  success: boolean,
  agentName: string,
): Promise<void> {
  try {
    await registry.recordUsage(versionId, { score, success });
  } catch (err) {
    console.warn(
      `[${agentName}] recordUsage 失敗 (id=${versionId}):`,
      err instanceof Error ? err.message : err,
    );
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
