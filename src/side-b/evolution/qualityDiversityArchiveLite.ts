/**
 * Quality-Diversity Archive Lite v1 (Critical-4 PR #108)
 *
 * 目的: 進化ループの parent / promotion 候補を「行動特性 (BehaviorDescriptorLite)」で
 *   粗い cell に分類し、cell ごとに **品質 (quality score) 上位 1 件** を保持する archive を
 *   持たせる。スコア上位だけが残る単線進化を避け、性質の違う有望個体を世代をまたいで残す。
 *
 * 設計方針 (docs/design/pr_108_quality_diversity_archive_lite_agent_prompt.md):
 *   - **本格 MAP-Elites ではない。** Lite 版として in-memory archive のみ
 *   - DB migration / EdgeStatus 拡張 / production_candidate 自動昇格はしない
 *   - cell key は `BehaviorDescriptorLite` の現フィールドから deterministic に組む
 *   - quality score は **既存型に存在する値だけ** で計算 (= 新指標を作らない)
 *   - input は **mutation しない**。state は immutable に作り直す
 *   - Surrogate Rescue Lane / formalBtCandidateSummary は壊さない
 *   - OOS / Walk Forward / Backtest metrics を再計算しない (= analysis-engine 正本維持)
 *
 * 非責務:
 *   - mutation / formal BT / OOS 判定 / PromotionGate 判定の再実装
 *   - production 自動昇格
 *   - Quality-Diversity Archive の DB 永続化
 *   - LLM judgement
 *
 * @see docs/design/pr_108_quality_diversity_archive_lite_agent_prompt.md
 */

import type { StrategyDSL } from '../strategy_dsl/schema';
import {
  extractBehaviorDescriptorLite,
  type BehaviorDescriptorLite,
} from './behaviorDescriptorLite';
import type { EvolutionPromotionCandidate, GenerationReport } from './EvolutionLoop';

// =================================================================
// 型定義
// =================================================================

/** archive に投入するための候補。`EvolutionPromotionCandidate` を主キャリアとして使う。 */
export interface QualityDiversityArchiveCandidateV1 {
  candidate: EvolutionPromotionCandidate;
  dsl: StrategyDSL;
  /** 既知の novelty score (PR #97 由来)。なければ undefined。 */
  noveltyScore?: number;
  /** 既知の surrogate score (PR #95 / parent pool 由来)。なければ undefined。 */
  surrogateScore?: number;
}

/** archive の 1 cell 分の代表。 */
export interface QualityDiversityArchiveCellV1 {
  cellKey: string;
  descriptor: BehaviorDescriptorLite;
  dslId: string;
  qualityScore: number;
  formalBtPassed: boolean;
  /** archive に入った世代 (= update 呼び出し時の generationIndex)。 */
  insertedAtGeneration: number;
  /** 直近の置換が起きた世代。なければ insertedAtGeneration と同じ。 */
  lastUpdatedAtGeneration: number;
  /** debug / smoke 用の metrics スナップショット (= analysis-engine 由来をコピーするだけ、再計算しない)。 */
  metricsSnapshot: {
    pf?: number;
    tradeCount?: number;
    maxDrawdown?: number;
    winRate?: number;
  };
  /** archive の DSL を後段で利用するためにコピー保持 (= input mutation 防止)。 */
  dsl: StrategyDSL;
}

/** archive 全体の immutable state。 */
export interface QualityDiversityArchiveStateV1 {
  /** cell key → cell。Object 順序は insertion order だが、サマリ生成時はキー昇順で安定化する。 */
  cells: Record<string, QualityDiversityArchiveCellV1>;
  /** archive で許容する最大 cell 数。default 32。これを超える場合は qualityScore 下位から切る。 */
  maxCells: number;
  /** これまでに観測した候補 dslId の総数 (= 重複登録試行も含む観測軸)。 */
  totalObserved: number;
  /** これまでに insert された総数 (= 新規 cell 作成回数)。 */
  totalInserted: number;
  /** これまでに replace された総数 (= 既存 cell の置換回数)。 */
  totalReplaced: number;
  /** これまでに skip された総数 (= invalid / fatal / score 同点で勝てない)。 */
  totalSkipped: number;
  warnings: string[];
}

/** 1 世代分の update 結果 (= archive update の差分観測)。 */
export interface QualityDiversityArchiveUpdateSummaryV1 {
  generationIndex: number;
  observed: number;
  inserted: number;
  replaced: number;
  skipped: number;
  /** 当世代で insert / replace された cell key (debug / smoke 用、安定順序) */
  affectedCellKeys: string[];
  warnings: string[];
}

/** archive 全体の summary (= MultiGenerationRunReport / smoke で出す)。 */
export interface QualityDiversityArchiveSummaryV1 {
  enabled: boolean;
  cells: number;
  inserted: number;
  replaced: number;
  skipped: number;
  selectedParents: number;
  /** cells / maxCells (= archive の充足度合い、0〜1)。 */
  coverageRatio: number;
  /** 現 archive の cell key 一覧 (安定順序)。 */
  cellKeys: string[];
  warnings: string[];
}

// =================================================================
// 定数
// =================================================================

export const qualityDiversityArchiveDefaultsV1 = {
  /** default の最大 cell 数。指数関数的爆発を防ぐ保守的値。 */
  maxCells: 32,
  /** default の親注入数 (= multi-gen runner から各世代に渡す parent 数)。 */
  defaultParentLimit: 2,
  /** archive 投入の最低 trade 数。これ以下は不安定なので skip 扱い。 */
  minTradeCountForArchive: 10,
  /** quality score の最終加点 (formal BT passed なら +50)。 */
  formalBtPassedBonus: 50,
} as const;

// =================================================================
// helpers
// =================================================================

function safe(s: string | undefined | null): string {
  return s && s.length > 0 ? s : 'unknown';
}

/**
 * `BehaviorDescriptorLite` から deterministic な cell key を作る。
 *
 * - 順序固定: regime|timeframe|entry|exit|risk|sl|tp|freq|indicators
 * - undefined / 空文字は `'unknown'` 扱い
 * - indicatorKinds は **既に昇順ソート済み** (= behaviorDescriptorLite 側で安定化)
 * - dsl.id / qualityScore は含めない
 */
export function buildQdArchiveCellKeyV1(d: BehaviorDescriptorLite): string {
  const indicators =
    d.indicatorKinds && d.indicatorKinds.length > 0 ? d.indicatorKinds.join(',') : 'unknown';
  return [
    safe(d.regimeTarget),
    safe(d.timeframe),
    safe(d.entryKind),
    safe(d.exitKind),
    safe(d.riskKind),
    safe(d.stopLossKind),
    safe(d.takeProfitKind),
    safe(d.tradeFrequencyClass),
    indicators,
  ].join('|');
}

/**
 * archive 用の quality score。analysis-engine 由来の既存値だけで合成する (再計算しない)。
 *
 * 優先順位 (= 設計書 §4.3):
 *   1. formal BT passed → 大きく加点 (+50)
 *   2. profit factor (= 1.0 を基準にスケール)
 *   3. drawdown が低いほど加点
 *   4. trade count が最低基準以上で +5、未満で 0
 *   5. surrogate score / novelty score を補助加点
 *
 * 欠損値は 0 / neutral に寄せる。決定論的に計算する (= 同入力 → 同 score)。
 */
export function computeQdArchiveQualityScoreV1(
  c: QualityDiversityArchiveCandidateV1,
): number {
  const m = c.candidate.formalBtMetrics ?? null;
  let score = 0;
  if (c.candidate.formalBtPassed) {
    score += qualityDiversityArchiveDefaultsV1.formalBtPassedBonus;
  }
  if (m && Number.isFinite(m.pf)) {
    // pf=1.0 を基準とし、(pf - 1.0) * 20 を加点。pf=2.0 で +20pt。
    score += Math.max(0, m.pf - 1.0) * 20;
  }
  if (m && typeof m.maxDrawdown === 'number' && Number.isFinite(m.maxDrawdown)) {
    // analysis-engine `summary.maxDD` は **百分率 (%)** で返る (PR #102 確定)。
    // 0%〜100%pt の範囲で「DD が小さいほど加点」。10%pt 未満は +5pt。
    if (m.maxDrawdown < 10) score += 5;
    else if (m.maxDrawdown < 20) score += 2;
  }
  if (m && Number.isFinite(m.tradeCount)) {
    if (m.tradeCount >= qualityDiversityArchiveDefaultsV1.minTradeCountForArchive) score += 5;
  }
  if (typeof c.surrogateScore === 'number' && Number.isFinite(c.surrogateScore)) {
    score += c.surrogateScore * 2;
  }
  if (typeof c.noveltyScore === 'number' && Number.isFinite(c.noveltyScore)) {
    score += c.noveltyScore * 1;
  }
  return score;
}

/**
 * 同じ cell key で複数候補が来たときの deterministic tie-breaker。
 * 戻り値は「a が優先 = -1 / b が優先 = 1 / 同等 = 0」。
 */
function compareForCellOwnership(
  a: { qualityScore: number; formalBtPassed: boolean; tradeCount: number; dslId: string },
  b: { qualityScore: number; formalBtPassed: boolean; tradeCount: number; dslId: string },
): number {
  if (a.qualityScore !== b.qualityScore) return a.qualityScore > b.qualityScore ? -1 : 1;
  if (a.formalBtPassed !== b.formalBtPassed) return a.formalBtPassed ? -1 : 1;
  if (a.tradeCount !== b.tradeCount) return a.tradeCount > b.tradeCount ? -1 : 1;
  if (a.dslId !== b.dslId) return a.dslId < b.dslId ? -1 : 1;
  return 0;
}

/**
 * 候補が archive 投入に値するかの最低限フィルタ。
 *
 * - DSL 不在 / 無効 → skip
 * - fatal repairHint / repair_excluded → skip
 * - tradeCount が極端に少ない (< minTradeCountForArchive) → skip
 *
 * 「品質の低いものを多様性という名目で甘やかさない」 (設計書 §15)。
 */
function isArchiveEligible(c: QualityDiversityArchiveCandidateV1): { ok: boolean; reason?: string } {
  if (!c.dsl || !c.dsl.id || c.dsl.id.length === 0) return { ok: false, reason: 'dsl_missing' };
  if (c.candidate.repairHint?.shouldExcludeFromParentPool) {
    return { ok: false, reason: 'fatal_repair_excluded' };
  }
  const tc = c.candidate.formalBtMetrics?.tradeCount;
  if (
    typeof tc === 'number' &&
    tc < qualityDiversityArchiveDefaultsV1.minTradeCountForArchive
  ) {
    // formal BT を経由した上で tradeCount が極端に少ないものは archive に入れない
    return { ok: false, reason: 'insufficient_trade_count' };
  }
  return { ok: true };
}

// =================================================================
// state ライフサイクル
// =================================================================

export function createEmptyQualityDiversityArchiveV1(opts?: {
  maxCells?: number;
}): QualityDiversityArchiveStateV1 {
  return {
    cells: {},
    maxCells: opts?.maxCells ?? qualityDiversityArchiveDefaultsV1.maxCells,
    totalObserved: 0,
    totalInserted: 0,
    totalReplaced: 0,
    totalSkipped: 0,
    warnings: [],
  };
}

/**
 * archive を 1 世代分の候補で更新する。
 *
 * - input (state / candidates / report) は **絶対に mutation しない**。
 *   新しい state object を返す (= immutable update)。
 * - 同じ cell に複数候補が来た場合、`compareForCellOwnership` で deterministic に勝者を決める。
 * - maxCells を超えそうな場合、qualityScore 下位の cell から切って制限する (deterministic)。
 *
 * @returns 次世代に渡す state + 当世代の差分 summary
 */
export function updateQualityDiversityArchiveV1(
  state: QualityDiversityArchiveStateV1,
  input: {
    generationIndex: number;
    candidates: ReadonlyArray<QualityDiversityArchiveCandidateV1>;
  },
): { nextState: QualityDiversityArchiveStateV1; updateSummary: QualityDiversityArchiveUpdateSummaryV1 } {
  const nextCells: Record<string, QualityDiversityArchiveCellV1> = { ...state.cells };
  let observed = 0;
  let inserted = 0;
  let replaced = 0;
  let skipped = 0;
  const affectedKeys = new Set<string>();
  const warnings: string[] = [];

  for (const c of input.candidates) {
    observed += 1;
    const eligibility = isArchiveEligible(c);
    if (!eligibility.ok) {
      skipped += 1;
      continue;
    }
    const descriptor = extractBehaviorDescriptorLite(c.dsl, {
      validationTradeCount: c.candidate.formalBtMetrics?.tradeCount,
    });
    const cellKey = buildQdArchiveCellKeyV1(descriptor);
    const qualityScore = computeQdArchiveQualityScoreV1(c);
    const m = c.candidate.formalBtMetrics ?? null;
    const tradeCount = m?.tradeCount ?? 0;

    const existing = nextCells[cellKey];
    if (!existing) {
      nextCells[cellKey] = {
        cellKey,
        descriptor,
        dslId: c.dsl.id,
        qualityScore,
        formalBtPassed: c.candidate.formalBtPassed,
        insertedAtGeneration: input.generationIndex,
        lastUpdatedAtGeneration: input.generationIndex,
        metricsSnapshot: {
          pf: m?.pf,
          tradeCount: m?.tradeCount,
          maxDrawdown: m?.maxDrawdown,
          winRate: m?.winRate,
        },
        dsl: c.dsl,
      };
      inserted += 1;
      affectedKeys.add(cellKey);
      continue;
    }

    const cmp = compareForCellOwnership(
      {
        qualityScore,
        formalBtPassed: c.candidate.formalBtPassed,
        tradeCount,
        dslId: c.dsl.id,
      },
      {
        qualityScore: existing.qualityScore,
        formalBtPassed: existing.formalBtPassed,
        tradeCount: existing.metricsSnapshot.tradeCount ?? 0,
        dslId: existing.dslId,
      },
    );
    if (cmp < 0) {
      nextCells[cellKey] = {
        cellKey,
        descriptor,
        dslId: c.dsl.id,
        qualityScore,
        formalBtPassed: c.candidate.formalBtPassed,
        insertedAtGeneration: existing.insertedAtGeneration,
        lastUpdatedAtGeneration: input.generationIndex,
        metricsSnapshot: {
          pf: m?.pf,
          tradeCount: m?.tradeCount,
          maxDrawdown: m?.maxDrawdown,
          winRate: m?.winRate,
        },
        dsl: c.dsl,
      };
      replaced += 1;
      affectedKeys.add(cellKey);
    } else {
      // 既存が優位なので skip
      skipped += 1;
    }
  }

  // maxCells 制限: cell 数が超過した場合、qualityScore 昇順 + dslId 昇順で切る (deterministic)
  const cellEntries = Object.values(nextCells);
  let trimmedCells = nextCells;
  if (cellEntries.length > state.maxCells) {
    const overflow = cellEntries.length - state.maxCells;
    const sortedAsc = [...cellEntries].sort((a, b) => {
      if (a.qualityScore !== b.qualityScore) return a.qualityScore - b.qualityScore;
      return a.dslId < b.dslId ? -1 : a.dslId > b.dslId ? 1 : 0;
    });
    const toRemove = new Set(sortedAsc.slice(0, overflow).map((c) => c.cellKey));
    trimmedCells = Object.fromEntries(
      Object.entries(nextCells).filter(([k]) => !toRemove.has(k)),
    );
    warnings.push(
      `archive cell が maxCells=${state.maxCells} を超過、${overflow} 件を qualityScore 昇順で削除`,
    );
  }

  const nextState: QualityDiversityArchiveStateV1 = {
    cells: trimmedCells,
    maxCells: state.maxCells,
    totalObserved: state.totalObserved + observed,
    totalInserted: state.totalInserted + inserted,
    totalReplaced: state.totalReplaced + replaced,
    totalSkipped: state.totalSkipped + skipped,
    // PR #107 と同じ方針: state.warnings は決定単位の警告だけ (= 累積禁止) ではなく
    // archive の歴史を観測したい用途なので **過去ログを保持しつつ当世代分を追記**。
    // ただし update_summary 側で「当世代分の warnings」を別途返すので、累積で困ったら
    // そちらを参照すれば良い。
    warnings: [...state.warnings, ...warnings],
  };

  const updateSummary: QualityDiversityArchiveUpdateSummaryV1 = {
    generationIndex: input.generationIndex,
    observed,
    inserted,
    replaced,
    skipped,
    affectedCellKeys: [...affectedKeys].sort(),
    warnings,
  };

  return { nextState, updateSummary };
}

/**
 * archive 全体の summary を返す (= multi-gen report / smoke 出力用)。
 */
export function summarizeQualityDiversityArchiveV1(
  state: QualityDiversityArchiveStateV1,
  opts: { enabled: boolean; selectedParents: number },
): QualityDiversityArchiveSummaryV1 {
  const cellKeys = Object.keys(state.cells).sort();
  return {
    enabled: opts.enabled,
    cells: cellKeys.length,
    inserted: state.totalInserted,
    replaced: state.totalReplaced,
    skipped: state.totalSkipped,
    selectedParents: opts.selectedParents,
    coverageRatio: state.maxCells > 0 ? cellKeys.length / state.maxCells : 0,
    cellKeys,
    warnings: [...state.warnings],
  };
}

// =================================================================
// parent 選抜
// =================================================================

/**
 * archive から次世代へ注入する parent 候補 (StrategyDSL の配列) を選ぶ。
 *
 * - 同 cell からは 1 件まで (= cell 重複を避ける)
 * - 全 cell の中から qualityScore 降順 + dslId 昇順で安定 sort して上位 limit 件
 * - archive が空 / limit<=0 なら空配列
 * - input は mutation しない
 */
export function selectQualityDiversityArchiveParentsV1(
  state: QualityDiversityArchiveStateV1,
  opts?: { limit?: number },
): StrategyDSL[] {
  const limit = opts?.limit ?? qualityDiversityArchiveDefaultsV1.defaultParentLimit;
  if (limit <= 0) return [];
  const cells = Object.values(state.cells);
  if (cells.length === 0) return [];
  const sorted = [...cells].sort((a, b) => {
    if (a.qualityScore !== b.qualityScore) return b.qualityScore - a.qualityScore;
    if (a.formalBtPassed !== b.formalBtPassed) return a.formalBtPassed ? -1 : 1;
    return a.dslId < b.dslId ? -1 : a.dslId > b.dslId ? 1 : 0;
  });
  // cell 重複は元々 1 cell 1 候補のため、上位 limit 件を取れば cell 重複なし
  return sorted.slice(0, limit).map((c) => c.dsl);
}

// =================================================================
// GenerationReport ↔ archive candidate 変換
// =================================================================

/**
 * `GenerationReport.formalBtVerifiedCandidates` から archive candidate に変換する。
 *
 * - 各候補は対応する DSL を必要とする (= scheduler 側で dsl Map を作って渡す)
 * - DSL が見つからない候補は skip (= warning は呼び出し側で出してよい)
 */
export function buildArchiveCandidatesFromReportV1(
  report: GenerationReport,
  dslById: ReadonlyMap<string, StrategyDSL>,
  opts?: { surrogateScoreById?: ReadonlyMap<string, number> },
): QualityDiversityArchiveCandidateV1[] {
  const out: QualityDiversityArchiveCandidateV1[] = [];
  for (const c of report.formalBtVerifiedCandidates) {
    const dsl = dslById.get(c.dslId);
    if (!dsl) continue;
    const surrogateScore = opts?.surrogateScoreById?.get(c.dslId);
    out.push({ candidate: c, dsl, surrogateScore });
  }
  return out;
}
