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
import type { JsonValue } from '../utils/jsonValue';

// ============================================================================
// 型定義
// ============================================================================

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
          entryAnalysis: this.toJsonRecord(note.entryAnalysis),
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
  private parseMarketAnalysis(raw: JsonValue): SideBMarketAnalysis | null {
    if (!raw || typeof raw !== 'object') return null;

    const data = raw as Record<string, JsonValue | undefined>;

    // 必須フィールドチェック
    if (!data.regime || !data.trendDirection) return null;

    return {
      regime: this.asString(data.regime, 'range'),
      volatility: this.asString(data.volatility, 'medium'),
      trendDirection: this.asString(data.trendDirection, 'sideways'),
      regimeConfidence: Number(data.regimeConfidence || 50),
      keyLevels: {
        support: this.getNumberArray(data.keyLevels, 'support'),
        resistance: this.getNumberArray(data.keyLevels, 'resistance'),
        strongSupport: this.getNumberArray(data.keyLevels, 'strongSupport'),
        strongResistance: this.getNumberArray(data.keyLevels, 'strongResistance'),
      },
      summary: data.summary as string | undefined,
      additionalInsights: Array.isArray(data.additionalInsights)
        ? data.additionalInsights as string[]
        : undefined,
    };
  }

  private asString(value: JsonValue | undefined, fallback: string): string {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : fallback;
  }

  private getNumberArray(source: JsonValue | undefined, key: string): number[] {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
    const value = source[key];
    return Array.isArray(value)
      ? value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      : [];
  }

  private toJsonRecord(value: JsonValue): Record<string, JsonValue | undefined> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
  }
}
