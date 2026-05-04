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
import type { EdgeHypothesis, EdgeStatus } from '../models/edgeHypothesis';
import { dslFromHypothesis, stableDslIdFromHypothesis } from './dslFromHypothesis';

// =================================================================
// Policy 設定
// =================================================================

/**
 * 親候補ソース別の希望比率 (PR #95 v1)。
 * PR #98 以降、edgeHypothesis 系ソースが利用可能な場合は parentPoolPolicyV2 を使う。
 */
export const parentPoolPolicy = {
  formalBtPassed: 0.4,
  currentPopulation: 0.4,
  noveltySeed: 0.2,
} as const;

/**
 * PR #98 親プール統合後の配分。EdgeHypothesis 資産を再利用する 6 系統。
 * v2 が選ばれるかは buildParentPool の deps.edgeHypothesisLoader の有無で自動判定する。
 */
export const parentPoolPolicyV2 = {
  edge_confirmed: 0.25,
  edge_screening_passed: 0.35,
  formal_bt_passed: 0.2,
  current_population: 0.1,
  edge_unverified: 0.05,
  novelty_seed: 0.05,
} as const;

export type ParentPoolSource =
  | 'formal_bt_passed'
  | 'current_population'
  | 'novelty_seed'
  | 'edge_confirmed'
  | 'edge_screening_passed'
  | 'edge_unverified';

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
  /** PR #98: edge_* ソースの変換失敗 / skip 件数 (= warnings 観測用、無ければ undefined) */
  edgeHypothesisConversion?: {
    /** ロードできた仮説総数 (= status 別合計) */
    loaded: number;
    /** Zod 等の変換失敗で skip された件数 */
    skipped: number;
    /** 重複排除で落とされた件数 (同 hypothesis が複数 status から来たケース) */
    duplicateRemoved: number;
    /** 変換失敗 / 警告ログ (debug 用、最大 10 件) */
    warnings: string[];
  };
}

/**
 * PR #98 親プール統合用に追加された EdgeHypothesis ロード経路。
 * 既存 `EdgeLedger.findByStatus` をそのまま使えるよう、最小契約を Pick で切る。
 */
export interface EdgeHypothesisLoader {
  findByStatus(status: EdgeStatus): Promise<EdgeHypothesis[]>;
}

export interface BuildParentPoolDeps {
  population: StrategyPopulation;
  /** v1: null の場合は formal_bt_passed ソースを skip (テスト用 / DB 未接続) */
  evolutionBacktestRepo: Pick<EvolutionBacktestRunRepository, 'findRecentFormalBtPassed'> | null;
  /**
   * PR #98: EdgeHypothesis 系ソース (edge_confirmed / edge_screening_passed /
   * edge_unverified) のロード口。null / undefined なら v1 配分にフォールバック。
   */
  edgeHypothesisLoader?: EdgeHypothesisLoader | null;
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
 *
 * `hasEdgeLoader=false` (v1 互換): formal_bt_passed / current_population /
 *   novelty_seed の 3 系統のみ (edge_* は全て 0)
 * `hasEdgeLoader=true` (v2): edge_confirmed / edge_screening_passed / formal_bt_passed /
 *   current_population / edge_unverified / novelty_seed の 6 系統
 *
 * 端数は配分順 (高比率から) で 1 ずつ加算して合計を targetSize に揃える。
 */
export function computeRequestedCounts(
  targetSize: number,
  hasEdgeLoader: boolean = false,
): Record<ParentPoolSource, number> {
  const size = Math.max(0, Math.floor(targetSize));
  const empty: Record<ParentPoolSource, number> = {
    edge_confirmed: 0,
    edge_screening_passed: 0,
    formal_bt_passed: 0,
    current_population: 0,
    edge_unverified: 0,
    novelty_seed: 0,
  };
  if (size === 0) return empty;

  const policy = hasEdgeLoader
    ? parentPoolPolicyV2
    : {
        edge_confirmed: 0,
        edge_screening_passed: 0,
        formal_bt_passed: parentPoolPolicy.formalBtPassed,
        current_population: parentPoolPolicy.currentPopulation,
        edge_unverified: 0,
        novelty_seed: parentPoolPolicy.noveltySeed,
      };

  const counts: Record<ParentPoolSource, number> = {
    edge_confirmed: Math.floor(size * policy.edge_confirmed),
    edge_screening_passed: Math.floor(size * policy.edge_screening_passed),
    formal_bt_passed: Math.floor(size * policy.formal_bt_passed),
    current_population: Math.floor(size * policy.current_population),
    edge_unverified: Math.floor(size * policy.edge_unverified),
    novelty_seed: Math.floor(size * policy.novelty_seed),
  };
  let used = Object.values(counts).reduce((a, b) => a + b, 0);
  // 端数を高比率順で吸収 (合計が targetSize に達するまで)
  const order: ParentPoolSource[] = hasEdgeLoader
    ? [
        'edge_screening_passed',
        'edge_confirmed',
        'formal_bt_passed',
        'current_population',
        'edge_unverified',
        'novelty_seed',
      ]
    : ['formal_bt_passed', 'current_population', 'novelty_seed'];
  for (const key of order) {
    if (used >= size) break;
    counts[key] += 1;
    used += 1;
  }
  return counts;
}

/**
 * PR #98: EdgeLedger.findByStatus を呼んで dslFromHypothesis で変換、StrategyDSL に成功した
 * 候補だけを返す。skip / warning カウントを集計して返却する。
 *
 * `rejected` / `not_testable` / `stale` / `insufficient_data` / `testing` は
 * 親候補に入れない (= 設計書「親候補に rejected を入れない」要件)。
 */
async function loadEdgeHypothesisParents(
  loader: EdgeHypothesisLoader,
  status: EdgeStatus,
  limit: number,
): Promise<{ dsls: StrategyDSL[]; loaded: number; skipped: number; warnings: string[] }> {
  const rows = await loader.findByStatus(status);
  const loaded = rows.length;
  const dsls: StrategyDSL[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  for (const h of rows) {
    if (dsls.length >= limit) break;
    const result = dslFromHypothesis(h);
    if (result.ok && result.strategyDsl) {
      dsls.push(result.strategyDsl);
      // warnings (= regimeTarget=unknown 等の軽微な notice) も観測したいので最大 5 件残す
      if (result.warnings.length > 0 && warnings.length < 5) {
        warnings.push(`hyp=${h.id}(${status}): ${result.warnings.slice(0, 2).join(', ')}`);
      }
    } else {
      skipped++;
      if (warnings.length < 10) {
        warnings.push(
          `hyp=${h.id}(${status}) skipped: reason=${result.failureReason ?? 'unknown'}` +
            (result.warnings.length > 0 ? `, warns=${result.warnings.slice(0, 2).join('|')}` : ''),
        );
      }
    }
  }
  return { dsls, loaded, skipped, warnings };
}

/**
 * Edge ロード経路全体を try/catch で包んで、repo 例外時は空扱い + warning で継続する。
 * (= formal_bt repo error と同じ思想、世代ループ全体を落とさない)
 */
async function loadEdgeHypothesisParentsSafely(
  loader: EdgeHypothesisLoader,
  status: EdgeStatus,
  limit: number,
  fallbackReasons: string[],
): Promise<{ dsls: StrategyDSL[]; loaded: number; skipped: number; warnings: string[] }> {
  if (limit <= 0) return { dsls: [], loaded: 0, skipped: 0, warnings: [] };
  try {
    return await loadEdgeHypothesisParents(loader, status, limit);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[parentPool] EdgeHypothesis(${status}) のロード失敗、空扱いで継続: ${reason}`);
    fallbackReasons.push(`edge_${status} repo error: ${reason}`);
    return { dsls: [], loaded: 0, skipped: 0, warnings: [`repo error: ${reason}`] };
  }
}

// =================================================================
// 公開 API
// =================================================================

/**
 * 親プールを構築する。
 *
 * v1 (deps.edgeHypothesisLoader 未指定):
 *   formal_bt_passed → current_population → novelty_seed の 3 系統。
 *   従来の動作。
 *
 * v2 (deps.edgeHypothesisLoader 指定):
 *   edge_confirmed / edge_screening_passed / formal_bt_passed / current_population /
 *   edge_unverified / novelty_seed の 6 系統。
 *   優先順位 (重複排除時): edge_confirmed > edge_screening_passed > formal_bt_passed >
 *   current_population > edge_unverified > novelty_seed
 *
 * いずれの場合も、不足ソースは順序通りに次のソースで吸収される。targetSize > 0 なら
 * 必ず非空の pool を返す (novelty_seed が最終フォールバック)。
 */
export async function buildParentPool(
  regime: string,
  targetSize: number,
  scores: Map<string, number>,
  deps: BuildParentPoolDeps,
): Promise<{ entries: ParentPoolEntry[]; summary: ParentPoolSummary }> {
  const hasEdgeLoader = deps.edgeHypothesisLoader != null;
  const requested = computeRequestedCounts(targetSize, hasEdgeLoader);
  const entries: ParentPoolEntry[] = [];
  const fallbackReasons: string[] = [];
  // 重複排除 (PR #98): 優先順位の高い source で先に dsl.id を埋め、後から来た低優先 source は dedup
  const seenDslIds = new Set<string>();
  let edgeDuplicateRemoved = 0;
  const edgeWarnings: string[] = [];
  let edgeLoadedTotal = 0;
  let edgeSkippedTotal = 0;

  function tryAddEdge(dsls: StrategyDSL[], source: ParentPoolSource): number {
    let added = 0;
    for (const dsl of dsls) {
      if (seenDslIds.has(dsl.id)) {
        edgeDuplicateRemoved++;
        continue;
      }
      seenDslIds.add(dsl.id);
      entries.push({ dsl, source });
      added++;
    }
    return added;
  }

  // === v2 専用: EdgeHypothesis 系を先にロード (優先順位順) ===
  let edgeConfirmedShortage = 0;
  let edgeScreeningShortage = 0;
  if (hasEdgeLoader && deps.edgeHypothesisLoader) {
    // 1. edge_confirmed
    const conf = await loadEdgeHypothesisParentsSafely(
      deps.edgeHypothesisLoader,
      'confirmed',
      requested.edge_confirmed,
      fallbackReasons,
    );
    edgeLoadedTotal += conf.loaded;
    edgeSkippedTotal += conf.skipped;
    edgeWarnings.push(...conf.warnings);
    tryAddEdge(conf.dsls.slice(0, requested.edge_confirmed), 'edge_confirmed');
    edgeConfirmedShortage = requested.edge_confirmed - conf.dsls.length;
    if (edgeConfirmedShortage > 0) {
      fallbackReasons.push(
        `edge_confirmed shortage=${edgeConfirmedShortage} (loaded=${conf.loaded}, skipped=${conf.skipped})`,
      );
    }

    // 2. edge_screening_passed (edge_confirmed 不足分を吸収)
    const screeningRequest = requested.edge_screening_passed + Math.max(0, edgeConfirmedShortage);
    const screen = await loadEdgeHypothesisParentsSafely(
      deps.edgeHypothesisLoader,
      'screening_passed',
      screeningRequest,
      fallbackReasons,
    );
    edgeLoadedTotal += screen.loaded;
    edgeSkippedTotal += screen.skipped;
    edgeWarnings.push(...screen.warnings);
    tryAddEdge(screen.dsls.slice(0, screeningRequest), 'edge_screening_passed');
    edgeScreeningShortage = screeningRequest - screen.dsls.length;
    if (edgeScreeningShortage > 0) {
      fallbackReasons.push(
        `edge_screening_passed shortage=${edgeScreeningShortage} (loaded=${screen.loaded}, skipped=${screen.skipped})`,
      );
    }
  }

  // === 3. formal_bt_passed (edge_screening 不足分も吸収) ===
  const formalBtRequest = requested.formal_bt_passed + Math.max(0, edgeScreeningShortage);
  let formalBtLoaded: StrategyDSL[] = [];
  let formalBtLoadError: string | null = null;
  if (deps.evolutionBacktestRepo && formalBtRequest > 0) {
    try {
      formalBtLoaded = await loadFormalBtPassedParents(deps.evolutionBacktestRepo, formalBtRequest);
    } catch (err) {
      formalBtLoadError = err instanceof Error ? err.message : String(err);
      console.warn(`[parentPool] formal_bt_passed のロード失敗、空扱いで継続: ${formalBtLoadError}`);
    }
  }
  let formalBtAdded = 0;
  for (const dsl of formalBtLoaded.slice(0, formalBtRequest)) {
    if (seenDslIds.has(dsl.id)) {
      edgeDuplicateRemoved++;
      continue;
    }
    seenDslIds.add(dsl.id);
    entries.push({ dsl, source: 'formal_bt_passed' });
    formalBtAdded++;
  }
  const formalBtShortage = formalBtRequest - formalBtAdded;
  if (formalBtShortage > 0) {
    let reason: string;
    if (formalBtLoadError) reason = `repo error: ${formalBtLoadError}`;
    else if (!deps.evolutionBacktestRepo) reason = 'repo=null';
    else reason = 'DB に合格履歴不足';
    fallbackReasons.push(`formal_bt_passed shortage=${formalBtShortage} (${reason})`);
  }

  // === 4. current_population (formal_bt 不足分も吸収) ===
  const currentPopulationRequest = requested.current_population + Math.max(0, formalBtShortage);
  const populationLoaded = loadCurrentPopulationParents(
    deps.population,
    regime,
    scores,
    currentPopulationRequest,
  );
  let populationAdded = 0;
  for (const e of populationLoaded) {
    if (seenDslIds.has(e.dsl.id)) {
      edgeDuplicateRemoved++;
      continue;
    }
    seenDslIds.add(e.dsl.id);
    entries.push({ dsl: e.dsl, source: 'current_population', surrogateScore: e.surrogateScore });
    populationAdded++;
  }
  const populationShortage = currentPopulationRequest - populationAdded;
  if (populationShortage > 0) {
    fallbackReasons.push(
      `current_population shortage=${populationShortage} (regime=${regime} の population が小さい)`,
    );
  }

  // === 5. edge_unverified (低優先) ===
  let edgeUnverifiedShortage = 0;
  if (hasEdgeLoader && deps.edgeHypothesisLoader && requested.edge_unverified > 0) {
    const unv = await loadEdgeHypothesisParentsSafely(
      deps.edgeHypothesisLoader,
      'unverified',
      requested.edge_unverified,
      fallbackReasons,
    );
    edgeLoadedTotal += unv.loaded;
    edgeSkippedTotal += unv.skipped;
    edgeWarnings.push(...unv.warnings);
    const added = tryAddEdge(unv.dsls.slice(0, requested.edge_unverified), 'edge_unverified');
    edgeUnverifiedShortage = requested.edge_unverified - added;
    if (edgeUnverifiedShortage > 0) {
      fallbackReasons.push(
        `edge_unverified shortage=${edgeUnverifiedShortage} (loaded=${unv.loaded}, skipped=${unv.skipped})`,
      );
    }
  }

  // === 6. novelty_seed (population 不足 + edge_unverified 不足を吸収、最終 fallback) ===
  const noveltyRequest =
    requested.novelty_seed +
    Math.max(0, populationShortage) +
    Math.max(0, edgeUnverifiedShortage);
  const noveltySeeds = generateNoveltySeeds(regime, noveltyRequest);
  for (const dsl of noveltySeeds) {
    entries.push({ dsl, source: 'novelty_seed' });
  }

  // === 集計 ===
  const selected: Record<ParentPoolSource, number> = {
    edge_confirmed: 0,
    edge_screening_passed: 0,
    formal_bt_passed: 0,
    current_population: 0,
    edge_unverified: 0,
    novelty_seed: 0,
  };
  for (const e of entries) selected[e.source]++;

  const summary: ParentPoolSummary = {
    requested,
    selected,
    fallbackApplied: fallbackReasons.length > 0,
    fallbackReason: fallbackReasons.length > 0 ? fallbackReasons.join(' | ') : null,
    totalSelected: entries.length,
  };
  if (hasEdgeLoader) {
    summary.edgeHypothesisConversion = {
      loaded: edgeLoadedTotal,
      skipped: edgeSkippedTotal,
      duplicateRemoved: edgeDuplicateRemoved,
      warnings: edgeWarnings.slice(0, 10),
    };
  }

  return { entries, summary };
}

/**
 * PR #98: stableDslIdFromHypothesis を re-export (テスト / EvolutionLoop からも使えるよう)
 */
export { stableDslIdFromHypothesis };
