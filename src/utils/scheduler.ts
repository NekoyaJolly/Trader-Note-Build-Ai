import { MatchingService } from '../services/matchingService';
import { NotificationService } from '../services/notificationService';
import { config } from '../config';

/**
 * マッチングスケジューラー
 * 定期的に市場マッチングチェックを実行する
 */
export class MatchingScheduler {
  private matchingService: MatchingService;
  private notificationService: NotificationService;
  private intervalId?: NodeJS.Timeout;
  private isRunning: boolean = false;
  // 本番環境かどうか（ログ出力制御用）
  private readonly isProduction: boolean;

  constructor() {
    this.matchingService = new MatchingService();
    this.notificationService = new NotificationService();
    this.isProduction = process.env.NODE_ENV === 'production';
  }

  /**
   * スケジューラーを開始
   */
  start(): void {
    if (this.isRunning) {
      // 本番環境ではデバッグログを抑制
      if (!this.isProduction) {
        console.log('マッチングスケジューラーは既に実行中です');
      }
      return;
    }

    const intervalMs = config.matching.checkIntervalMinutes * 60 * 1000;
    
    // 本番環境ではデバッグログを抑制
    if (!this.isProduction) {
      console.log(`マッチングスケジューラーを開始します（間隔: ${config.matching.checkIntervalMinutes} 分）`);
    }
    
    // 開始時に即時実行
    this.runMatchCheck();

    // 定期的に実行
    this.intervalId = setInterval(() => {
      this.runMatchCheck();
    }, intervalMs);

    this.isRunning = true;
  }

  /**
   * スケジューラーを停止
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      this.isRunning = false;
      // 本番環境ではデバッグログを抑制
      if (!this.isProduction) {
        console.log('マッチングスケジューラーを停止しました');
      }
    }
  }

  /**
   * マッチチェックを単発実行
   */
  private async runMatchCheck(): Promise<void> {
    try {
      // 本番環境ではデバッグログを抑制
      if (!this.isProduction) {
        console.log('スケジュールされたマッチチェックを実行中...');
      }
      const matches = await this.matchingService.checkForMatches();

      if (matches.length > 0) {
        // マッチが見つかった場合はログ出力（本番でも重要な情報）
        if (!this.isProduction) {
          console.log(`${matches.length} 件のマッチを検出`);
        }
        
        // 各マッチに対して通知を送信
        for (const match of matches) {
          await this.notificationService.notifyMatch(match);
        }
      } else {
        // 本番環境ではマッチなしログを抑制（スパム防止）
        if (!this.isProduction) {
          console.log('マッチは見つかりませんでした');
        }
      }
    } catch (error) {
      // エラーログは本番でも出力（重要な情報）
      console.error('スケジュールされたマッチチェックでエラーが発生:', error);
    }
  }

  /**
   * スケジューラーが実行中かどうかを確認
   */
  isSchedulerRunning(): boolean {
    return this.isRunning;
  }
}
