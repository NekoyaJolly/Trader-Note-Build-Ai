/**
 * Critical-4 段階 4a.4: 進化ループ正式 BT 履歴 repository
 *
 * EvolutionLoop top K の analysis-engine 正式 BT 結果を `EvolutionBacktestRun`
 * テーブルに保存する。`ScreeningBacktestRun` (= EdgeHypothesis 由来) とは
 * テーブル分離により、進化ループ専用の集計クエリ (generation 別 passed 率、
 * failureReason 分布) を素直に書ける。
 *
 * 設計方針:
 * - JSON-first (dslSnapshot / formalBtMetrics を JSONB で保持)
 * - EdgeHypothesis への外部キーは持たない (進化候補は仮説化前のため)
 * - 失敗ケース (formalBtPassed=false) も全て保存する (運用観察用)
 */

import type { EvolutionBacktestRun } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { toPrismaJsonValue } from '../../utils/prismaJson';
import type { StrategyDSL } from '../../side-b/strategy_dsl/schema';

/**
 * 正式 BT メトリクス。EvolutionLoop の `FormalBtMetrics` と同じ形だが、
 * 循環 import を避けるためここでは構造を直接書く (依存方向: EvolutionLoop → repo)。
 */
export interface EvolutionBacktestMetrics {
  pf: number;
  winRate: number;
  tradeCount: number;
}

/**
 * Filter Evolution Phase B-1 (2026-05-09): 本格 BT で発生した個別 trade の永続化形式。
 *
 * 各候補の trade list は `EvolutionBacktestRun.trades` に JSON 配列として保存され、
 * cron 起動を跨いだ Win Rate Lift 計算 (= M2) や parentLossTrades 抽出 (= M3) の
 * データソースになる。
 *
 * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.B.3
 */
export interface EvolutionBacktestTrade {
  /** ISO 8601 datetime */
  entryTime: string;
  side: 'long' | 'short';
  pnl: number;
  outcome: 'win' | 'loss' | 'timeout';
}

/**
 * OOS-aware 昇格判定の観測結果（永続化形式）。
 * 循環 import を避けるため、side-b/evolution の型に依存せず構造を直接書く。
 * confirmed=true は in-sample 合格に加え OOS/WF も通過した「OOS確証」候補。
 */
export interface EvolutionOosResultData {
  /** finalStage === 'validation_confirmed'（in-sample 合格 + OOS/WF 通過）か */
  confirmed: boolean;
  /** OOS-aware 合成後の最終ステージ（validation_confirmed / validation_candidate 等） */
  finalStage: string;
  /** OOS verdict（oos_passed / walk_forward_passed / oos_failed / not_evaluated / ...）。未評価は null */
  oosStatus: string | null;
  /** OOS 期間の PF（観測用）。取得不能/未評価は null */
  oosPf: number | null;
  /** OOS 期間の勝率（観測用）。取得不能/未評価は null */
  oosWinRate: number | null;
}

export interface EvolutionBacktestRunInsertData {
  evolutionRunId: string;
  generation: number;
  candidateId: string;
  candidateHash: string;
  dslSnapshot: StrategyDSL;
  surrogateScore: number;
  formalBtPassed: boolean;
  formalBtMetrics: EvolutionBacktestMetrics | null;
  formalBtFailureReason: string | null;
  engine: string;
  engineVersion: string;
  /**
   * Phase B-1: 本格 BT で発生した trade list。tradeCount > 0 の候補は非空、
   * BT 失敗 / response 取得不能の候補は undefined (= NULL 永続化、Phase B-1 以前の行と同等)。
   */
  trades?: ReadonlyArray<EvolutionBacktestTrade>;
  /**
   * OOS-aware 昇格判定の観測結果。OOS 未評価 / validation_candidate 以外は undefined（= NULL 永続化）。
   * formalBtPassed の意味論は変えず、観測の可視化用に並列保持する。
   */
  oosResult?: EvolutionOosResultData;
}

export class EvolutionBacktestRunRepository {
  async create(data: EvolutionBacktestRunInsertData): Promise<EvolutionBacktestRun> {
    const createData: Prisma.EvolutionBacktestRunUncheckedCreateInput = {
      evolutionRunId: data.evolutionRunId,
      generation: data.generation,
      candidateId: data.candidateId,
      candidateHash: data.candidateHash,
      dslSnapshot: toPrismaJsonValue(data.dslSnapshot),
      surrogateScore: data.surrogateScore,
      formalBtPassed: data.formalBtPassed,
      // PR #139 Copilot review: `Prisma.JsonNull` は JSON 値としての null (= JSONB に "null" が
      // 書き込まれる)、`Prisma.DbNull` は SQL の NULL (= 列が NULL)。Phase B-1 以前の既存行は
      // SQL NULL なので、未指定値を `Prisma.DbNull` に統一して将来の `IS NULL` / `equals: DbNull`
      // 検索でも一致するようにする。formalBtMetrics / trades 両方で同じ意味論を維持する。
      formalBtMetrics: data.formalBtMetrics
        ? toPrismaJsonValue(data.formalBtMetrics)
        : Prisma.DbNull,
      formalBtFailureReason: data.formalBtFailureReason,
      engine: data.engine,
      engineVersion: data.engineVersion,
      // Phase B-1: trades が undefined のときは SQL NULL を書き込み、既存行 (Phase B-1 以前) と
      //   完全に同じ意味論にする。analysis-engine 例外で trades 取得不能だった候補は
      //   読み出し側で notComputable 経路に逃がす。
      trades: data.trades ? toPrismaJsonValue(data.trades) : Prisma.DbNull,
      // OOS未評価 / validation_candidate 以外は SQL NULL（既存行と同じ意味論）。
      oosResult: data.oosResult ? toPrismaJsonValue(data.oosResult) : Prisma.DbNull,
    };
    return prisma.evolutionBacktestRun.create({ data: createData });
  }

  /**
   * 一括登録 (1 世代分の verified 全件 = passed + failed)。
   *
   * - 並列実行 (`Promise.allSettled`) で行数増加時の遅延を抑える
   * - 1 行失敗しても他は永続化を継続 (運用ログテーブル方針)
   * - 失敗時は candidateId / evolutionRunId / error を console.warn に出して原因追跡可能にする
   * - トランザクションは張らない (集計用途で部分書き込みが残っても問題なし)
   */
  async createMany(rows: EvolutionBacktestRunInsertData[]): Promise<EvolutionBacktestRun[]> {
    const settled = await Promise.allSettled(rows.map((row) => this.create(row)));
    const successes: EvolutionBacktestRun[] = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        successes.push(r.value);
      } else {
        const row = rows[i];
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.warn(
          `[EvolutionBacktestRunRepository] 永続化失敗: ` +
            `candidateId=${row.candidateId} evolutionRunId=${row.evolutionRunId} ` +
            `generation=${row.generation} reason=${reason}`,
        );
      }
    });
    return successes;
  }

  async findById(id: string): Promise<EvolutionBacktestRun | null> {
    return prisma.evolutionBacktestRun.findUnique({ where: { id } });
  }

  async findByEvolutionRun(
    evolutionRunId: string,
    limit: number = 100,
  ): Promise<EvolutionBacktestRun[]> {
    return prisma.evolutionBacktestRun.findMany({
      where: { evolutionRunId },
      orderBy: [{ generation: 'asc' }, { createdAt: 'asc' }],
      take: Math.max(1, Math.min(1000, limit)),
    });
  }

  /**
   * Critical-4 PR #95 (親個体プール v1): formalBtPassed=true の履歴から
   * 親候補として再利用できる過去候補を取得する。
   *
   * - 直近 createdAt 降順 (最新の合格戦略から優先)
   * - candidateHash 重複除去 (= 構造的に同じ DSL は 1 件だけ採用)
   *   ハッシュベースの距離は v1 では計算せず単純な完全一致のみ
   * - dslSnapshot は JSON で保存されているため、呼び出し側で StrategyDSLSchema.safeParse する
   *
   * dedup 方針:
   *   `limit` を **ユニーク件数の上限** として扱う。重複が多いと limit 件返らない問題を
   *   避けるため、内部で `limit * 4` 件まで over-fetch してから dedup → 先頭 `limit` 件で切る。
   *   重複率が極端に高くて over-fetch でも足りない場合は単に少ない件数を返す
   *   (= 呼び出し側は不足を受容して fallback 動作する想定 / 完全保証は paging が必要だが v1 では不要)。
   */
  async findRecentFormalBtPassed(limit: number = 50): Promise<EvolutionBacktestRun[]> {
    const requested = Math.max(1, Math.min(500, limit));
    // ユニーク件数を確保するため 4x まで over-fetch (cap 2000)
    const take = Math.min(2000, requested * 4);
    const rows = await prisma.evolutionBacktestRun.findMany({
      where: { formalBtPassed: true },
      orderBy: { createdAt: 'desc' },
      take,
    });
    // candidateHash 単位で先勝ち (最新が残る)
    const seen = new Set<string>();
    const unique: EvolutionBacktestRun[] = [];
    for (const r of rows) {
      if (seen.has(r.candidateHash)) continue;
      seen.add(r.candidateHash);
      unique.push(r);
      if (unique.length >= requested) break;
    }
    return unique;
  }

  /**
   * 段階 4a.PDCA smoke: evolutionRunId 単位で formalBtPassed / failureReason 分布を集計する。
   *
   * 用途:
   *  - formalBtPassed=0 件でも、どこで何件落ちたかを 1 クエリで確認できる
   *  - generation 別の通過率を観測 (親個体プール戦略の効果測定の準備)
   *
   * 集計仕様:
   *  - failureReason の生文字列は `classifyFailureReason()` で 6 カテゴリに正規化してから
   *    `failureReasonCounts` にカウント (insufficient_trades / low_pf / analysis_engine_timeout
   *    / analysis_engine_error / dsl_missing / other / unknown)
   *  - 別の分類が必要な場合は `findByEvolutionRun()` で生データを取って独自集計する
   */
  async summarizeByEvolutionRun(evolutionRunId: string): Promise<EvolutionRunSummary> {
    const rows = await prisma.evolutionBacktestRun.findMany({
      where: { evolutionRunId },
      select: {
        generation: true,
        formalBtPassed: true,
        formalBtFailureReason: true,
      },
      orderBy: [{ generation: 'asc' }, { createdAt: 'asc' }],
    });

    const failureReasonCounts: Record<string, number> = {};
    const perGeneration = new Map<number, { passed: number; failed: number }>();
    let passed = 0;
    let failed = 0;

    for (const r of rows) {
      const bucket = perGeneration.get(r.generation) ?? { passed: 0, failed: 0 };
      if (r.formalBtPassed) {
        passed++;
        bucket.passed++;
      } else {
        failed++;
        bucket.failed++;
        const key = classifyFailureReason(r.formalBtFailureReason);
        failureReasonCounts[key] = (failureReasonCounts[key] ?? 0) + 1;
      }
      perGeneration.set(r.generation, bucket);
    }

    const generations = Array.from(perGeneration.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([generation, counts]) => ({ generation, ...counts }));

    return {
      evolutionRunId,
      totalCandidates: rows.length,
      passed,
      failed,
      failureReasonCounts,
      generations,
    };
  }
}

/** generation 別の集計エントリ */
export interface EvolutionGenerationSummary {
  generation: number;
  passed: number;
  failed: number;
}

/** evolutionRun 1 つ分の集計結果 */
export interface EvolutionRunSummary {
  evolutionRunId: string;
  totalCandidates: number;
  passed: number;
  failed: number;
  /** 失敗理由カテゴリ → 件数 (`classifyFailureReason` のラベル) */
  failureReasonCounts: Record<string, number>;
  generations: EvolutionGenerationSummary[];
}

/**
 * `formalBtFailureReason` 文字列を 6 カテゴリに分類する。
 *
 * EvolutionLoop が出す失敗文字列 (例:
 *   - 'analysis-engine BT failed: timeout of ...'
 *   - 'tradeCount 5 < 20'
 *   - 'pf 0.8 < 1'
 *   - 'DSL not found in current generation map'
 * ) を集計しやすい固定キーに正規化する。
 */
export function classifyFailureReason(reason: string | null): string {
  if (!reason) return 'unknown';
  if (reason.startsWith('tradeCount ')) return 'insufficient_trades';
  if (reason.startsWith('pf ')) return 'low_pf';
  if (reason.includes('timeout')) return 'analysis_engine_timeout';
  if (reason.includes('analysis-engine BT failed')) return 'analysis_engine_error';
  if (reason.includes('DSL not found')) return 'dsl_missing';
  return 'other';
}

export const evolutionBacktestRunRepository = new EvolutionBacktestRunRepository();
