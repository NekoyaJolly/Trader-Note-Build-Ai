/**
 * AIトレードノート リポジトリ
 * 
 * AITradeNoteおよびAINoteSummaryのCRUD操作を提供
 * 
 * @see docs/side-b/phase-c-ai-trade-note.md
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../backend/db/client';
import type {
  AITradeNote,
  AINoteSummary,
  CreateAITradeNoteInput,
  CreateAINoteSummaryInput,
  TradeOutcome,
  SummaryPeriod,
} from '../models';

// ===== AITradeNote CRUD =====

/**
 * AIトレードノートを作成
 */
export async function createAITradeNote(
  input: CreateAITradeNoteInput
): Promise<AITradeNote> {
  const note = await prisma.aITradeNote.create({
    data: {
      virtualTradeId: input.virtualTradeId,
      planId: input.planId,
      date: new Date(input.date),
      symbol: input.symbol,
      direction: input.direction,
      outcome: input.result.outcome,
      pnlPips: input.result.pnlPips,
      pnlPercentage: input.result.pnlPercentage,
      rrActual: input.result.riskRewardActual,
      holdingDuration: input.result.holdingDuration,
      entryAnalysis: input.entryAnalysis as unknown as Prisma.InputJsonValue,
      exitAnalysis: input.exitAnalysis as unknown as Prisma.InputJsonValue,
      planEvaluation: input.planEvaluation as unknown as Prisma.InputJsonValue,
      marketReview: input.marketReview as unknown as Prisma.InputJsonValue,
      learnings: input.learnings as unknown as Prisma.InputJsonValue,
      similarPatterns: input.similarPatterns
        ? input.similarPatterns as unknown as Prisma.InputJsonValue
        : undefined,
      lensSnapshot: input.lensSnapshot
        ? input.lensSnapshot as unknown as Prisma.InputJsonValue
        : undefined,
      relatedHypothesisIds: input.relatedHypothesisIds ?? [],
      tradeNoteId: input.tradeNoteId,
      aiModel: input.aiModel,
    },
  });

  return mapPrismaToAITradeNote(note);
}

/**
 * AIトレードノートの tradeNoteId（Side-A TradeNote 同時生成）を後から設定する
 *
 * Phase 4b ブリッジ層: materialize 成功後の best-effort 更新で呼ばれる。
 */
export async function updateAITradeNoteTradeNoteId(
  id: string,
  tradeNoteId: string
): Promise<void> {
  await prisma.aITradeNote.update({
    where: { id },
    data: { tradeNoteId },
  });
}

/**
 * IDでAIトレードノートを取得
 */
export async function findAITradeNoteById(id: string): Promise<AITradeNote | null> {
  const note = await prisma.aITradeNote.findUnique({
    where: { id },
  });

  if (!note) return null;
  return mapPrismaToAITradeNote(note);
}

/**
 * 仮想トレードIDでAIトレードノートを取得
 */
export async function findAITradeNoteByVirtualTradeId(
  virtualTradeId: string
): Promise<AITradeNote | null> {
  const note = await prisma.aITradeNote.findUnique({
    where: { virtualTradeId },
  });

  if (!note) return null;
  return mapPrismaToAITradeNote(note);
}

/**
 * AIトレードノート一覧を取得（フィルター・ページネーション付き）
 */
export async function findAITradeNotes(options: {
  from?: string;
  to?: string;
  outcome?: TradeOutcome;
  symbol?: string;
  limit?: number;
  offset?: number;
}): Promise<{ notes: AITradeNote[]; total: number }> {
  const where: Prisma.AITradeNoteWhereInput = {};

  // 日付フィルター
  if (options.from || options.to) {
    where.date = {};
    if (options.from) where.date.gte = new Date(options.from);
    if (options.to) where.date.lte = new Date(options.to);
  }

  // 結果フィルター
  if (options.outcome) {
    where.outcome = options.outcome;
  }

  // シンボルフィルター
  if (options.symbol) {
    where.symbol = options.symbol;
  }

  const [notes, total] = await Promise.all([
    prisma.aITradeNote.findMany({
      where,
      orderBy: { date: 'desc' },
      take: options.limit,
      skip: options.offset,
    }),
    prisma.aITradeNote.count({ where }),
  ]);

  return {
    notes: notes.map(mapPrismaToAITradeNote),
    total,
  };
}

/**
 * 期間内のAIトレードノートを取得
 */
export async function findAITradeNotesInPeriod(
  startDate: string,
  endDate: string
): Promise<AITradeNote[]> {
  const notes = await prisma.aITradeNote.findMany({
    where: {
      date: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    },
    orderBy: { date: 'asc' },
  });

  return notes.map(mapPrismaToAITradeNote);
}

/**
 * 最近のAIトレードノートを取得（類似パターン検索用）
 */
export async function findRecentAITradeNotes(
  limit: number = 50
): Promise<AITradeNote[]> {
  const notes = await prisma.aITradeNote.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return notes.map(mapPrismaToAITradeNote);
}

/**
 * シンボル別のAIトレードノートを取得
 */
export async function findAITradeNotesBySymbol(
  symbol: string,
  limit: number = 20
): Promise<AITradeNote[]> {
  const notes = await prisma.aITradeNote.findMany({
    where: { symbol },
    orderBy: { date: 'desc' },
    take: limit,
  });

  return notes.map(mapPrismaToAITradeNote);
}

// ===== AINoteSummary CRUD =====

/**
 * AIノートサマリーを作成
 */
export async function createAINoteSummary(
  input: CreateAINoteSummaryInput
): Promise<AINoteSummary> {
  const summary = await prisma.aINoteSummary.create({
    data: {
      period: input.period,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      statistics: input.statistics as unknown as Prisma.InputJsonValue,
      analysis: input.analysis as unknown as Prisma.InputJsonValue,
      summary: input.summary as unknown as Prisma.InputJsonValue,
    },
  });

  return mapPrismaToAINoteSummary(summary);
}

/**
 * IDでAIノートサマリーを取得
 */
export async function findAINoteSummaryById(id: string): Promise<AINoteSummary | null> {
  const summary = await prisma.aINoteSummary.findUnique({
    where: { id },
  });

  if (!summary) return null;
  return mapPrismaToAINoteSummary(summary);
}

/**
 * 期間・日付でAIノートサマリーを取得
 */
export async function findAINoteSummaryByPeriod(
  period: SummaryPeriod,
  startDate: string,
  endDate: string
): Promise<AINoteSummary | null> {
  const summary = await prisma.aINoteSummary.findFirst({
    where: {
      period,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
    },
  });

  if (!summary) return null;
  return mapPrismaToAINoteSummary(summary);
}

/**
 * AIノートサマリー一覧を取得
 */
export async function findAINoteSummaries(options: {
  period?: SummaryPeriod;
  limit?: number;
  offset?: number;
}): Promise<{ summaries: AINoteSummary[]; total: number }> {
  const where: Prisma.AINoteSummaryWhereInput = {};

  if (options.period) {
    where.period = options.period;
  }

  const [summaries, total] = await Promise.all([
    prisma.aINoteSummary.findMany({
      where,
      orderBy: { startDate: 'desc' },
      take: options.limit,
      skip: options.offset,
    }),
    prisma.aINoteSummary.count({ where }),
  ]);

  return {
    summaries: summaries.map(mapPrismaToAINoteSummary),
    total,
  };
}

/**
 * 既存のサマリーをアップサート（更新または作成）
 */
export async function upsertAINoteSummary(
  input: CreateAINoteSummaryInput
): Promise<AINoteSummary> {
  const summary = await prisma.aINoteSummary.upsert({
    where: {
      period_startDate_endDate: {
        period: input.period,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
      },
    },
    update: {
      statistics: input.statistics as unknown as Prisma.InputJsonValue,
      analysis: input.analysis as unknown as Prisma.InputJsonValue,
      summary: input.summary as unknown as Prisma.InputJsonValue,
    },
    create: {
      period: input.period,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      statistics: input.statistics as unknown as Prisma.InputJsonValue,
      analysis: input.analysis as unknown as Prisma.InputJsonValue,
      summary: input.summary as unknown as Prisma.InputJsonValue,
    },
  });

  return mapPrismaToAINoteSummary(summary);
}

// ===== 統計クエリ =====

/**
 * 結果別の件数を取得
 */
export async function countNotesByOutcome(): Promise<{
  win: number;
  loss: number;
  breakeven: number;
}> {
  const results = await prisma.aITradeNote.groupBy({
    by: ['outcome'],
    _count: true,
  });

  const counts = { win: 0, loss: 0, breakeven: 0 };
  for (const r of results) {
    if (r.outcome === 'win') counts.win = r._count;
    else if (r.outcome === 'loss') counts.loss = r._count;
    else if (r.outcome === 'breakeven') counts.breakeven = r._count;
  }

  return counts;
}

// ===== マッピング関数 =====

// Prisma型からアプリ型へのマッピング（型アサーション）
type PrismaAITradeNote = Awaited<ReturnType<typeof prisma.aITradeNote.findFirst>> & object;
type PrismaAINoteSummary = Awaited<ReturnType<typeof prisma.aINoteSummary.findFirst>> & object;

function mapPrismaToAITradeNote(note: NonNullable<PrismaAITradeNote>): AITradeNote {
  return {
    id: note.id,
    virtualTradeId: note.virtualTradeId,
    planId: note.planId,
    date: note.date.toISOString().split('T')[0],
    symbol: note.symbol,
    direction: note.direction as 'long' | 'short',
    result: {
      outcome: note.outcome as TradeOutcome,
      pnlPips: note.pnlPips.toNumber(),
      pnlPercentage: note.pnlPercentage.toNumber(),
      riskRewardActual: note.rrActual.toNumber(),
      holdingDuration: note.holdingDuration,
    },
    entryAnalysis: note.entryAnalysis as unknown as AITradeNote['entryAnalysis'],
    exitAnalysis: note.exitAnalysis as unknown as AITradeNote['exitAnalysis'],
    planEvaluation: note.planEvaluation as unknown as AITradeNote['planEvaluation'],
    marketReview: note.marketReview as unknown as AITradeNote['marketReview'],
    learnings: note.learnings as unknown as AITradeNote['learnings'],
    similarPatterns: note.similarPatterns as unknown as AITradeNote['similarPatterns'],
    lensSnapshot: note.lensSnapshot as unknown as AITradeNote['lensSnapshot'],
    relatedHypothesisIds: note.relatedHypothesisIds ?? [],
    tradeNoteId: note.tradeNoteId ?? undefined,
    aiModel: note.aiModel,
    createdAt: note.createdAt,
  };
}

function mapPrismaToAINoteSummary(summary: NonNullable<PrismaAINoteSummary>): AINoteSummary {
  return {
    id: summary.id,
    period: summary.period as SummaryPeriod,
    startDate: summary.startDate.toISOString().split('T')[0],
    endDate: summary.endDate.toISOString().split('T')[0],
    statistics: summary.statistics as unknown as AINoteSummary['statistics'],
    analysis: summary.analysis as unknown as AINoteSummary['analysis'],
    summary: summary.summary as unknown as AINoteSummary['summary'],
    createdAt: summary.createdAt,
  };
}
