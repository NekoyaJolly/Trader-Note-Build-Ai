/**
 * NotificationSender インターフェース
 * 
 * 目的: 通知配信の抽象化（In-App / Push / Webhook など複数の配信方式に対応）
 * 設計: 各配信方式ごとに実装クラスを用意し、ファクトリーで選択可能にする
 */

export interface NotificationPayload {
  // ノート ID
  noteId: string;
  // マーケットスナップショット ID
  marketSnapshotId: string;
  // シンボル
  symbol: string;
  // 一致スコア（0.0〜1.0）
  score: number;
  // タイトル
  title: string;
  // メッセージ本体
  message: string;
  // 理由の要約
  reasonSummary: string;
}

/**
 * NotificationSender: 通知配信の抽象インターフェース
 */
export interface NotificationSender {
  /**
   * In-App 通知を送信
   * （例：データベースに通知レコードを保存）
   */
  sendInApp(payload: NotificationPayload): Promise<{ success: boolean; id?: string }>;

  /**
   * Push 通知を送信
   * （例：FCM / APNs へのリクエスト）
   */
  sendPush(payload: NotificationPayload): Promise<{ success: boolean; id?: string }>;

  /**
   * Webhook を通じた外部システムへの通知
   * （例：Slack / Teams / カスタムエンドポイント）
   */
  sendWebhook(payload: NotificationPayload): Promise<{ success: boolean; id?: string }>;
}
