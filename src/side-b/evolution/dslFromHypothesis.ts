/**
 * EdgeHypothesis → StrategyDSL 逆変換 (Critical-4 PR #98)
 *
 * 既存の `EdgeHypothesis` 資産を進化ループの親素材として再利用するための変換層。
 *
 * 設計方針:
 * - 変換できない仮説は warning + skip (= 失敗ではなく正常動作)
 * - LLM 補完を呼ばない
 * - symbol / timeframe / direction / risk を勝手に都合よく補完しない
 * - StrategyDSLSchema.safeParse を必ず通す
 * - validation 失敗は握りつぶさず failureReason として返す
 *
 * @see docs/design/pr_98_edge_hypothesis_to_strategy_dsl_agent_prompt.md
 */

import type { EdgeHypothesis } from '../models/edgeHypothesis';
import {
  StrategyDSLSchema,
  type StrategyDSL,
  type Condition as DSLCondition,
} from '../strategy_dsl/schema';
import { normalizeTimeframe } from '../constants/timeframes';

// =================================================================
// 型定義
// =================================================================

export type DslFromHypothesisFailureReason =
  | 'missing_hypothesis_id'
  | 'missing_conditions'
  | 'unsupported_condition_shape'
  | 'unsupported_direction'
  | 'missing_symbol'
  | 'missing_timeframe'
  | 'missing_regime_target'
  | 'missing_risk_rule'
  | 'schema_validation_failed'
  | 'unsupported_shape';

export interface DslFromHypothesisResult {
  ok: boolean;
  strategyDsl?: StrategyDSL;
  failureReason?: DslFromHypothesisFailureReason;
  warnings: string[];
}

// =================================================================
// 内部 helper
// =================================================================

/**
 * EdgeHypothesis から安定した DSL ID を生成する。
 * 同一仮説が再ロードされても同じ DSL ID を返すため、parent pool で重複扱いになる。
 */
export function stableDslIdFromHypothesis(hypothesisId: string): string {
  return `edge-hypothesis-${hypothesisId}`;
}

/**
 * MachineReadableCondition (EdgeHypothesis 側) を DSLCondition (StrategyDSL 側) に
 * フィールド名換装する。両者は意味的に同じだが key が違う:
 *   EdgeHypothesis: lensName / featureKey / op / value
 *   StrategyDSL:    lens     / feature    / op / value
 *
 * value の型は EdgeHypothesis 側の方がやや広い (`[number, number]` / `string[]`) が、
 * StrategyDSL の Condition value も同じ union を許容する。
 */
function mapConditionToDsl(c: EdgeHypothesis['conditions'][number]): DSLCondition {
  // tuple [number, number] と string[] は readonly に変換する必要なし、そのまま渡せる
  return {
    lens: c.lensName,
    feature: c.featureKey,
    op: c.op,
    value: c.value as DSLCondition['value'],
  };
}

// =================================================================
// 公開 API
// =================================================================

/**
 * EdgeHypothesis を StrategyDSL に逆変換する。
 *
 * 例外を投げない。変換不能な場合は `ok: false` + `failureReason` を返し、
 * 警告は `warnings` に蓄積する。
 *
 * `parameters: {}` で固定 (= EdgeHypothesis に対応する parameter 構造がないため)。
 * 詳細値はすでに condition の value に埋め込まれている前提。
 *
 * `metadata.createdBy` は schema enum の都合で `'llm_generated'` を採用 (= 既存
 * EdgeHypothesis の多くは LLM 生成). `metadata.description` に元の hypothesis ID と
 * status を必ず残す (parent pool の dedup / observability 用)。
 */
export function dslFromHypothesis(hypothesis: EdgeHypothesis): DslFromHypothesisResult {
  const warnings: string[] = [];

  if (!hypothesis.id) {
    return { ok: false, failureReason: 'missing_hypothesis_id', warnings };
  }

  // --- direction ---
  if (hypothesis.expectedDirection !== 'long' && hypothesis.expectedDirection !== 'short') {
    // 'either' 等は StrategyDSL.entry.direction に存在しないので変換不能
    return {
      ok: false,
      failureReason: 'unsupported_direction',
      warnings: [`expectedDirection=${hypothesis.expectedDirection} は DSL 非対応 (long/short のみ)`],
    };
  }

  // --- symbol ---
  const rawSymbol = hypothesis.symbols?.[0];
  if (!rawSymbol || rawSymbol.length === 0) {
    return { ok: false, failureReason: 'missing_symbol', warnings };
  }

  // --- timeframe ---
  const rawTimeframe = hypothesis.timeframes?.[0];
  if (!rawTimeframe || rawTimeframe.length === 0) {
    return { ok: false, failureReason: 'missing_timeframe', warnings };
  }
  const timeframe = normalizeTimeframe(rawTimeframe);
  if (rawTimeframe !== timeframe) {
    warnings.push(`timeframe '${rawTimeframe}' を '${timeframe}' に正規化 (= hashStrategyDsl 等と整合)`);
  }

  // --- conditions ---
  if (!hypothesis.conditions || hypothesis.conditions.length === 0) {
    return { ok: false, failureReason: 'missing_conditions', warnings };
  }

  const dslConditions: DSLCondition[] = [];
  for (const c of hypothesis.conditions) {
    if (!c.lensName || !c.featureKey || !c.op) {
      return {
        ok: false,
        failureReason: 'unsupported_condition_shape',
        warnings: [...warnings, `条件の必須フィールドが欠損: ${JSON.stringify(c)}`],
      };
    }
    dslConditions.push(mapConditionToDsl(c));
  }

  // --- risk rule (defaultRiskManagement) ---
  // EdgeHypothesis.defaultRiskManagement は optional だが、StrategyDSL.stopLoss /
  // takeProfit は必須。欠損時は missing_risk_rule で失敗させ、勝手に補完しない。
  const rm = hypothesis.defaultRiskManagement;
  if (!rm || !rm.stopLoss || !rm.takeProfit) {
    return { ok: false, failureReason: 'missing_risk_rule', warnings };
  }

  // --- regime target ---
  // EdgeHypothesis には直接の regime フィールドがない (category はあるが意味が違う)。
  // 親プールのレジーム引数とは独立して扱うため、'unknown' を採用 (DSL.regimeTarget
  // は z.string() で自由文字列、空でなければ何でも通る)。
  const regimeTarget = 'unknown';
  warnings.push('regimeTarget=unknown (EdgeHypothesis に直接の regime フィールドなし)');

  // --- DSL 組み立て ---
  const dslId = stableDslIdFromHypothesis(hypothesis.id);
  const description =
    `imported from EdgeHypothesis ${hypothesis.id} (status=${hypothesis.status}). ` +
    `original statement: ${hypothesis.statement?.slice(0, 120) ?? ''}`;

  const raw: unknown = {
    id: dslId,
    generation: 0,
    parentIds: [] as string[],
    regimeTarget,
    symbol: rawSymbol,
    timeframe,
    entry: {
      direction: hypothesis.expectedDirection,
      trigger: {
        logic: 'AND' as const,
        conditions: dslConditions,
      },
      orderType: 'market' as const,
    },
    stopLoss: rm.stopLoss,
    takeProfit: rm.takeProfit,
    parameters: {},
    metadata: {
      createdAt: new Date().toISOString(),
      // schema enum の都合上 'edge_hypothesis_import' は使えないため 'llm_generated' を採用
      // (= 多くの EdgeHypothesis は LLM 生成由来であり、意味的にも近い)
      createdBy: 'llm_generated' as const,
      description,
    },
  };

  const parsed = StrategyDSLSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((iss) => `${iss.path.join('.') || '(root)'}: ${iss.message}`);
    return {
      ok: false,
      failureReason: 'schema_validation_failed',
      warnings: [...warnings, `Zod issues: ${issues.join(' | ')}`],
    };
  }

  return { ok: true, strategyDsl: parsed.data, warnings };
}
