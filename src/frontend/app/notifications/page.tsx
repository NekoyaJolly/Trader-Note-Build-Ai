/**
 * 通知一覧画面（Neon Dark テーマ対応）
 * /notifications
 *
 * 機能:
 * - 未読/既読の視覚区別
 * - スコアゲージ表示
 * - 行クリックで詳細画面遷移
 * - 一括既読/個別既読
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";
import ScoreGauge from "@/components/ScoreGauge";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import EmptyState from "@/components/EmptyState";
import type { NotificationListItem } from "@/types/notification";
import {
  fetchNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from "@/lib/api";

/**
 * 通知一覧画面コンポーネント
 */
export default function NotificationsPage() {
  // 通知データ
  const [notifications, setNotifications] = useState<NotificationListItem[]>(
    []
  );
  // ローディング状態
  const [isLoading, setIsLoading] = useState(true);
  // エラー状態
  const [error, setError] = useState<string | null>(null);

  /**
   * 通知データを取得
   */
  useEffect(() => {
    loadNotifications();
  }, []);

  /**
   * 通知一覧をAPIから取得
   */
  async function loadNotifications() {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchNotifications();
      setNotifications(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "通知の取得に失敗しました"
      );
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * 個別通知を既読にする
   */
  async function handleMarkAsRead(id: string, event: React.MouseEvent) {
    event.preventDefault(); // Link遷移を一時停止
    event.stopPropagation();

    try {
      await markNotificationAsRead(id);
      // ローカル状態を更新
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "既読化に失敗しました"
      );
    }
  }

  /**
   * すべての通知を既読にする
   */
  async function handleMarkAllAsRead() {
    try {
      await markAllNotificationsAsRead();
      // ローカル状態を更新
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "一括既読化に失敗しました"
      );
    }
  }

  // ローディング表示
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64 bg-slate-700" />
        <Skeleton className="h-6 w-full bg-slate-700" />
        <div className="space-y-2">
          <Skeleton className="h-16 w-full bg-slate-700" />
          <Skeleton className="h-16 w-full bg-slate-700" />
          <Skeleton className="h-16 w-full bg-slate-700" />
        </div>
      </div>
    );
  }

  // エラー表示
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>通知の取得に失敗しました</AlertTitle>
        <AlertDescription>
          {error}
          <div className="mt-3">
            <Button onClick={loadNotifications} size="sm" variant="default">
              再読み込み
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* ヘッダー */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
        <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-white">🔔 通知一覧</h1>
        {notifications.length > 0 && (
          <Button onClick={handleMarkAllAsRead} variant="secondary" size="sm" className="w-fit">
            すべて既読
          </Button>
        )}
      </div>

      {/* 通知がない場合 */}
      {notifications.length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-16 h-16 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          }
          title="通知はありません"
          description="市場一致判定に基づく通知が生成されると、ここに一覧表示されます。"
        />
      ) : (
        /* 通知リスト */
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-slate-700/50 border-b border-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">
                    状態
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">
                    通知時刻
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">
                    通貨ペア
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">
                    時間足
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">
                    売買
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">
                    一致度
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">
                    判定理由
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-300">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {notifications.map((notification) => (
                  <tr
                    key={notification.id}
                    className={`border-b border-slate-700 hover:bg-slate-700/30 transition-colors ${
                      !notification.isRead ? "bg-blue-900/20" : ""
                    }`}
                  >
                    {/* 未読/既読状態 */}
                    <td className="px-4 py-3">
                      {!notification.isRead ? (
                        <Badge variant="secondary" className="bg-blue-500/20 text-blue-400">未読</Badge>
                      ) : (
                        <Badge variant="outline" className="border-gray-600 text-gray-400">既読</Badge>
                      )}
                    </td>

                    {/* 通知時刻 */}
                    <td className="px-4 py-3 text-sm text-gray-300">
                      {new Date(notification.sentAt).toLocaleString("ja-JP")}
                    </td>

                    {/* 通貨ペア */}
                    <td className="px-4 py-3 text-sm font-semibold text-white">
                      {notification.tradeNote.symbol}
                    </td>

                    {/* 時間足 */}
                    <td className="px-4 py-3 text-sm text-gray-300">
                      {notification.tradeNote.timeframe}
                    </td>

                    {/* 売買方向 */}
                    <td className="px-4 py-3 text-sm">
                      <Badge 
                        variant={notification.tradeNote.side === "BUY" ? "secondary" : "destructive"}
                        className={notification.tradeNote.side === "BUY" 
                          ? "bg-green-500/20 text-green-400" 
                          : "bg-red-500/20 text-red-400"
                        }
                      >
                        {notification.tradeNote.side}
                      </Badge>
                    </td>

                    {/* スコアゲージ */}
                    <td className="px-4 py-3">
                      <ScoreGauge
                        score={notification.matchResult.score}
                        size="small"
                      />
                    </td>

                    {/* 判定理由要約 */}
                    <td className="px-4 py-3 text-sm text-gray-400 max-w-xs truncate">
                      {notification.reasonSummary}
                    </td>

                    {/* 操作ボタン */}
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {!notification.isRead && (
                          <Button
                            onClick={(e) => handleMarkAsRead(notification.id, e)}
                            size="sm"
                            variant="ghost"
                            className="text-gray-400 hover:text-white"
                          >
                            既読
                          </Button>
                        )}
                        <Button size="sm" asChild className="bg-gradient-to-r from-pink-500 to-violet-500 hover:opacity-90">
                          <Link href={`/notifications/${notification.id}`}>詳細</Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
