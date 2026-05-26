/**
 * IndicatorSpecialist (Phase 6.8, 2026-05-27)
 *
 * 旧 Phase 6 の 3 体並列 Specialist (Trend / Oscillator / VolatilityVolume) を統合した
 * テクニカル分析の専門家エージェント。
 *
 * 設計書: docs/architecture/INDICATOR_SPECIALIST_DESIGN.md
 *
 * 役割:
 * - analysis-engine が計算した **Phase 1 固定 10 種の indicator** (P0+P1、`indicatorCatalog.ts`)
 *   の計算済み値を、現在 TF + 上位 TF (MTF) で受け取り、テクニカル状態を統合的に解釈する
 * - 計算は行わない (= 決定論的計算は analysis-engine の責任)
 * - 出力は `IndicatorAnalysis` (= 旧 3 体出力の和集合 + MTF 整合性判断)
 *
 * Phase 2 以降で必要に応じて P2 indicator (dema/tema/kc/psar/mfi/roc/cmf 等) を CATALOG に
 * 追加可能。型 (`TimeframeData.indicators`) は shared registry 全体を受け入れる構造。
 */

import { AIProvider } from '../../agent/aiProvider';
import { loadSpecialistPromptWithGlobalAndCommon, type PromptMacros } from '../../prompts/loader';
import { modelFor } from '../../../config';
import { parseJsonLoose } from './specialistCommon';
import { INDICATOR_CATALOG, renderIndicatorCatalog } from './indicatorCatalog';
import type { IndicatorId } from '../../../shared/indicators/registry';
import {
  IndicatorAnalysisSchema,
  type IndicatorAnalysis,
  type IndicatorSeries,
  type IndicatorSpecialistInput,
  type TimeframeData,
} from './types';

// ============================================================================
// 変換ヘルパー
// ============================================================================

/**
 * analysis-engine `/v1/indicator-series` レスポンス (= `Array<number | null>`) を
 * IndicatorSeries (= latest/previous/recentValues/summary) に整形する。
 *
 * @param values 直近 → 過去ではなく、過去 → 直近の順で並んだ数値配列 (analysis-engine の規約)
 * @param recentN summary / recentValues に含める直近期間 (既定 20)
 */
export function toIndicatorSeries(
  values: Array<number | null>,
  recentN = 20,
): IndicatorSeries {
  const latest = values.length > 0 ? values[values.length - 1] : null;
  const previous = values.length > 1 ? values[values.length - 2] : null;
  const recentValues = values.slice(-recentN);

  const nonNull = recentValues.filter((v): v is number => v !== null);
  let summary: IndicatorSeries['summary'];
  if (nonNull.length > 0) {
    const mean = nonNull.reduce((a, b) => a + b, 0) / nonNull.length;
    const variance =
      nonNull.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / nonNull.length;
    const std = Math.sqrt(variance);
    summary = { mean, std, min: Math.min(...nonNull), max: Math.max(...nonNull) };
  }

  return { latest, previous, recentValues, summary };
}

/**
 * `IndicatorSeries` を prompt 用の 1 行 string に整形。
 * 不在 indicator は "(unavailable)"、値ありは "latest=X.XX prev=Y.YY mean=Z.ZZ" のような形。
 */
function formatIndicatorForPrompt(series: IndicatorSeries | undefined): string {
  if (!series) return '(unavailable)';
  const fmt = (v: number | null): string => (v === null ? 'null' : v.toFixed(5));
  const parts: string[] = [`latest=${fmt(series.latest)}`, `prev=${fmt(series.previous)}`];
  if (series.summary) {
    parts.push(`mean=${series.summary.mean.toFixed(5)}`);
    parts.push(`std=${series.summary.std.toFixed(5)}`);
  }
  return parts.join(' ');
}

/**
 * 過去キャッシュ (= 前回・前々回 fetch の latest) を prompt 用 1 行 string に整形。
 *
 * 出力形式 (空白区切り、括弧なし):
 *   - 履歴あり + 前回 latest と現在 latest 両方 number: `prev=X.XXXXX Δ=±Y.YYYYY penult=Z.ZZZZZ`
 *   - 履歴ありで Δ 計算不可 (= 片方が null): `prev=X.XXXXX penult=Z.ZZZZZ`
 *   - 履歴なし: `(no history)`
 *
 * Δ は `latestNow - previousLatest` (= 増減の方向 + 大きさ)。
 */
function formatHistoricalForPrompt(
  latestNow: number | null | undefined,
  history?: { previousLatest?: number | null; penultimateLatest?: number | null },
): string {
  if (!history || (history.previousLatest === undefined && history.penultimateLatest === undefined)) {
    return '(no history)';
  }
  const fmt = (v: number | null | undefined): string =>
    v === null || v === undefined ? 'null' : v.toFixed(5);
  const parts: string[] = [];
  if (history.previousLatest !== undefined) {
    parts.push(`prev=${fmt(history.previousLatest)}`);
    if (
      typeof latestNow === 'number' &&
      typeof history.previousLatest === 'number'
    ) {
      const delta = latestNow - history.previousLatest;
      const sign = delta >= 0 ? '+' : '';
      parts.push(`Δ=${sign}${delta.toFixed(5)}`);
    }
  }
  if (history.penultimateLatest !== undefined) {
    parts.push(`penult=${fmt(history.penultimateLatest)}`);
  }
  return parts.join(' ');
}

/**
 * `IndicatorSpecialistInput` を flat な `PromptMacros` 辞書に展開する。
 *
 * 既存 `expandMacros` (src/side-b/prompts/loader.ts) は `{{KEY}}` の flat 単純置換で、
 * ドット記法 (= `{{current.indicators.rsi}}`) は解決しない。そのため、prompt の placeholder
 * を flat キー (= `currentRsi`, `higherRsi` 等) で受けるよう構造化する。
 *
 * Phase 6.8 Step 3b で `currentXxxHistory` / `higherXxxHistory` flat キー (= 前回・前々回
 * fetch の latest 値 + Δ) も追加 (`formatHistoricalForPrompt()` 経由)。
 *
 * @returns prompt template の `{{xxx}}` 各キーに対応した値を持つ辞書
 */
export function buildMacros(input: IndicatorSpecialistInput): PromptMacros {
  const macros: PromptMacros = {
    symbol: input.symbol,
    currentTimeframe: input.currentTimeframe,
    higherTimeframe: input.higherTimeframe,
    latestClose: input.current.priceContext.latestClose.toFixed(5),
    indicatorCatalog: renderIndicatorCatalog(),
  };

  // 各 indicator を current/higher で flat キーに展開
  // (= IndicatorId の各値に対し、currentXxx / higherXxx の 2 キーを生成)
  // Phase 6.8 Step 3b: 履歴がある場合は currentXxxHistory / higherXxxHistory も追加
  for (const spec of INDICATOR_CATALOG) {
    const id = spec.id;
    const cap = capitalize(id);
    const currentSeries = input.current.indicators[id];
    const higherSeries = input.higher.indicators[id];
    macros[`current${cap}`] = formatIndicatorForPrompt(currentSeries);
    macros[`higher${cap}`] = formatIndicatorForPrompt(higherSeries);
    macros[`current${cap}History`] = formatHistoricalForPrompt(
      currentSeries?.latest ?? null,
      input.current.historicalContext?.[id],
    );
    macros[`higher${cap}History`] = formatHistoricalForPrompt(
      higherSeries?.latest ?? null,
      input.higher.historicalContext?.[id],
    );
  }

  return macros;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

// ============================================================================
// IndicatorSpecialist 本体
// ============================================================================

const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;

export class IndicatorSpecialist {
  constructor(
    private readonly ai: AIProvider = new AIProvider({
      model: modelFor('indicator_specialist'),
    }),
  ) {}

  /**
   * テクニカル分析を実行。失敗時 (= LLM error / JSON parse 失敗 / Zod 検証失敗) は null。
   *
   * リトライ: 最大 2 回 (exponential backoff: 1s, 2s)。
   * 並列 LLM rate limit (= 429) 対策として、リトライは backoff を挟む。
   */
  async analyze(input: IndicatorSpecialistInput): Promise<IndicatorAnalysis | null> {
    const systemPrompt = this.buildSystemPrompt(input);
    const userPrompt = this.buildUserPrompt(input);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await this.ai.chat([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ]);
        const parsed = parseJsonLoose(res.content ?? '');
        const validated = IndicatorAnalysisSchema.safeParse(parsed);
        if (validated.success) return validated.data;
        console.warn(
          `[IndicatorSpecialist] Zod 検証失敗 (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
          validated.error.issues.slice(0, 3),
        );
      } catch (err) {
        console.warn(
          `[IndicatorSpecialist] LLM error (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
          err instanceof Error ? err.message : String(err),
        );
      }

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(delay);
      }
    }

    console.error('[IndicatorSpecialist] リトライ尽くし、null を返す');
    return null;
  }

  /**
   * 取得失敗等で IndicatorSpecialist 全体を呼ぶ前提が崩れた場合の判定。
   *
   * P0 必須 indicator (= sma/ema/rsi/macd/atr) が現在 TF で **1 つでも欠落** していたら
   * 解釈の信頼性が低いため null を返すべき (= 呼び出し側で判断、ここでは false を返す)。
   */
  static hasMinimumDataForAnalysis(input: IndicatorSpecialistInput): boolean {
    const p0Ids: IndicatorId[] = ['sma', 'ema', 'rsi', 'macd', 'atr'];
    for (const id of p0Ids) {
      if (!input.current.indicators[id]) return false;
    }
    return true;
  }

  private buildSystemPrompt(input: IndicatorSpecialistInput): string {
    const macros = buildMacros(input);
    return loadSpecialistPromptWithGlobalAndCommon('specialists/indicator_specialist', macros);
  }

  private buildUserPrompt(_input: IndicatorSpecialistInput): string {
    // システムプロンプトに入力データを placeholder 展開で含めるため、
    // user メッセージは出力指示の再確認のみ。
    return [
      '上記のシステムプロンプトに従い、',
      '現在 TF + 上位 TF の indicator 値を統合解釈して、',
      'スキーマに従った JSON オブジェクトだけを返してください。',
      'Markdown フェンス・説明文・余分なテキストは一切付けないでください。',
    ].join('');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// helpers (= TimeframeData 構築用ユーティリティ、aiOrchestrator から利用される)
// ============================================================================

/**
 * indicator id を keyof TimeframeData['indicators'] に絞り、型安全に代入する helper。
 *
 * analysis-engine からの batch 取得結果を整形する際に使う。
 */
export function setIndicatorOnTimeframeData(
  td: TimeframeData,
  id: IndicatorId,
  series: IndicatorSeries,
): void {
  td.indicators[id] = series;
}
