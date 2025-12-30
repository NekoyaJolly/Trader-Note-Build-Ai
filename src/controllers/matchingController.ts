import { Request, Response } from 'express';
import { MatchingService } from '../services/matchingService';
import { NotificationService } from '../services/notificationService';
import { TradeNoteService } from '../services/tradeNoteService';

/**
 * マッチングコントローラー
 * 
 * 責務:
 * - 市場条件と過去トレードノートの一致判定 API
 * - マッチ履歴の取得 API（DB から）
 */
export class MatchingController {
  private matchingService: MatchingService;
  private notificationService: NotificationService;
  private noteService: TradeNoteService;

  constructor() {
    this.matchingService = new MatchingService();
    this.notificationService = new NotificationService();
    this.noteService = new TradeNoteService();
  }

  /**
   * 手動でマッチチェックをトリガー
   * POST /api/matching/check
   */
  checkMatches = async (req: Request, res: Response): Promise<void> => {
    try {
      const matches = await this.matchingService.checkForMatches();
      await this.notificationService.trigger(matches);

      res.json({
        success: true,
        matchesFound: matches.length,
        matches: await Promise.all(
          matches.map(async (m) => {
            const note = await this.noteService.getNoteById(m.historicalNoteId);
            return {
              id: m.id,
              matchScore: m.matchScore,
              timestamp: m.evaluatedAt,
              symbol: m.symbol,
              threshold: m.threshold,
              trendMatched: m.trendMatched,
              priceRangeMatched: m.priceRangeMatched,
              reasons: m.reasons,
              note: note
                ? {
                    id: note.id,
                    symbol: note.symbol,
                    side: note.side,
                    entryPrice: note.entryPrice,
                  }
                : null,
              marketSnapshot: m.marketSnapshot,
            };
          })
        ),
      });
    } catch (error) {
      console.error('マッチチェックエラー:', error);
      // 本番環境では内部エラーの詳細を隠蔽
      res.status(500).json({ error: '一致判定処理に失敗しました' });
    }
  };

  /**
   * マッチ履歴を取得（DB から）
   * GET /api/matching/history
   * 
   * クエリパラメータ:
   * - symbol?: string - シンボルでフィルタ
   * - limit?: number - 取得件数（デフォルト: 50）
   * - offset?: number - オフセット（ページング用）
   * - minScore?: number - 最小スコアでフィルタ
   */
  getMatchHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const { symbol, limit, offset, minScore } = req.query;

      const matches = await this.matchingService.getMatchHistory({
        symbol: symbol as string | undefined,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
        minScore: minScore ? parseFloat(minScore as string) : undefined,
      });

      res.json({
        success: true,
        count: matches.length,
        matches: matches.map(m => ({
          id: m.id,
          noteId: m.historicalNoteId,
          symbol: m.symbol,
          matchScore: m.matchScore,
          threshold: m.threshold,
          trendMatched: m.trendMatched,
          priceRangeMatched: m.priceRangeMatched,
          reasons: m.reasons,
          evaluatedAt: m.evaluatedAt,
          createdAt: m.createdAt,
          marketSnapshotId: m.marketSnapshotId,
        })),
      });
    } catch (error) {
      console.error('マッチ履歴取得エラー:', error);
      // 本番環境では内部エラーの詳細を隠蔽
      res.status(500).json({ error: 'マッチ履歴の取得に失敗しました' });
    }
  };
}
