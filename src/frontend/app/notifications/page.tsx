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
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Progress } from "@/components/ui/Progress";
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
            <Button onClick={loadNotifications} size="sm" variant="default">
              再読み込み
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-slate-900 drop-shadow-sm dark:text-slate-100">通知一覧</h1>
          {notifications.length > 0 && (
            <Button onClick={handleMarkAllAsRead} variant="default">
              すべて既読にする
            </Button>
          )}
      </div>

      {/* 通知がない場合 */}
        {notifications.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <span className="text-2xl">🔔</span>
                通知はありません
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">現在、表示できる通知がありません。市場一致判定に基づく通知が生成されると、ここに一覧表示されます。</p>
            </CardContent>
          </Card>
        ) : (
          /* 通知リスト */
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <table className="min-w-full">
              <thead className="bg-gray-50 dark:bg-gray-800/40 border-b">
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
                          <Badge variant="secondary">未読</Badge>
                        ) : (
                          <Badge variant="outline">既読</Badge>
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
                        <Badge variant={notification.tradeNote.side === "BUY" ? "secondary" : "destructive"}>
                          {notification.tradeNote.side}
                        </Badge>
                      </td>

                    {/* スコアゲージ */}
                    <td className="px-4 py-3">
                      <div className="w-56 flex flex-col gap-2">
                        {/* 日本語コメント: 直感性のためゲージとバーの二軸表示 */}
                        <ScoreGauge
                          score={notification.matchResult.score}
                          size="small"
                        />
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <Progress value={Math.round(notification.matchResult.score * 100)} />
                          </div>
                          <span className="text-xs text-gray-600 w-10 text-right">
                            {Math.round(notification.matchResult.score * 100)}%
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* 判定理由要約 */}
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {notification.reasonSummary}
                    </td>

                    {/* 操作ボタン */}
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-stretch justify-center gap-2 flex-col sm:flex-row">
                        {!notification.isRead && (
                          <Button
                            onClick={(e) => handleMarkAsRead(notification.id, e)}
                            size="sm"
                            variant="secondary"
                            className="sm:w-auto w-full"
                          >
                            既読
                          </Button>
                        )}
                        <Button size="sm" asChild className="sm:w-auto w-full">
                          <Link href={`/notifications/${notification.id}`}>詳細</Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
