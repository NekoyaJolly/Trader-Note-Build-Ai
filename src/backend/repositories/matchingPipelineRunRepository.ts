import type {
  MatchingPipelineRun,
  MatchingPipelineRunStatus,
  PrismaClient,
} from '@prisma/client';
import { prisma } from '../db/client';

/**
 * MatchingPipelineRun リポジトリ（P1: observability）
 *
 * 目的: MatchingService.runMatchingPipeline() の実行単位（cron サイクル）を永続化し、
 * 運用者が「いつ動いたか / 何件マッチ・通知・スキップしたか / なぜ通知されなかったか」を
 * runId 単位で追えるようにする。
 *
 * 設計:
 * - 1 run = 1 行（更新せず insert のみ）。runId はアプリ側で生成して create 時に渡す
 *   （永続化が失敗しても API レスポンスに runId を返せるようにするため）。
 * - 書き込みは MatchingService からのみ行う。
 */
export interface MatchingPipelineRunCreateInput {
  /// アプリ側で生成した runId（= 行 ID）
  id: string;
  trigger: string;
  status: MatchingPipelineRunStatus;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  totalMatches: number;
  notified: number;
  skipped: number;
  errorCount: number;
  errors: string[];
  /// reason code -> 件数の集計
  skipReasons: Record<string, number>;
  marketStatus?: string | null;
}

export class MatchingPipelineRunRepository {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || prisma;
  }

  /**
   * run を 1 行記録する。
   */
  async create(input: MatchingPipelineRunCreateInput): Promise<MatchingPipelineRun> {
    return this.prisma.matchingPipelineRun.create({
      data: {
        id: input.id,
        trigger: input.trigger,
        status: input.status,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        durationMs: input.durationMs,
        totalMatches: input.totalMatches,
        notified: input.notified,
        skipped: input.skipped,
        errorCount: input.errorCount,
        errors: input.errors,
        // Record<string, number> は JSON 値としてそのまま保存できる
        skipReasons: input.skipReasons,
        marketStatus: input.marketStatus ?? null,
      },
    });
  }

  /**
   * 最新の run を 1 件取得する。run が無ければ null。
   */
  async findLatest(): Promise<MatchingPipelineRun | null> {
    return this.prisma.matchingPipelineRun.findFirst({
      orderBy: { startedAt: 'desc' },
    });
  }

  /**
   * 最新順に run 一覧を取得する。
   */
  async findMany(limit: number): Promise<MatchingPipelineRun[]> {
    return this.prisma.matchingPipelineRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }
}
