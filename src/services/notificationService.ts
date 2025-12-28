import { Notification, MatchResult } from '../models/types';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

/**
 * Service for managing notifications
 * Supports both push notifications and in-app notifications
 */
export class NotificationService {
  private notifications: Notification[] = [];
  private notificationsPath: string;

  constructor() {
    this.notificationsPath = path.join(process.cwd(), 'data', 'notifications.json');
    this.loadNotifications();
  }

  /**
   * Create a notification from a match result
   */
  async notifyMatch(matchResult: MatchResult): Promise<void> {
    const notification: Notification = {
      id: uuidv4(),
      type: 'match',
      title: `Trade Opportunity: ${matchResult.symbol}`,
      message: `Current market conditions match historical trade note (${(matchResult.matchScore * 100).toFixed(1)}% match)`,
      matchResult,
      timestamp: new Date(),
      read: false,
    };

    this.notifications.push(notification);
    await this.saveNotifications();

    // Send push notification if configured
    await this.sendPushNotification(notification);

    console.log(`Notification created: ${notification.title}`);
  }

  /**
   * Create a general notification
   */
  async notify(type: 'info' | 'warning', title: string, message: string): Promise<void> {
    const notification: Notification = {
      id: uuidv4(),
      type,
      title,
      message,
      timestamp: new Date(),
      read: false,
    };

    this.notifications.push(notification);
    await this.saveNotifications();
  }

  /**
   * Get all notifications
   */
  getNotifications(unreadOnly: boolean = false): Notification[] {
    if (unreadOnly) {
      return this.notifications.filter(n => !n.read);
    }
    return this.notifications;
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string): Promise<void> {
    const notification = this.notifications.find(n => n.id === notificationId);
    if (notification) {
      notification.read = true;
      await this.saveNotifications();
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(): Promise<void> {
    this.notifications.forEach(n => n.read = true);
    await this.saveNotifications();
  }

  /**
   * Delete a notification
   */
  async deleteNotification(notificationId: string): Promise<void> {
    this.notifications = this.notifications.filter(n => n.id !== notificationId);
    await this.saveNotifications();
  }

  /**
   * Clear all notifications
   */
  async clearAll(): Promise<void> {
    this.notifications = [];
    await this.saveNotifications();
  }

  /**
   * Push 通知を送信（プレースホルダー）
   * 注意: 将来的に FCM/APNs または OneSignal と統合予定
   */
  private async sendPushNotification(notification: Notification): Promise<void> {
    // 将来の Push 通知サービス統合用スタブ
    // 本番環境ではデバッグログを抑制
    if (process.env.NODE_ENV !== 'production') {
      console.log('Push notification (simulated):', notification.title);
    }
    
    // 将来の統合例:
    // await fetch('https://push-service.example.com/send', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${config.notification.pushKey}`,
    //     'Content-Type': 'application/json'
    //   },
    //   body: JSON.stringify({
    //     title: notification.title,
    //     message: notification.message,
    //     data: notification.matchResult
    //   })
    // });
  }

  /**
   * Load notifications from storage
   */
  private loadNotifications(): void {
    if (fs.existsSync(this.notificationsPath)) {
      const content = fs.readFileSync(this.notificationsPath, 'utf-8');
      const data = JSON.parse(content);
      
      // Convert date strings back to Date objects
      this.notifications = data.map((n: any) => ({
        ...n,
        timestamp: new Date(n.timestamp),
        matchResult: n.matchResult ? {
          ...n.matchResult,
          timestamp: new Date(n.matchResult.timestamp),
          currentMarket: {
            ...n.matchResult.currentMarket,
            timestamp: new Date(n.matchResult.currentMarket.timestamp),
          },
          historicalNote: {
            ...n.matchResult.historicalNote,
            timestamp: new Date(n.matchResult.historicalNote.timestamp),
            createdAt: new Date(n.matchResult.historicalNote.createdAt),
          },
        } : undefined,
      }));
    }
  }

  /**
   * Save notifications to storage
   */
  private async saveNotifications(): Promise<void> {
    const dir = path.dirname(this.notificationsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(this.notificationsPath, JSON.stringify(this.notifications, null, 2));
  }
}
