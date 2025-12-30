export interface NotificationTriggerInput {
  matchScore: number;
  historicalNoteId: string;
  marketSnapshot: unknown;
}

export interface NotificationTriggerResult {
  shouldNotify: boolean;
  status: 'sent' | 'skipped';
  skipReason?: string;
  reasonSummary?: string;
}

const NOTIFICATION_THRESHOLD = parseFloat(process.env.NOTIFY_THRESHOLD || '0.75');

// 通知トリガロジック（ストレージ非依存）
export class NotificationTriggerService {
  evaluate(input: NotificationTriggerInput): NotificationTriggerResult {
    if (input.matchScore < NOTIFICATION_THRESHOLD) {
      return {
        shouldNotify: false,
        status: 'skipped',
        skipReason: `スコア不足: ${input.matchScore.toFixed(3)} < ${NOTIFICATION_THRESHOLD}`,
        reasonSummary: `スコア: ${input.matchScore.toFixed(3)}`,
      };
    }

    return {
      shouldNotify: true,
      status: 'sent',
      reasonSummary: `スコア: ${input.matchScore.toFixed(3)}`,
    };
  }

  // 互換用: 旧シグネチャを利用するコードから呼ばれても、判定のみ実行する
  async evaluateAndNotify(matchResult: any): Promise<NotificationTriggerResult> {
    return this.evaluate({
      matchScore: matchResult?.score ?? matchResult?.matchScore ?? 0,
      historicalNoteId: matchResult?.noteId ?? matchResult?.historicalNoteId ?? '',
      marketSnapshot: matchResult?.marketSnapshot ?? matchResult?.currentMarket ?? {},
    });
  }
}
