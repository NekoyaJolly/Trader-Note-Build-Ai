/**
 * Side-B マッチングアダプター
 *
 * 責務:
 * - 勝ちパターンの AITradeNote を DB からロード
 * - AITradePlan の marketAnalysis + VirtualTrade のエントリー情報を結合
 * - SideBNoteEvaluator インスタンスを生成
 *
 * MatchingService から呼ばれ、Side-A の TradeNote と並行して
 * Side-B ノートもマッチング対象に加える。
 *
 * @see src/domain/matching/sideBNoteEvaluator.ts
 */

import { prisma } from '../backend/db/client';
import type {
  SideBNoteMatchingData,
  SideBMarketAnalysis} from '../domain/matching/sideBNoteEvaluator';
import {
  SideBNoteEvaluator
} from '../domain/matching/sideBNoteEvaluator';
import type { NoteEvaluator } from '../domain/noteEvaluator';

// ============================================================================
// 型定義
// ============================================================================

interface SideBNoteWithContext {
  id: string;
  symbol: string;
  direction: string;
  outcome: string;
  pnlPips: number;
  rrActual: number;
  entryAnalysis: Record<string, unknown>;
  marketReview: Record<string, unknown>;
  entryPrice: number;
  marketAnalysis: SideBMarketAnalysis;
  timeframe: string | null;
}

// ============================================================================
// SideBMatchingAdapter
// ============================================================================

export class SideBMatchingAdapter {
  /**
   * 勝ちパターンの AITradeNote をロードし、SideBNoteEvaluator を生成
   *
   * @param outcomeFilter - フィルタする outcome（デフォルト: win のみ）
   * @returns シンボル別にグループ化された NoteEvaluator マップ
   */
  async loadWinningNoteEvaluators(
    outcomeFilter: string[] = ['win']
  ): Promise<Map<string, { evaluator: NoteEvaluator; data: SideBNoteMatchingData }[]>> {
    // AITradeNote + VirtualTrade + AITradePlan を JOIN で取得
    const rawNotes = await prisma.aITradeNote.findMany({
      where: {
        outcome: { in: outcomeFilter },
      },
      include: {
        virtualTrade: {
          select: {
            actualEntry: true,
            exitPrice: true,
            stopLoss: true,
            takeProfit: true,
            enteredAt: true,
            exitedAt: true,
          },
        },
        plan: {
          select: {
            symbol: true,
            marketAnalysis: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    console.log(`[SideBMatchingAdapter] ${rawNotes.length} 件の勝ちパターンノートをロード`);

    const grouped = new Map<string, { evaluator: NoteEvaluator; data: SideBNoteMatchingData }[]>();

    for (const note of rawNotes) {
      try {
        // marketAnalysis をパース
        const marketAnalysis = this.parseMarketAnalysis(note.plan.marketAnalysis);
        if (!marketAnalysis) {
          console.warn(`[SideBMatchingAdapter] marketAnalysis パース失敗: noteId=${note.id}`);
          continue;
        }

        const entryPrice = Number(note.virtualTrade.actualEntry);
        if (!entryPrice || entryPrice <= 0) {
          console.warn(`[SideBMatchingAdapter] entryPrice 無効: noteId=${note.id}`);
          continue;
        }

        const matchingData: SideBNoteMatchingData = {
          noteId: note.id,
          symbol: note.symbol,
          direction: note.direction as 'long' | 'short',
          outcome: note.outcome as 'win' | 'loss' | 'breakeven',
          pnlPips: Number(note.pnlPips),
          rrActual: Number(note.rrActual),
          entryPrice,
          marketAnalysis,
          entryAnalysis: (note.entryAnalysis as Record<string, unknown>) ?? {},
          timeframe: undefined, // AITradePlan にはtimeframeフィールドなし
        };

        const evaluator = new SideBNoteEvaluator(matchingData);

        const existing = grouped.get(note.symbol) || [];
        existing.push({ evaluator, data: matchingData });
        grouped.set(note.symbol, existing);
      } catch (err) {
        console.error(`[SideBMatchingAdapter] ノート変換エラー: noteId=${note.id}`, err);
      }
    }

    console.log(
      `[SideBMatchingAdapter] ${Array.from(grouped.values()).reduce((sum, arr) => sum + arr.length, 0)} 件の Evaluator を生成 (${grouped.size} シンボル)`
    );

    return grouped;
  }

  /**
   * 勝ちパターンのシンボル一覧を取得（マーケットデータ取得の最適化用）
   */
  async getWinningSymbols(): Promise<string[]> {
    const symbols = await prisma.aITradeNote.findMany({
      where: { outcome: 'win' },
      select: { symbol: true },
      distinct: ['symbol'],
    });
    return symbols.map(s => s.symbol);
  }

  /**
   * marketAnalysis JSON をパースして型付きオブジェクトに変換
   */
  private parseMarketAnalysis(raw: unknown): SideBMarketAnalysis | null {
    if (!raw || typeof raw !== 'object') return null;

    const data = raw as Record<string, unknown>;

    // 必須フィールドチェック
    if (!data.regime || !data.trendDirection) return null;

    return {
      regime: String(data.regime || 'range'),
      volatility: String(data.volatility || 'medium'),
      trendDirection: String(data.trendDirection || 'sideways'),
      regimeConfidence: Number(data.regimeConfidence || 50),
      keyLevels: {
        support: Array.isArray((data.keyLevels as Record<string, unknown>)?.support)
          ? ((data.keyLevels as Record<string, unknown>).support as number[])
          : [],
        resistance: Array.isArray((data.keyLevels as Record<string, unknown>)?.resistance)
          ? ((data.keyLevels as Record<string, unknown>).resistance as number[])
          : [],
        strongSupport: Array.isArray((data.keyLevels as Record<string, unknown>)?.strongSupport)
          ? ((data.keyLevels as Record<string, unknown>).strongSupport as number[])
          : [],
        strongResistance: Array.isArray((data.keyLevels as Record<string, unknown>)?.strongResistance)
          ? ((data.keyLevels as Record<string, unknown>).strongResistance as number[])
          : [],
      },
      summary: data.summary as string | undefined,
      additionalInsights: Array.isArray(data.additionalInsights)
        ? data.additionalInsights as string[]
        : undefined,
    };
  }
}
