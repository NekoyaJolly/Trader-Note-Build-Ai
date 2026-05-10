/**
 * 交配オペレーター（LLM）（Phase 5 + Filter Evolution M3）
 *
 * @see docs/design/archive/phase_5_specification.md §4.6 (旧仕様、archive 移動済み)
 * @see docs/design/phase_5a_specification.md (Phase 5A 進化探索基盤、現行)
 * @see docs/design/phase_filter_evolution_specification.md §3 (M3)
 *
 * Filter Evolution M3 (2026-05-09):
 * - prompt が「親 A の負けを除去する filter 追加器」に再設計された
 * - 親 A の負けトレード一覧 + ModuleParent 候補を LLM に渡し、filter 条件を AND 追加させる
 * - LLM 出力は wrapper 形式 `{ child_dsl, rejected_loss_count, preserved_win_count, rationale }`
 *   を許容（後方互換のため、direct DSL 形式も引き続き受理する）
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
import type { JsonValue } from '../../utils/jsonValue';
import { extractJson } from './llmJsonExtract';
// Phase C: lessons 注入の共有 helper。MutationAgent も同じ helper を使うため、
// 両 agent 間の結合を避けるべく独立 module に切り出している (PR #141 Copilot review #1/#2)。
import { buildLessonsPromptBlock } from './lessonsPrompt';
import { recordAgentUsage } from './scoringRecorder';
import { safeStringify } from '../../utils/safeStringify';

/**
 * Filter Evolution M3: 親 A の負けトレード概要（= LLM への文脈材料）。
 *
 * - `entryTime`: ISO 8601、時間帯 / 曜日パターンの抽出に使う
 * - `side`: 'long' / 'short'、direction 偏り検出
 * - `pnl`: 負の数値（loss）、大きい abs(pnl) ほど「大損失」のシグナル
 *
 * 本 PR では LLM へのプロンプト材料としてのみ使う（DB には保存しない）。
 */
export interface LossTradeSummary {
  readonly entryTime: string;
  readonly side: 'long' | 'short';
  readonly pnl: number;
}

/**
 * Filter Evolution M3: LLM 応答 wrapper 形式の最大件数（= 観測ログ用の上限）。
 * 親 A の trade 数を超える値が来ても、ログ表記が肥大化しないように上限を設ける。
 */
const MAX_OBSERVATION_COUNT = 100_000;

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

/**
 * Filter Evolution M3: LLM 出力 wrapper 形式の構造判定 + 観測値抽出。
 *
 * extractJson が返す `JsonValue` を入力に取り、wrapper 形式
 * `{ child_dsl: object, rejected_loss_count?, preserved_win_count?, rationale? }`
 * を検出した場合のみ `{ childDsl, observationLog }` を返す。direct DSL 形式や
 * wrapper の形を満たさない値は null を返し、呼び出し側が原データをそのまま
 * StrategyDSLSchema にかける。
 *
 * memory feedback_no_any_unknown.md「any/unknown 禁止」を満たすため、unknown を
 * 介さず JsonValue → JsonObject への narrow で完結させる。
 */
function extractWrapperPayload(
  data: JsonValue,
): { childDsl: JsonValue; observationLog: string } | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  // narrow 後は data 自身が JsonObject 形 — JsonValue の union 分岐は既に除外済み。
  const obj = data;
  const childDsl = obj.child_dsl;
  if (childDsl === undefined || childDsl === null) return null;
  if (typeof childDsl !== 'object' || Array.isArray(childDsl)) return null;

  const rejected = normalizeObservationCount(obj.rejected_loss_count);
  const preserved = normalizeObservationCount(obj.preserved_win_count);
  const rationale = normalizeRationale(obj.rationale);
  const observationLog =
    ` rejected_loss=${rejected ?? 'n/a'} preserved_win=${preserved ?? 'n/a'}` +
    (rationale ? ` rationale="${rationale}"` : '');
  return { childDsl, observationLog };
}

/**
 * Filter Evolution M3: rejected_loss_count / preserved_win_count を観測ログ用に
 * 非負整数 + 上限内に正規化する。LLM が文字列 / 小数 / NaN を出してもログ表記を破壊しない。
 */
function normalizeObservationCount(v: JsonValue | undefined): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  if (n < 0) return 0;
  if (n > MAX_OBSERVATION_COUNT) return MAX_OBSERVATION_COUNT;
  return n;
}

/**
 * Filter Evolution M3: rationale を観測ログ用に短く整形（改行を空白に、長すぎる場合は trunc）。
 */
function normalizeRationale(v: JsonValue | undefined): string | null {
  if (typeof v !== 'string') return null;
  const collapsed = v.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return null;
  return collapsed.length > 400 ? `${collapsed.slice(0, 397)}...` : collapsed;
}

/**
 * Filter Evolution M3: 親 A の loss trade を LLM プロンプトに乗せるための要約形式に変換。
 * 件数が多すぎるとプロンプトが肥大化するため、abs(pnl) 大きい順で先頭 N 件のみ採用する。
 */
function summarizeLossTradesForPrompt(
  losses: readonly LossTradeSummary[],
  topN: number,
): readonly LossTradeSummary[] {
  if (losses.length <= topN) return losses;
  return [...losses].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, topN);
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
        safeStringify(err),
      );
      return loadPromptWithGlobal('crossover', macros);
    }
  }

  /**
   * エリート集合からペアを組み、子個体を生成
   *
   * Filter Evolution M3 (2026-05-09):
   * - prompt 自体が「filter 追加器」に再設計された
   * - `parentLossTrades`: 親 dslId → 負けトレード概要の Map。EvolutionLoop が
   *   `tradesByDslId` から抽出して渡す。LLM の filter 設計の文脈材料となる。
   * - `moduleParents`: ModuleParent 候補を user prompt に注入（M4 PR で受領経路だけ確保し、
   *   M3 で実際に prompt に流す）。
   * - LLM 出力は wrapper 形式 `{ child_dsl, rejected_loss_count, preserved_win_count, rationale }`
   *   と direct DSL 形式の両方を受理する（後方互換）。
   * - rejected_loss_count / preserved_win_count / rationale は **LLM の予想値** であり、
   *   システム側の評価には使わない（観測ログのみ）。
   */
  async generateCrossovers(
    elites: StrategyDSL[],
    scores: Map<string, number>,
    pairCount: number,
    options?: {
      /** Filter Evolution M4: フィルタ素材候補 (= moduleParentRegistry から選別済) */
      readonly moduleParents?: readonly ModuleParent[];
      /**
       * Filter Evolution M3: 親 A の負けトレード概要（dslId 単位）。
       * - 値が空配列 / 未指定の親は "親 A の負けトレード資料なし" として LLM に伝える
       * - LLM はこの一覧から共通負けパターンを抽出し、filter 設計の根拠とする
       */
      readonly parentLossTrades?: ReadonlyMap<string, ReadonlyArray<LossTradeSummary>>;
    },
  ): Promise<StrategyDSL[]> {
    // M4 観測ログ: moduleParents を受領した事実だけ残す (= 件数・カテゴリ集計、prompt 連携は M3 で本実装)
    if (options?.moduleParents && options.moduleParents.length > 0) {
      const byCategory: Record<string, number> = {};
      for (const m of options.moduleParents) {
        byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
      }
      console.info(
        `[CrossoverAgent] M3 moduleParents received count=${options.moduleParents.length} byCategory=${JSON.stringify(byCategory)} (= prompt 連携)`,
      );
    }
    if (elites.length < 2) return [];
    const out: StrategyDSL[] = [];
    const system = await this.resolveSystemPrompt();
    let llmAttempted = false;
    let attempts = 0;
    // 4a.PDCA: 失敗バケットを集計してループ後に 1 回だけログ
    const failureBuckets = {
      apiError: 0,
      noContent: 0,
      jsonExtract: 0,
      zodInvalid: 0,
      other: 0,
    };
    let lastPreview: string | null = null;
    let lastApiError: string | null = null;

    // M3: ModuleParent 候補を user prompt に乗せるためのシリアライズ。
    // recommendedRegimes / typicalValueHint は optional。`JSON.stringify` は undefined の
    // プロパティを出力に含めないため、未指定 entry では該当キーが prompt に出ないが、
    // LLM 側で「素材ヒント不足の素材」と扱える形式なので問題ない（明示的 null 化はしない）。
    const moduleParentBlock =
      options?.moduleParents && options.moduleParents.length > 0
        ? `\n\nmodule_parents (= フィルタ素材候補、id を選んで filter 1 個を構築する):\n${JSON.stringify(
            options.moduleParents.map((m) => ({
              id: m.id,
              category: m.category,
              description: m.description,
              lensName: m.lensName,
              featureKey: m.featureKey,
              typicalOps: m.typicalOps,
              typicalValueHint: m.typicalValueHint,
              recommendedRegimes: m.recommendedRegimes,
            })),
            null,
            2,
          )}`
        : `\n\nmodule_parents: なし (= 親 B から条件 1 つを抽出して filter 化、または汎用 lens から新規構成)`;

    outer: for (let i = 0; i < elites.length; i++) {
      for (let j = i + 1; j < elites.length; j++) {
        if (attempts >= pairCount) break outer;
        const a = elites[i];
        const b = elites[j];
        attempts++;
        llmAttempted = true;

        // M3: 親 A の負けトレード概要を user prompt に注入。
        // 過剰なトークン消費を避けるため、abs(pnl) 上位 30 件に絞る。
        const lossTradesRaw = options?.parentLossTrades?.get(a.id) ?? [];
        const lossTradesForPrompt = summarizeLossTradesForPrompt(lossTradesRaw, 30);
        const lossTradesBlock =
          lossTradesRaw.length > 0
            ? `\n\n親A_loss_trades (= 親 A が直近の本格 BT で記録した負けトレード${
                lossTradesRaw.length > lossTradesForPrompt.length
                  ? `、abs(pnl) 上位 ${lossTradesForPrompt.length} 件を抜粋（全 ${lossTradesRaw.length} 件中）`
                  : `、全 ${lossTradesRaw.length} 件`
              }):\n${JSON.stringify(lossTradesForPrompt, null, 2)}`
            : `\n\n親A_loss_trades: なし (= 親 A は直近で本格 BT 履歴なし、または負けトレード 0 件。一般的な filter を選んでよい)`;

        // Phase C: 親 A の symbol で agentMemory から lessons を取得して prompt 末尾に注入。
        // lessons 0 件 / symbol 不明なら何もしない (= 既存挙動と同等)。
        const lessonsResult = buildLessonsPromptBlock(a.symbol);
        const lessonsBlock = lessonsResult?.block ?? '';
        if (lessonsResult) {
          console.info(
            `[CrossoverAgent] Phase C lessons injected symbol=${a.symbol} count=${lessonsResult.count}`,
          );
        }

        const line =
          `親A score=${(scores.get(a.id) ?? 0).toFixed(4)}\n親B score=${(scores.get(b.id) ?? 0).toFixed(4)}`;
        const user =
          `${line}\n\n親A:\n${JSON.stringify(a, null, 2)}\n\n親B:\n${JSON.stringify(b, null, 2)}` +
          lossTradesBlock +
          moduleParentBlock +
          lessonsBlock +
          `\n\n親 A の base setup を維持しつつ、親 A の負けトレードを除去する filter を 1 つ AND 結合で追加した「1 件」の StrategyDSL を、` +
          `wrapper 形式 \`{ child_dsl, rejected_loss_count, preserved_win_count, rationale }\` で返してください（配列にしない）。`;

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

          // M3: wrapper 形式 / direct DSL 形式の両方を受理。wrapper であれば
          // observation 値（rejected_loss_count / preserved_win_count / rationale）を
          // 抽出してログに残し、`child_dsl` を実 DSL として Zod 検証に流す。
          const wrapper = extractWrapperPayload(extracted.data);
          const dslCandidate: JsonValue = wrapper ? wrapper.childDsl : extracted.data;
          const observationLog = wrapper ? wrapper.observationLog : '';

          const r = StrategyDSLSchema.safeParse(dslCandidate);
          if (!r.success) {
            failureBuckets.zodInvalid++;
            continue;
          }
          const child: StrategyDSL = {
            ...r.data,
            id: `x-${randomUUID()}`,
            generation: Math.max(a.generation, b.generation) + 1,
            parentIds: [a.id, b.id],
          };
          out.push(child);

          // M3 観測ログ: 受け取った filter 設計の予想値を 1 件ずつログ出力（CI / smoke で grep 可能に）。
          if (observationLog) {
            console.info(
              `[CrossoverAgent] M3 child generated dslId=${child.id} parentA=${a.id}${observationLog}`,
            );
          }
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
