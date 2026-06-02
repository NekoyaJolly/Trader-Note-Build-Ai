/**
 * 進化ループ再設計 Phase 3: Crossover「インジ追加」variant 生成器（決定論）。
 *
 * 親戦略に、テンプレート表（crossoverIndicatorTemplates.ts）のインジを 1 つずつ AND 追加した
 * variant DSL を生成する。閾値・period を複数候補でスイープ。**既存条件・SL/TP は不変**
 * （Mutation との責務分離。設計 §2-2「追加したインジだけ・既存は触らない」）。
 *
 * 純粋・決定論。評価（BT/負け減・勝ち維持判定）と確定は deterministicCrossover.ts。
 */

import {
  CROSSOVER_EDGE_TEMPLATES,
  TEMPLATED_INDICATOR_IDS,
  type EdgeConditionTemplate,
} from './crossoverIndicatorTemplates';
import type { Condition, ConditionGroup, StrategyDSL } from './schema';

export interface CrossoverVariantOptions {
  /** スイープ対象インジ ID の絞り込み（LLM 事前絞り込み用）。未指定なら全テンプレート。 */
  indicatorIds?: readonly string[];
  /** 1 インジあたりの最大 variant 数（閾値×period の上限）。既定 6。 */
  maxVariantsPerIndicator?: number;
  /** 全体の最大 variant 数（コスト上限）。既定 60。 */
  maxTotalVariants?: number;
}

export interface CrossoverVariant {
  /** 親に 1 条件を AND 追加した DSL（既存条件・SL/TP は不変）。 */
  variant: StrategyDSL;
  /** 追加したインジ ID。 */
  indicatorId: string;
  /** 追加条件の人間可読ラベル（観測ログ用）。 */
  label: string;
}

export interface CrossoverVariantsResult {
  variants: CrossoverVariant[];
  /** 実際にスイープしたインジ ID。 */
  indicatorsUsed: string[];
  /** 要求されたがテンプレート未定義でスキップしたインジ ID（silent cap 回避ログ用）。 */
  skippedIndicators: string[];
  /** 間引き前の全 variant 数。 */
  totalCombos: number;
  truncated: boolean;
}

const DEFAULT_MAX_PER_INDICATOR = 6;
const DEFAULT_MAX_TOTAL = 60;

/** entry（immediate / wait_for_trigger）から direction と trigger group を取り出す。 */
function entryParts(entry: StrategyDSL['entry']): {
  direction: 'long' | 'short';
  group: ConditionGroup;
} {
  if ('type' in entry && entry.type === 'wait_for_trigger') {
    return { direction: entry.direction, group: entry.triggerConditions };
  }
  return { direction: entry.direction, group: entry.trigger };
}

/** trigger group に condition を AND 追加（OR ルートは既存を sub-group 化して保全）。 */
function andAdd(group: ConditionGroup, cond: Condition): ConditionGroup {
  if (group.logic === 'AND') {
    return { logic: 'AND', conditions: [...group.conditions, cond] };
  }
  return { logic: 'AND', conditions: [group, cond] };
}

/** entry の trigger group を差し替えた entry を返す（型を保ったまま）。 */
function withTriggerGroup(entry: StrategyDSL['entry'], group: ConditionGroup): StrategyDSL['entry'] {
  if ('type' in entry && entry.type === 'wait_for_trigger') {
    return { ...entry, triggerConditions: group };
  }
  return { ...entry, trigger: group };
}

/** テンプレート × direction から「(condition, label)」候補を列挙。 */
function buildCandidateConditions(
  tpl: EdgeConditionTemplate,
  direction: 'long' | 'short',
): Array<{ cond: Condition; label: string }> {
  const out: Array<{ cond: Condition; label: string }> = [];
  const featureKey = tpl.featureKey ?? tpl.indicatorId;
  const fixedParams = tpl.fixedParams ? { ...tpl.fixedParams } : {};
  if (tpl.kind === 'oscillator_threshold') {
    const spec = direction === 'long' ? tpl.long : tpl.short;
    const periods = tpl.periodCandidates ?? [undefined];
    for (const period of periods) {
      for (const threshold of spec.thresholds) {
        const paramsValue = { ...fixedParams };
        if (tpl.periodParamKey && period !== undefined) {
          paramsValue[tpl.periodParamKey] = period;
        }
        const params = Object.keys(paramsValue).length > 0 ? { params: paramsValue } : {};
        out.push({
          cond: { lens: 'ohlcv', feature: featureKey, op: spec.op, value: threshold, ...params },
          label: `${featureKey}${period !== undefined ? `(${period})` : ''} ${spec.op} ${threshold}`,
        });
      }
    }
  } else {
    // price_vs_ma: long=close>MA / short=close<MA
    const op = direction === 'long' ? '>' : '<';
    for (const period of tpl.periodCandidates) {
      const params = { ...fixedParams, [tpl.periodParamKey]: period };
      out.push({
        cond: {
          lens: 'ohlcv',
          feature: 'close',
          op,
          compareTarget: {
            lens: 'ohlcv',
            feature: featureKey,
            params,
          },
        },
        label: `close ${op} ${featureKey}(${period})`,
      });
    }
  }
  return out;
}

/**
 * 親にインジを 1 つずつ AND 追加した variant 群を決定論生成する。
 *
 * 各インジは maxVariantsPerIndicator まで（閾値×period の先頭から決定論的に採用）、
 * 全体は maxTotalVariants まで。超過は truncated=true で surface。
 */
export function generateCrossoverIndicatorVariants(
  parent: StrategyDSL,
  options: CrossoverVariantOptions = {},
): CrossoverVariantsResult {
  const maxPer = Math.max(1, Math.floor(options.maxVariantsPerIndicator ?? DEFAULT_MAX_PER_INDICATOR));
  const maxTotal = Math.max(1, Math.floor(options.maxTotalVariants ?? DEFAULT_MAX_TOTAL));
  const { direction } = entryParts(parent.entry);

  const requested = options.indicatorIds ?? CROSSOVER_EDGE_TEMPLATES.map((t) => t.indicatorId);
  const skippedIndicators = requested.filter((id) => !TEMPLATED_INDICATOR_IDS.has(id));
  const usableTemplates = CROSSOVER_EDGE_TEMPLATES.filter((t) => requested.includes(t.indicatorId));

  const variants: CrossoverVariant[] = [];
  const indicatorsUsed: string[] = [];
  let totalCombos = 0;

  for (const tpl of usableTemplates) {
    const candidates = buildCandidateConditions(tpl, direction);
    totalCombos += candidates.length;
    const taken = candidates.slice(0, maxPer);
    if (taken.length > 0) indicatorsUsed.push(tpl.indicatorId);
    for (const { cond, label } of taken) {
      const variant = structuredClone(parent);
      // clone 側の trigger group を使って AND 追加する（親や他 variant との参照共有を防ぐ）。
      const clonedGroup = entryParts(variant.entry).group;
      variant.entry = withTriggerGroup(variant.entry, andAdd(clonedGroup, cond));
      variants.push({ variant, indicatorId: tpl.indicatorId, label });
    }
  }

  // 全体上限で決定論的に間引く（先頭優先 = インジ順 × 候補順）。
  const capped = variants.slice(0, maxTotal);

  return {
    variants: capped,
    indicatorsUsed,
    skippedIndicators,
    totalCombos,
    // per-indicator(maxPer) or 全体(maxTotal) のどちらかで 1 件でも落ちたら truncated。
    truncated: capped.length < totalCombos,
  };
}
