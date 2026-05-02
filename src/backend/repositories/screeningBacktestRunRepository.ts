/**
 * Critical-4 段階 1: 仮説スクリーニング BT 実行履歴 repository
 *
 * analysis-engine 経由で実行された BT 結果を `ScreeningBacktestRun` テーブルに永続化する。
 * `ScreeningOrchestrator` から利用される。
 *
 * 設計方針:
 * - JSON-first (notePayload / summary / trades / equity を JSONB で保持)
 *   理由: backtesting.py の出力構造が将来拡張される想定で、構造化カラム化は段階 4 以降で必要に応じて検討
 * - EdgeHypothesis への外部キーは貼らない (Side-A/Side-B 横断のため、既存 BacktestRun の流儀に揃える)
 */

import type { ScreeningBacktestRun } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { toPrismaJsonValue } from '../../utils/prismaJson';
import type {
  ScreeningBacktestNotePayload,
  ScreeningBacktestSummary,
  ScreeningBacktestTrade,
} from '../../schemas/external/analysisEngine';

export interface ScreeningBacktestRunInsertData {
  hypothesisId: string;
  symbol: string;
  timeframe: string;
  periodStart: Date;
  periodEnd: Date;
  notePayload: ScreeningBacktestNotePayload;
  summary: ScreeningBacktestSummary;
  trades: ScreeningBacktestTrade[];
  equity?: number[] | null;
  engineVersion: string;
}

export class ScreeningBacktestRunRepository {
  async create(data: ScreeningBacktestRunInsertData): Promise<ScreeningBacktestRun> {
    const createData: Prisma.ScreeningBacktestRunUncheckedCreateInput = {
      hypothesisId: data.hypothesisId,
      symbol: data.symbol,
      timeframe: data.timeframe,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      notePayload: toPrismaJsonValue(data.notePayload),
      summary: toPrismaJsonValue(data.summary),
      trades: toPrismaJsonValue(data.trades),
      equity:
        data.equity === undefined || data.equity === null
          ? Prisma.JsonNull
          : toPrismaJsonValue(data.equity),
      engineVersion: data.engineVersion,
    };
    return prisma.screeningBacktestRun.create({ data: createData });
  }

  async findById(id: string): Promise<ScreeningBacktestRun | null> {
    return prisma.screeningBacktestRun.findUnique({ where: { id } });
  }

  async findByHypothesis(
    hypothesisId: string,
    limit: number = 10,
  ): Promise<ScreeningBacktestRun[]> {
    return prisma.screeningBacktestRun.findMany({
      where: { hypothesisId },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(100, limit)),
    });
  }
}

export const screeningBacktestRunRepository = new ScreeningBacktestRunRepository();
