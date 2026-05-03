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
     * 1 件失敗しても他を残したいため `createMany` ではなく `Promise.allSettled` 風の挙動にする。
     * (ただしトランザクションは張らない: 集計用途で部分書き込みが残っても問題なし)
     */
    async createMany(rows: EvolutionBacktestRunInsertData[]): Promise<EvolutionBacktestRun[]> {
        const results: EvolutionBacktestRun[] = [];
        for (const row of rows) {
            try {
                results.push(await this.create(row));
            } catch {
                // 1 件失敗しても他の永続化を継続 (運用ログテーブルのため部分欠損は許容)
            }
        }
        return results;
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
