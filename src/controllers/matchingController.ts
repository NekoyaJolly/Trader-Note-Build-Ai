import { Request, Response } from 'express';
import { MatchingService } from '../services/matchingService';
import { NotificationService } from '../services/notificationService';
import { TradeNoteService } from '../services/tradeNoteService';

/**
 * マッチングコントローラー
 * 市場条件と過去トレードノートの一致判定を行う
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
              matchScore: m.matchScore,
              timestamp: m.evaluatedAt,
              note: note
                ? {
                    id: note.id,
                    symbol: note.symbol,
                  }
                : null,
              marketSnapshot: m.marketSnapshot,
            };
          })
        ),
      });
    } catch (error) {
      console.error('Error checking matches:', error);
      // 本番環境では内部エラーの詳細を隠蔽
      res.status(500).json({ error: '一致判定処理に失敗しました' });
    }
  };

  /**
   * マッチ履歴を取得
   */
  getMatchHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      // マッチタイプの通知を取得
      const notifications = await this.notificationService.getNotifications();
      const matchNotifications = notifications.filter(n => n.type === 'match');

      res.json({
        matches: matchNotifications.map(n => n.matchResult)
      });
    } catch (error) {
      console.error('Error getting match history:', error);
      // 本番環境では内部エラーの詳細を隠蔽
      res.status(500).json({ error: 'マッチ履歴の取得に失敗しました' });
    }
  };
}
