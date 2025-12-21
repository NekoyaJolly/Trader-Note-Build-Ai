import { Request, Response } from 'express';
import { MatchingService } from '../services/matchingService';
import { NotificationService } from '../services/notificationService';

export class MatchingController {
  private matchingService: MatchingService;
  private notificationService: NotificationService;

  constructor() {
    this.matchingService = new MatchingService();
    this.notificationService = new NotificationService();
  }

  /**
   * Manually trigger a match check
   */
  checkMatches = async (req: Request, res: Response): Promise<void> => {
    try {
      const matches = await this.matchingService.checkForMatches();

      // Send notifications for matches
      for (const match of matches) {
        await this.notificationService.notifyMatch(match);
      }

      res.json({
        success: true,
        matchesFound: matches.length,
        matches: matches.map(m => ({
          noteId: m.noteId,
          symbol: m.symbol,
          matchScore: m.matchScore,
          timestamp: m.timestamp
        }))
      });
    } catch (error) {
      console.error('Error checking matches:', error);
      res.status(500).json({ error: 'Failed to check matches' });
    }
  };

  /**
   * Get match history
   */
  getMatchHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      // Get notifications of type 'match'
      const notifications = this.notificationService.getNotifications();
      const matchNotifications = notifications.filter(n => n.type === 'match');

      res.json({
        matches: matchNotifications.map(n => n.matchResult)
      });
    } catch (error) {
      console.error('Error getting match history:', error);
      res.status(500).json({ error: 'Failed to retrieve match history' });
    }
  };
}
