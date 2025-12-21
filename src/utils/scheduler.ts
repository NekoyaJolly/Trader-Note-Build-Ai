import { MatchingService } from '../services/matchingService';
import { NotificationService } from '../services/notificationService';
import { config } from '../config';

/**
 * Scheduler for periodic market matching checks
 */
export class MatchingScheduler {
  private matchingService: MatchingService;
  private notificationService: NotificationService;
  private intervalId?: NodeJS.Timeout;
  private isRunning: boolean = false;

  constructor() {
    this.matchingService = new MatchingService();
    this.notificationService = new NotificationService();
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) {
      console.log('Matching scheduler is already running');
      return;
    }

    const intervalMs = config.matching.checkIntervalMinutes * 60 * 1000;
    
    console.log(`Starting matching scheduler (interval: ${config.matching.checkIntervalMinutes} minutes)`);
    
    // Run immediately on start
    this.runMatchCheck();

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.runMatchCheck();
    }, intervalMs);

    this.isRunning = true;
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      this.isRunning = false;
      console.log('Matching scheduler stopped');
    }
  }

  /**
   * Run a single match check
   */
  private async runMatchCheck(): Promise<void> {
    try {
      console.log('Running scheduled match check...');
      const matches = await this.matchingService.checkForMatches();

      if (matches.length > 0) {
        console.log(`Found ${matches.length} matches`);
        
        // Send notifications for each match
        for (const match of matches) {
          await this.notificationService.notifyMatch(match);
        }
      } else {
        console.log('No matches found');
      }
    } catch (error) {
      console.error('Error in scheduled match check:', error);
    }
  }

  /**
   * Check if scheduler is running
   */
  isSchedulerRunning(): boolean {
    return this.isRunning;
  }
}
