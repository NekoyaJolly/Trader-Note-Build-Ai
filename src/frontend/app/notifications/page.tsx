/**
 * 通知一覧画面
 * /notifications
 *
 * 機能:
 * - 未読/既読の視覚区別
 * - スコアゲージ表示
 * - 行クリックで詳細画面遷移
 * - 一括既読/個別既読
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";
import ScoreGauge from "@/components/ScoreGauge";
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
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-6 w-full" />
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
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
            <button
              onClick={loadNotifications}
              className="px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              再読み込み
            </button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-800">通知一覧</h1>
        {notifications.length > 0 && (
          <button
            onClick={handleMarkAllAsRead}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            すべて既読にする
          </button>
        )}
      </div>

      {/* 通知がない場合 */}
      {notifications.length === 0 ? (
        <div className="text-center text-gray-500 py-12">
          通知はありません
        </div>
      ) : (
        /* 通知リスト */
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    状態
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    通知時刻
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    通貨ペア
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    時間足
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    売買
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    一致度
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    判定理由
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {notifications.map((notification) => (
                  <tr
                    key={notification.id}
                    className={`border-b hover:bg-gray-50 transition-colors ${
                      !notification.isRead ? "bg-blue-50" : ""
                    }`}
                  >
                    {/* 未読/既読状態 */}
                    <td className="px-4 py-3">
                      {!notification.isRead ? (
                        <span className="inline-block w-3 h-3 bg-blue-500 rounded-full"></span>
                      ) : (
                        <span className="inline-block w-3 h-3 bg-gray-300 rounded-full"></span>
                      )}
                    </td>

                    {/* 通知時刻 */}
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {new Date(notification.sentAt).toLocaleString("ja-JP")}
                    </td>

                    {/* 通貨ペア */}
                    <td className="px-4 py-3 text-sm font-semibold text-gray-800">
                      {notification.tradeNote.symbol}
                    </td>

                    {/* 時間足 */}
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {notification.tradeNote.timeframe}
                    </td>

                    {/* 売買方向 */}
                    <td className="px-4 py-3 text-sm">
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          notification.tradeNote.side === "BUY"
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {notification.tradeNote.side}
                      </span>
                    </td>

                    {/* スコアゲージ */}
                    <td className="px-4 py-3">
                      <div className="w-48">
                        <ScoreGauge
                          score={notification.matchResult.score}
                          size="small"
                        />
                      </div>
                    </td>

                    {/* 判定理由要約 */}
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {notification.reasonSummary}
                    </td>

                    {/* 操作ボタン */}
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {!notification.isRead && (
                          <button
                            onClick={(e) => handleMarkAsRead(notification.id, e)}
                            className="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
                          >
                            既読
                          </button>
                        )}
                        <Link
                          href={`/notifications/${notification.id}`}
                          className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                        >
                          詳細
                        </Link>
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
