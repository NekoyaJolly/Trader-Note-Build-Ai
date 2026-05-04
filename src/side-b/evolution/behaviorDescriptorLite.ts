/**
 * 進化ループ BehaviorDescriptorLite (Critical-4 PR #97)
 *
 * StrategyDSL から軽量な振る舞い記述子を抽出し、descriptor 同士の類似度と
 * novelty score を計算する。`surrogateRescuePolicy.ts` の `novelty_rescue` で
 * 「未選定候補のうち既存選抜と構造的に違うもの」を選ぶために使う。
 *
 * 設計方針:
 * - DB 保存なし、メモリ上の計算のみ (Archive 本体は別 PR)
 * - StrategyDSL の存在しないプロパティを仮定しない
 * - 完璧な novelty を目指さず regime / timeframe / entry / exit / indicator / risk
 *   の構造差分にとどめる (equity curve / trade pattern は対象外)
 * - 未知値は `'unknown'` で扱い、Zod 等で落とさない
 *
 * @see docs/design/pr_97_behavior_descriptor_lite_agent_prompt.md
 */

import type { StrategyDSL } from '../strategy_dsl/schema';
import { normalizeTimeframe } from '../constants/timeframes';

// =================================================================
// 型定義
// =================================================================

export interface BehaviorDescriptorLite {
  regimeTarget: string;
  timeframe: string;
  entryKind: string;
  exitKind: string;
  /** indicator family の集合 (重複除去済み・昇順ソート、安定順序) */
  indicatorKinds: string[];
  riskKind: string;
  stopLossKind: string;
  takeProfitKind: string;
  tradeFrequencyClass: 'low' | 'medium' | 'high' | 'unknown';
}

export interface DescriptorSimilarity {
  regimeSimilarity: number;
  timeframeSimilarity: number;
  entrySimilarity: number;
  exitSimilarity: number;
  indicatorSimilarity: number;
  riskSimilarity: number;
  /** PR #97 Copilot fix: SL の type 比較 (= riskKind とは独立した粒度) */
  stopLossSimilarity: number;
  /** PR #97 Copilot fix: TP の type 比較 */
  takeProfitSimilarity: number;
  /** PR #97 Copilot fix: 取引頻度クラス比較 (low/medium/high/unknown) */
  tradeFrequencySimilarity: number;
  /** 重み付き平均 (0〜1) */
  totalSimilarity: number;
}

export interface NoveltyScore {
  candidateId: string;
  /** 既選抜候補の中で最も似ているもの (1=完全一致 / 0=全く違う) */
  nearestSimilarity: number;
  /** 1 - nearestSimilarity (1=最も新規 / 0=既存と完全一致) */
  noveltyScore: number;
  descriptor: BehaviorDescriptorLite;
  /** 最も似ていた既存候補 ID (selected が空なら null) */
  nearestCandidateId: string | null;
  /** 選定理由を人間可読でまとめた文字列 (smoke ログ用) */
  reason: string;
}

// =================================================================
// descriptor 抽出
// =================================================================

/**
 * lens / feature 名を見て indicator family を推定する。
 * v1 は単純な部分文字列マッチ (=堅牢な分類はインジケーターレジストリ整備後)。
 */
function classifyIndicatorFamily(lens: string, feature: string): string {
  const k = `${lens.toLowerCase()}.${feature.toLowerCase()}`;
  if (k.includes('ema')) return 'ema';
  if (k.includes('sma')) return 'sma';
  if (k.includes('rsi')) return 'rsi';
  if (k.includes('stoch')) return 'oscillator';
  if (k.includes('atr')) return 'atr';
  if (k.includes('boll') || k.includes('bbands') || k.includes('bb_')) return 'bollinger';
  if (k.includes('macd')) return 'macd';
  if (k.includes('volume') || k.includes('vol_')) return 'volume';
  if (lens.toLowerCase() === 'ohlcv') return 'price';
  return 'unknown';
}

/**
 * entry の condition 木をフラットに走査し、(lens, feature) ペアを集める。
 * v1 では ImmediateEntry の `trigger` / WaitForTrigger の `triggerConditions` を扱う。
 */
function collectEntryConditions(entry: StrategyDSL['entry']): Array<{ lens: string; feature: string }> {
  const root = 'type' in entry && entry.type === 'wait_for_trigger' ? entry.triggerConditions : entry.trigger;
  const out: Array<{ lens: string; feature: string }> = [];
  function walk(group: typeof root): void {
    for (const c of group.conditions) {
      if ('logic' in c) {
        walk(c);
      } else {
        out.push({ lens: c.lens, feature: c.feature });
      }
    }
  }
  walk(root);
  return out;
}

/**
 * entry 構造から entryKind を推定する (breakout / ma / oscillator / volatility /
 * price_action / unknown)。複数該当した場合は優先順位の高いものを採用。
 */
function classifyEntryKind(entry: StrategyDSL['entry']): string {
  const conds = collectEntryConditions(entry);
  if (conds.length === 0) return 'unknown';
  const families = conds.map((c) => ({ family: classifyIndicatorFamily(c.lens, c.feature), feature: c.feature.toLowerCase() }));
  // 優先順位: breakout / volatility / oscillator / ma / price_action
  if (families.some((f) => f.feature.includes('breakout') || f.feature.includes('high_n') || f.feature.includes('low_n'))) {
    return 'breakout';
  }
  if (families.some((f) => f.family === 'bollinger' || f.family === 'atr')) return 'volatility';
  if (families.some((f) => f.family === 'rsi' || f.family === 'oscillator' || f.family === 'macd')) {
    return 'oscillator';
  }
  if (families.some((f) => f.family === 'ema' || f.family === 'sma')) return 'ma';
  if (families.every((f) => f.family === 'price')) return 'price_action';
  return 'unknown';
}

/**
 * exit 構造から exitKind を推定する。
 * StrategyDSL の `stopLoss.type` と `takeProfit.type` が `'rr_ratio'` 系なら fixed_rr、
 * `'atr_multiple'` 系で trailing 想定 (= ATR × multiplier の動的 stop)、
 * `swing_point` は反対シグナル相当として opposite_signal にマップする。
 *
 * v1 で `time_exit` / 厳密な trailing 検出は schema に該当フィールドがないため省略
 * (= "unknown" にも倒れない範囲で classify)。
 */
function classifyExitKind(dsl: StrategyDSL): string {
  const slType = dsl.stopLoss.type;
  const tpType = dsl.takeProfit.type;
  if (tpType === 'rr_ratio') return 'fixed_rr';
  if (slType === 'atr_multiple' || tpType === 'atr_multiple') return 'trailing';
  if (slType === 'swing_point') return 'opposite_signal';
  if (slType === 'fixed_pips' && tpType === 'fixed_pips') return 'fixed_rr';
  return 'unknown';
}

/**
 * SL/TP 構造から riskKind を分類する。両方ありなら sl_tp、片方欠如なら sl_only / tp_only。
 * StrategyDSL は両方必須のため通常は sl_tp になるが、将来の optional 化に備えて防御。
 */
function classifyRiskKind(dsl: StrategyDSL): string {
  const hasSl = !!dsl.stopLoss;
  const hasTp = !!dsl.takeProfit;
  if (hasSl && hasTp) {
    if (dsl.stopLoss.type === 'atr_multiple' || dsl.takeProfit.type === 'atr_multiple') {
      return 'trailing';
    }
    return 'sl_tp';
  }
  if (hasSl) return 'sl_only';
  if (hasTp) return 'tp_only';
  return 'unknown';
}

/** stopLoss.type をそのまま採用 (型は既知の literal なので unknown に倒れない) */
function classifyStopLossKind(dsl: StrategyDSL): string {
  return dsl.stopLoss?.type ?? 'unknown';
}

/** takeProfit.type をそのまま採用 */
function classifyTakeProfitKind(dsl: StrategyDSL): string {
  return dsl.takeProfit?.type ?? 'unknown';
}

/**
 * validation トレード数から取引頻度クラスを推定する。
 *   undefined / 0  → unknown
 *   1〜19           → low
 *   20〜99          → medium
 *   100以上         → high
 */
function classifyTradeFrequencyClass(
  validationTradeCount: number | undefined,
): BehaviorDescriptorLite['tradeFrequencyClass'] {
  if (validationTradeCount === undefined || validationTradeCount <= 0) return 'unknown';
  if (validationTradeCount < 20) return 'low';
  if (validationTradeCount < 100) return 'medium';
  return 'high';
}

/**
 * StrategyDSL から `BehaviorDescriptorLite` を抽出する。
 *
 * 例外を投げない。schema validation 済みの DSL を前提とするが、未知のフィールド
 * 構成 (LLM 生成の変則 DSL 等) でも `'unknown'` で吸収する。
 */
export function extractBehaviorDescriptorLite(
  dsl: StrategyDSL,
  options?: { validationTradeCount?: number },
): BehaviorDescriptorLite {
  const indicatorSet = new Set<string>();
  for (const c of collectEntryConditions(dsl.entry)) {
    indicatorSet.add(classifyIndicatorFamily(c.lens, c.feature));
  }
  // SL/TP に ATR が出てきたら ATR を indicator にカウント (entry にだけ出る前提でない)
  if (dsl.stopLoss.type === 'atr_multiple' || dsl.takeProfit.type === 'atr_multiple') {
    indicatorSet.add('atr');
  }
  // 安定順序のため昇順ソート
  const indicatorKinds = [...indicatorSet].sort();

  // PR #97 Copilot fix: timeframe は Side-B の他経路 (hashStrategyDsl / BT / 永続化) と
  //   同じく normalizeTimeframe を通す。'1H' → '1h' / 'multi' → '1h' (= 既定) など、
  //   同一戦略が表記ゆれで別扱いされて novelty 計算がブレる問題を防ぐ。
  const tfRaw = dsl.timeframe?.length > 0 ? dsl.timeframe : '';
  const timeframe = tfRaw.length > 0 ? normalizeTimeframe(tfRaw) : 'unknown';

  return {
    regimeTarget: dsl.regimeTarget?.length > 0 ? dsl.regimeTarget : 'unknown',
    timeframe,
    entryKind: classifyEntryKind(dsl.entry),
    exitKind: classifyExitKind(dsl),
    indicatorKinds,
    riskKind: classifyRiskKind(dsl),
    stopLossKind: classifyStopLossKind(dsl),
    takeProfitKind: classifyTakeProfitKind(dsl),
    tradeFrequencyClass: classifyTradeFrequencyClass(options?.validationTradeCount),
  };
}

// =================================================================
// 類似度計算
// =================================================================

/** 完全一致=1 / どちらかが unknown=0.5 / 不一致=0 */
function categoricalSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a === 'unknown' || b === 'unknown') return 0.5;
  return 0;
}

/**
 * Jaccard similarity (intersection / union)。両方空集合なら 0.5 (= 「どちらも持たない」
 * は完全一致でも完全相違でもないため中立)。
 */
function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 0.5;
  let intersection = 0;
  for (const x of setA) if (setB.has(x)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0.5 : intersection / union;
}

/**
 * 各軸の重み。entry / indicator が最重要 (戦略の本体)、その次に regime / exit、
 * timeframe / risk / SL / TP / tradeFrequency は補助的差分。
 *
 * stopLoss / takeProfit / tradeFrequency は riskKind ほど抽象化されておらず、
 * 例えば `fixed_pips+rr_ratio` と `fixed_pips+fixed_pips` は riskKind が同じ
 * (sl_tp) でも具体型が違うため、独立軸として比較する。
 */
const SIMILARITY_WEIGHTS = {
  regime: 1.0,
  timeframe: 0.8,
  entry: 1.2,
  exit: 1.0,
  indicator: 1.2,
  risk: 0.8,
  stopLoss: 0.6,
  takeProfit: 0.6,
  tradeFrequency: 0.5,
} as const;

const SIMILARITY_WEIGHT_TOTAL = Object.values(SIMILARITY_WEIGHTS).reduce((a, b) => a + b, 0);

/**
 * 2 つの descriptor の類似度を計算する。各軸 0〜1、totalSimilarity は重み付き平均。
 *
 * PR #97 Copilot fix: 旧版は `stopLossKind` / `takeProfitKind` / `tradeFrequencyClass`
 *   を抽出していたのに比較に使っておらず、SL/TP の具体型違いや取引頻度差を novelty
 *   選抜が見逃していた。9 軸全てを similarity に組み込む。
 */
export function compareBehaviorDescriptorsLite(
  a: BehaviorDescriptorLite,
  b: BehaviorDescriptorLite,
): DescriptorSimilarity {
  const regimeSim = categoricalSimilarity(a.regimeTarget, b.regimeTarget);
  const timeframeSim = categoricalSimilarity(a.timeframe, b.timeframe);
  const entrySim = categoricalSimilarity(a.entryKind, b.entryKind);
  const exitSim = categoricalSimilarity(a.exitKind, b.exitKind);
  const indicatorSim = jaccardSimilarity(a.indicatorKinds, b.indicatorKinds);
  const riskSim = categoricalSimilarity(a.riskKind, b.riskKind);
  const stopLossSim = categoricalSimilarity(a.stopLossKind, b.stopLossKind);
  const takeProfitSim = categoricalSimilarity(a.takeProfitKind, b.takeProfitKind);
  const tradeFreqSim = categoricalSimilarity(a.tradeFrequencyClass, b.tradeFrequencyClass);

  const weightedSum =
    regimeSim * SIMILARITY_WEIGHTS.regime +
    timeframeSim * SIMILARITY_WEIGHTS.timeframe +
    entrySim * SIMILARITY_WEIGHTS.entry +
    exitSim * SIMILARITY_WEIGHTS.exit +
    indicatorSim * SIMILARITY_WEIGHTS.indicator +
    riskSim * SIMILARITY_WEIGHTS.risk +
    stopLossSim * SIMILARITY_WEIGHTS.stopLoss +
    takeProfitSim * SIMILARITY_WEIGHTS.takeProfit +
    tradeFreqSim * SIMILARITY_WEIGHTS.tradeFrequency;

  const total = Math.max(0, Math.min(1, weightedSum / SIMILARITY_WEIGHT_TOTAL));

  return {
    regimeSimilarity: regimeSim,
    timeframeSimilarity: timeframeSim,
    entrySimilarity: entrySim,
    exitSimilarity: exitSim,
    indicatorSimilarity: indicatorSim,
    riskSimilarity: riskSim,
    stopLossSimilarity: stopLossSim,
    takeProfitSimilarity: takeProfitSim,
    tradeFrequencySimilarity: tradeFreqSim,
    totalSimilarity: total,
  };
}

// =================================================================
// novelty score
// =================================================================

/**
 * 主な差分軸を 1 行で人間可読にまとめる (smoke ログ用)。
 * 0.5 (= unknown) は「曖昧」として diff に含めない。
 */
function summarizeDiffAxes(sim: DescriptorSimilarity): string {
  const diffs: string[] = [];
  if (sim.regimeSimilarity === 0) diffs.push('regime');
  if (sim.timeframeSimilarity === 0) diffs.push('timeframe');
  if (sim.entrySimilarity === 0) diffs.push('entryKind');
  if (sim.exitSimilarity === 0) diffs.push('exitKind');
  if (sim.indicatorSimilarity < 0.5) diffs.push('indicatorKinds');
  if (sim.riskSimilarity === 0) diffs.push('riskKind');
  if (sim.stopLossSimilarity === 0) diffs.push('stopLossKind');
  if (sim.takeProfitSimilarity === 0) diffs.push('takeProfitKind');
  if (sim.tradeFrequencySimilarity === 0) diffs.push('tradeFrequencyClass');
  return diffs.length > 0 ? diffs.join(',') : 'minor';
}

/**
 * 候補 1 件に対して、selected 群の中で「最も似ている候補」を見つけ、
 * `noveltyScore = 1 - nearestSimilarity` を返す。
 *
 * - selected が空なら noveltyScore=1, nearestCandidateId=null
 * - 同点 nearestSimilarity が複数あれば最初に見つかったもの (= 入力順)
 *
 * options.candidateValidationTradeCount は candidate 側の tradeFrequencyClass、
 * options.selectedValidationTradeCounts は selected 各個体の tradeFrequencyClass を埋める。
 * 省略時はそれぞれ `'unknown'` 扱い (= descriptor 比較の影響なし)。
 */
export function scoreNoveltyAgainstSelected(
  candidate: StrategyDSL,
  selected: StrategyDSL[],
  options?: {
    candidateValidationTradeCount?: number;
    selectedValidationTradeCounts?: Map<string, number>;
  },
): NoveltyScore {
  const candidateDescriptor = extractBehaviorDescriptorLite(candidate, {
    validationTradeCount: options?.candidateValidationTradeCount,
  });

  if (selected.length === 0) {
    return {
      candidateId: candidate.id,
      nearestSimilarity: 0,
      noveltyScore: 1,
      descriptor: candidateDescriptor,
      nearestCandidateId: null,
      reason: 'no selected candidates → maximum novelty (1.00)',
    };
  }

  let nearestSim = -1;
  let nearestId: string | null = null;
  let nearestDetail: DescriptorSimilarity | null = null;
  for (const s of selected) {
    const sDescriptor = extractBehaviorDescriptorLite(s, {
      validationTradeCount: options?.selectedValidationTradeCounts?.get(s.id),
    });
    const sim = compareBehaviorDescriptorsLite(candidateDescriptor, sDescriptor);
    if (sim.totalSimilarity > nearestSim) {
      nearestSim = sim.totalSimilarity;
      nearestId = s.id;
      nearestDetail = sim;
    }
  }

  // selected が非空なので nearestSim は必ず 0 以上に更新される
  const noveltyScore = 1 - nearestSim;
  const diffSummary = nearestDetail ? summarizeDiffAxes(nearestDetail) : 'minor';
  const reason =
    `noveltyScore=${noveltyScore.toFixed(2)}, nearestSimilarity=${nearestSim.toFixed(2)}, ` +
    `nearestCandidateId=${nearestId}, diff=${diffSummary}`;

  return {
    candidateId: candidate.id,
    nearestSimilarity: nearestSim,
    noveltyScore,
    descriptor: candidateDescriptor,
    nearestCandidateId: nearestId,
    reason,
  };
}
