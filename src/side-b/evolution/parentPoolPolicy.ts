/**
 * 進化ループ親個体プール v1 (Critical-4 PR #95)
 *
 * 設計:
 * - mutation / crossover の親選抜を `population.getElites()` の単一ソースから、
 *   3 系統 (formal_bt_passed / current_population / novelty_seed) のミックスへ拡張する。
 * - EdgeStatus enum / DB migration / EdgeHypothesis 経路は **触らない** (v1 スコープ外)
 * - formalBtPassed が 0 件でも、currentPopulation → noveltySeed への fallback で必ず
 *   非空の親プールを返す
 * - 観測のため `parentPoolSummary` を GenerationReport に出す
 *
 * @see docs/design/evolution_loop_agent_prompt.md (PR #95 親個体プール v1 最小版)
 */

import { randomUUID } from 'crypto';

import { StrategyDSLSchema, type StrategyDSL } from '../strategy_dsl/schema';
import type { StrategyPopulation } from './StrategyPopulation';
import type { EvolutionBacktestRunRepository } from '../../backend/repositories/evolutionBacktestRunRepository';

// =================================================================
// Policy 設定
// =================================================================

/**
 * 親候補ソース別の希望比率。合計 1.0 になるよう調整する。
 * 値は将来 config 化する想定だが、v1 はモジュール export として定数で扱う。
 */
export const parentPoolPolicy = {
  formalBtPassed: 0.4,
  currentPopulation: 0.4,
  noveltySeed: 0.2,
} as const;

export type ParentPoolSource = 'formal_bt_passed' | 'current_population' | 'novelty_seed';

export interface ParentPoolEntry {
  dsl: StrategyDSL;
  source: ParentPoolSource;
  /** ソースが current_population の時に使う surrogate スコア (それ以外は undefined) */
  surrogateScore?: number;
}

export interface ParentPoolSummary {
  requested: Record<ParentPoolSource, number>;
  selected: Record<ParentPoolSource, number>;
  fallbackApplied: boolean;
  fallbackReason: string | null;
  totalSelected: number;
}

export interface BuildParentPoolDeps {
  population: StrategyPopulation;
  /** v1: null の場合は formal_bt_passed ソースを skip (テスト用 / DB 未接続) */
  evolutionBacktestRepo: Pick<EvolutionBacktestRunRepository, 'findRecentFormalBtPassed'> | null;
}

// =================================================================
// Source loaders
// =================================================================

/**
 * EvolutionBacktestRun から formalBtPassed=true の DSL スナップショットを取得し、
 * StrategyDSLSchema で再 parse して有効な DSL のみ返す。
 * - parse 失敗は warning + skip (rejected / invalid DSL は親候補から除外する要件)
 * - regime フィルタなし (v1: 異 regime の合格戦略も親候補に入れる、多様性優先)
 */
async function loadFormalBtPassedParents(
  repo: Pick<EvolutionBacktestRunRepository, 'findRecentFormalBtPassed'>,
  limit: number,
): Promise<StrategyDSL[]> {
  const rows = await repo.findRecentFormalBtPassed(Math.max(limit * 2, 10));
  const out: StrategyDSL[] = [];
  for (const row of rows) {
    if (out.length >= limit) break;
    const result = StrategyDSLSchema.safeParse(row.dslSnapshot);
    if (result.success) {
      out.push(result.data);
    } else {
      // schema validation error は握りつぶさず観測ログに残す (要件)
      console.warn(
        `[parentPool] formalBtPassed dsl の Zod parse 失敗: candidateId=${row.candidateId} ` +
          `reason=${result.error.issues.slice(0, 2).map((i) => `${i.path.join('.')}:${i.message}`).join('|')}`,
      );
    }
  }
  return out;
}

/**
 * 現 population から regime に該当する個体のうち、surrogate スコア降順で取得。
 * scores が無い個体は -Infinity 扱いで末尾に押す (= 候補から落ちやすくなる)。
 */
function loadCurrentPopulationParents(
  population: StrategyPopulation,
  regime: string,
  scores: Map<string, number>,
  limit: number,
): Array<{ dsl: StrategyDSL; surrogateScore: number }> {
  const list = population.getByRegime(regime);
  const ranked = list
    .map((dsl) => ({ dsl, surrogateScore: scores.get(dsl.id) ?? Number.NEGATIVE_INFINITY }))
    .sort((a, b) => b.surrogateScore - a.surrogateScore);
  return ranked.slice(0, limit);
}

/**
 * v1: novelty seed = ランダムなシード戦略 (LLM 不使用、コスト 0)。
 * 将来的には mutationAgent.generateDiverse() に差し替え検討。
 *
 * 既存 EvolutionLoop.seedStrategy と同等の最小戦略を生成。重複しないよう
 * 毎回 randomUUID() で id を切る。
 */
function generateNoveltySeeds(regime: string, count: number): StrategyDSL[] {
  const out: StrategyDSL[] = [];
  for (let i = 0; i < count; i++) {
    const raw = {
      id: `novelty-${regime}-${randomUUID()}`,
      generation: 0,
      parentIds: [] as string[],
      regimeTarget: regime,
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long' as const,
        trigger: {
          logic: 'AND' as const,
          conditions: [{ lens: 'ohlcv', feature: 'close', op: '>' as const, value: 0 }],
        },
        orderType: 'market' as const,
      },
      stopLoss: { type: 'atr_multiple' as const, value: 1.5 },
      takeProfit: { type: 'rr_ratio' as const, value: 2 },
      parameters: {},
      metadata: {
        createdAt: new Date().toISOString(),
        createdBy: 'initial_random' as const,
        description: `novelty seed for ${regime}`,
      },
    };
    out.push(StrategyDSLSchema.parse(raw));
  }
  return out;
}

// =================================================================
// 配分計算
// =================================================================

/**
 * targetSize に対し各ソースの希望件数を整数配分する。
 * 端数は formalBtPassed → currentPopulation → noveltySeed の順で 1 ずつ追加。
 */
export function computeRequestedCounts(targetSize: number): Record<ParentPoolSource, number> {
  const size = Math.max(0, Math.floor(targetSize));
  if (size === 0) {
    return { formal_bt_passed: 0, current_population: 0, novelty_seed: 0 };
  }
  const raw = {
    formal_bt_passed: size * parentPoolPolicy.formalBtPassed,
    current_population: size * parentPoolPolicy.currentPopulation,
    novelty_seed: size * parentPoolPolicy.noveltySeed,
  };
  const counts: Record<ParentPoolSource, number> = {
    formal_bt_passed: Math.floor(raw.formal_bt_passed),
    current_population: Math.floor(raw.current_population),
    novelty_seed: Math.floor(raw.novelty_seed),
  };
  let used = counts.formal_bt_passed + counts.current_population + counts.novelty_seed;
  // 端数を優先順位で吸収 (合計が targetSize に達するまで)
  const order: ParentPoolSource[] = ['formal_bt_passed', 'current_population', 'novelty_seed'];
  for (const key of order) {
    if (used >= size) break;
    counts[key] += 1;
    used += 1;
  }
  return counts;
}

// =================================================================
// 公開 API
// =================================================================

/**
 * 親プールを構築する。
 *
 * 流れ:
 *   1. 希望比率で各ソースから候補をロード
 *   2. formalBtPassed が要求件数に満たない場合、不足分を currentPopulation に追加要求
 *   3. それでも不足する場合は noveltySeed を追加生成
 *   4. 全てのソースが空 (= regime に population がなく、formalBt 履歴も無い) の場合は
 *      noveltySeed のみで targetSize を埋める
 *
 * 既存挙動との互換性のため、空 pool は返さない (targetSize > 0 ならば必ず noveltySeed
 * から生成して targetSize を満たす)。
 */
export async function buildParentPool(
  regime: string,
  targetSize: number,
  scores: Map<string, number>,
  deps: BuildParentPoolDeps,
): Promise<{ entries: ParentPoolEntry[]; summary: ParentPoolSummary }> {
  const requested = computeRequestedCounts(targetSize);
  const entries: ParentPoolEntry[] = [];
  const fallbackReasons: string[] = [];

  // 1. formal_bt_passed
  let formalBtLoaded: StrategyDSL[] = [];
  if (deps.evolutionBacktestRepo && requested.formal_bt_passed > 0) {
    formalBtLoaded = await loadFormalBtPassedParents(
      deps.evolutionBacktestRepo,
      requested.formal_bt_passed,
    );
  }
  for (const dsl of formalBtLoaded.slice(0, requested.formal_bt_passed)) {
    entries.push({ dsl, source: 'formal_bt_passed' });
  }
  const formalBtShortage = requested.formal_bt_passed - formalBtLoaded.length;
  if (formalBtShortage > 0) {
    fallbackReasons.push(
      `formal_bt_passed shortage=${formalBtShortage} (` +
        `${deps.evolutionBacktestRepo ? 'DB に合格履歴不足' : 'repo=null'})`,
    );
  }

  // 2. current_population (formal_bt 不足分も吸収)
  const currentPopulationRequest = requested.current_population + Math.max(0, formalBtShortage);
  const populationLoaded = loadCurrentPopulationParents(
    deps.population,
    regime,
    scores,
    currentPopulationRequest,
  );
  for (const e of populationLoaded) {
    entries.push({ dsl: e.dsl, source: 'current_population', surrogateScore: e.surrogateScore });
  }
  const populationShortage = currentPopulationRequest - populationLoaded.length;
  if (populationShortage > 0) {
    fallbackReasons.push(
      `current_population shortage=${populationShortage} (regime=${regime} の population が小さい)`,
    );
  }

  // 3. novelty_seed (population 不足分も吸収)
  const noveltyRequest = requested.novelty_seed + Math.max(0, populationShortage);
  const noveltySeeds = generateNoveltySeeds(regime, noveltyRequest);
  for (const dsl of noveltySeeds) {
    entries.push({ dsl, source: 'novelty_seed' });
  }

  // 集計
  const selected: Record<ParentPoolSource, number> = {
    formal_bt_passed: entries.filter((e) => e.source === 'formal_bt_passed').length,
    current_population: entries.filter((e) => e.source === 'current_population').length,
    novelty_seed: entries.filter((e) => e.source === 'novelty_seed').length,
  };
  const totalSelected = entries.length;
  const fallbackApplied = fallbackReasons.length > 0;

  const summary: ParentPoolSummary = {
    requested,
    selected,
    fallbackApplied,
    fallbackReason: fallbackApplied ? fallbackReasons.join(' | ') : null,
    totalSelected,
  };

  return { entries, summary };
}
