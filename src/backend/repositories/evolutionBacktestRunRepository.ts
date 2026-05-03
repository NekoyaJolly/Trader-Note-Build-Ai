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
}

export const evolutionBacktestRunRepository = new EvolutionBacktestRunRepository();
