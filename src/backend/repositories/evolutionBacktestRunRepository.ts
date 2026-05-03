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
      formalBtMetrics: data.formalBtMetrics
        ? toPrismaJsonValue(data.formalBtMetrics)
        : Prisma.JsonNull,
      formalBtFailureReason: data.formalBtFailureReason,
      engine: data.engine,
      engineVersion: data.engineVersion,
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
