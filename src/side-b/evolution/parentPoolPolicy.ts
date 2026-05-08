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

// PR ⑤D-2: novelty seed の id 採番は seedDescriptor.buildSeedDsl 内で randomUUID を
// 使うようになったので本ファイルでは不要。

import { StrategyDSLSchema, type StrategyDSL } from '../strategy_dsl/schema';
// PR #122 Copilot review: `EvolutionLoop` ↔ `parentPoolPolicy` の循環依存を避けるため、
// PR ⑤D-2: 旧 getSeedDescriptor (= regime 別 RSI/ATR 単純 seed) は撤廃され、
// 6 カテゴリ × long/short = 12 種の novelty seed を `buildAllNoveltySeeds` /
// `buildSeedDsl` で供給する形に統一された。
import { ALL_SEED_KINDS, buildSeedDsl } from './seedDescriptor';
import type { StrategyPopulation } from './StrategyPopulation';
import type { EvolutionBacktestRunRepository } from '../../backend/repositories/evolutionBacktestRunRepository';
import type { EdgeHypothesis, EdgeStatus } from '../models/edgeHypothesis';
import { dslFromHypothesis, stableDslIdFromHypothesis } from './dslFromHypothesis';
// Filter Evolution M4: ModuleParent (= フィルタ素材) を crossover 用候補として並列に提供。
// 親プール (= StrategyDSL parents) とは別軸で、entry 1 つ分の filter spec として渡す。
import {
  selectModuleParents,
  type ModuleParent,
  type ModuleParentCategory,
} from './moduleParentRegistry';

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
 *
 * PR ⑤E (学術検証 fb): novelty_seed を 5% → 10% に引き上げる。Lehman & Stanley
 * (2011) "Abandoning Objectives" の知見で、目的関数だけ追うと local optimum
 * に落ちるため novelty 注入が不可欠とされる。市場レジーム変化時の多様性枯渇
 * を防ぐため novelty 圧を増やす。差分は edge_screening_passed (35% → 30%)
 * から振り替え (= 合計 100% 維持)。
 */
export const parentPoolPolicyV2 = {
  edge_confirmed: 0.25,
  edge_screening_passed: 0.30,
  formal_bt_passed: 0.2,
  current_population: 0.1,
  edge_unverified: 0.05,
  novelty_seed: 0.10,
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
    /**
     * 親プール全体の dsl.id 重複排除件数。
     * EdgeHypothesis 由来の重複 (= 同 hypothesis が複数 status から来たケース) に加え、
     * formal_bt_passed / current_population で同 dsl.id が再出現したケースも含む。
     * EdgeHypothesis 専用の dedup 数だけに絞ると、edge → formal_bt 間の dedup が
     * 観測不能になるため、敢えて全体カウンタとして扱う。
     */
    duplicateRemoved: number;
    /** 変換失敗 / 警告ログ (debug 用、最大 10 件) */
    warnings: string[];
  };
  /**
   * Filter Evolution M4: ModuleParent (= フィルタ素材) の選別結果。
   * crossover/mutation で「親 A に追加できる filter 部品」として使う。
   * - `selected`: 選別された ModuleParent 件数
   * - `byCategory`: カテゴリ別件数 (= 観測用、調整判断材料)
   * 本 PR (M4) では interface 拡張のみで prompt には未連携 (M3 で接続)。
   */
  moduleParents?: {
    selected: number;
    byCategory: Partial<Record<ModuleParentCategory, number>>;
  };
}

/**
 * PR #98 親プール統合用に追加された EdgeHypothesis ロード経路。
 *
 * `limit` を必須化することで、EdgeHypothesis 件数が増えても親プール構築時に
 * 全件メモリ展開しない設計にする (= EdgeLedger 側でも `take` を効かせる前提)。
 * 値を省略した実装は最大件数キャップで動作するか、interface を満たすラッパで
 * limit を適用する。
 */
export interface EdgeHypothesisLoader {
  findByStatus(status: EdgeStatus, limit: number): Promise<EdgeHypothesis[]>;
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
  /**
   * Filter Evolution M4: ModuleParent を選別する件数。0 や undefined で無効化。
   * 推奨: 5 (= 設計書 §4.2、親 A 1 つあたり 3〜5 種の filter 候補を渡す)。
   * 静的選択 (= moduleParentRegistry の round-robin) なので副作用なし。
   */
  moduleParentCount?: number;
  /**
   * Filter Evolution M4: ModuleParent 選別の rotation offset (= テスト時の決定性 pin)。
   * 通常運用では未指定で OK (= 0 から開始)。
   */
  moduleParentRotationOffset?: number;
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
 * PR ⑤D-2: novelty seed = **6 カテゴリ × long/short = 12 種** の戦略を初期世代に
 * 並列注入する (LLM 不使用、コスト 0)。
 *
 * - 6 カテゴリ: MTF / multi-instance / トレンド / オシレーター / アノマリー / レンジ
 * - 各カテゴリに long と short 両方を用意 (= 計 12)
 * - count >= 12 なら 12 種を全部 + 余分は 12 種からラウンドロビンで複製
 * - count < 12 なら 12 種から先頭 count 個を注入
 * - 各 seed は **異なる id (= randomUUID 含む)** を持ち、StrategyPopulation で
 *   重複しない
 *
 * post-Phase 5A: 旧実装は regime 別の RSI/ATR 単純 seed (PR #114) で、進化が
 * 同じような戦略を生み続けるリスクがあった。PR ⑤D-2 で機能群 (= MTF /
 * multi-instance / pattern / time_session / 20 indicator) を「使い切る」形に
 * 全面再設計。`buildSeedDsl(kind, regime)` 経由で 12 種を供給。
 */
function generateNoveltySeeds(regime: string, count: number): StrategyDSL[] {
  const out: StrategyDSL[] = [];
  for (let i = 0; i < count; i++) {
    const kind = ALL_SEED_KINDS[i % ALL_SEED_KINDS.length];
    out.push(buildSeedDsl(kind, regime));
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
  // 変換失敗を考慮して 2x over-fetch (上限 cap=200)、loader 側でも limit を効かせる
  const fetchLimit = Math.min(200, Math.max(limit * 2, 10));
  const rows = await loader.findByStatus(status, fetchLimit);
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
): Promise<{
  entries: ParentPoolEntry[];
  /**
   * Filter Evolution M4: ModuleParent 選別結果 (= フィルタ素材)。
   * `deps.moduleParentCount` 未指定 / 0 なら空配列。crossover agent には
   * `entries` (= StrategyDSL 親) と並列に渡し、prompt で「親 A に AND 追加
   * できる filter 候補」として扱う (M3 で接続)。
   */
  moduleEntries: ModuleParent[];
  summary: ParentPoolSummary;
}> {
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
  // PR #98 Copilot fix #3: shortage は dedup 後の実 added 件数で計算する
  //   (load 件数 != entries に追加された件数。同 dsl.id が複数 status から来た場合
  //    dedup で落ちるため、loaded - dedup を fallback に流すのが正しい)
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
    const addedConfirmed = tryAddEdge(
      conf.dsls.slice(0, requested.edge_confirmed),
      'edge_confirmed',
    );
    const edgeConfirmedShortage = requested.edge_confirmed - addedConfirmed;
    if (edgeConfirmedShortage > 0) {
      fallbackReasons.push(
        `edge_confirmed shortage=${edgeConfirmedShortage} (loaded=${conf.loaded}, ` +
          `skipped=${conf.skipped}, added=${addedConfirmed})`,
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
    const addedScreening = tryAddEdge(
      screen.dsls.slice(0, screeningRequest),
      'edge_screening_passed',
    );
    edgeScreeningShortage = screeningRequest - addedScreening;
    if (edgeScreeningShortage > 0) {
      fallbackReasons.push(
        `edge_screening_passed shortage=${edgeScreeningShortage} (loaded=${screen.loaded}, ` +
          `skipped=${screen.skipped}, added=${addedScreening})`,
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
  // PR #98 Copilot fix #3: shortage は dedup 後の added 件数で計算する
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
    const addedUnverified = tryAddEdge(unv.dsls.slice(0, requested.edge_unverified), 'edge_unverified');
    edgeUnverifiedShortage = requested.edge_unverified - addedUnverified;
    if (edgeUnverifiedShortage > 0) {
      fallbackReasons.push(
        `edge_unverified shortage=${edgeUnverifiedShortage} (loaded=${unv.loaded}, ` +
          `skipped=${unv.skipped}, added=${addedUnverified})`,
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

  // === 7. ModuleParent (= フィルタ素材) 選別 (Filter Evolution M4) ===
  // crossover/mutation で「親 A に追加できる filter 部品」として並列に提供する。
  // 既存の StrategyDSL 親プールとは別軸 (= moduleEntries として返す)。
  // 本 PR (M4) では選別 + summary 反映のみ、prompt 接続は M3 で別 PR。
  const moduleParentCount = deps.moduleParentCount ?? 0;
  const moduleEntries: ModuleParent[] =
    moduleParentCount > 0
      ? selectModuleParents({
          regime,
          count: moduleParentCount,
          rotationOffset: deps.moduleParentRotationOffset,
        })
      : [];
  if (moduleEntries.length > 0) {
    const byCategory: Partial<Record<ModuleParentCategory, number>> = {};
    for (const m of moduleEntries) {
      byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
    }
    summary.moduleParents = {
      selected: moduleEntries.length,
      byCategory,
    };
  }

  return { entries, moduleEntries, summary };
}

/**
 * PR #98: stableDslIdFromHypothesis を re-export (テスト / EvolutionLoop からも使えるよう)
 */
export { stableDslIdFromHypothesis };
