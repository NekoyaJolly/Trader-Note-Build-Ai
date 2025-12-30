/**
 * 通知詳細画面
 * /notifications/:id
 *
 * 機能:
 * - 通知サマリー表示
 * - 判定理由の詳細表示
 * - MarketSnapshot 表示
 * - Order Preset リンク（遷移のみ）
 */

"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ScoreGauge from "@/components/ScoreGauge";
import MatchReasonVisualizer from "@/components/MatchReasonVisualizer";
import MarketSnapshotView from "@/components/MarketSnapshotView";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { NotificationDetail } from "@/types/notification";
import { fetchNotificationDetail, markNotificationAsRead } from "@/lib/api";

/**
 * 通知詳細画面コンポーネント
 */
export default function NotificationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  // 通知詳細データ
  const [notification, setNotification] = useState<NotificationDetail | null>(
    null
  );
  // ローディング状態
  const [isLoading, setIsLoading] = useState(true);
  // エラー状態
  const [error, setError] = useState<string | null>(null);

  /**
   * 通知詳細データを取得
   */
  useEffect(() => {
    if (!id) return;

    loadNotificationDetail();
  }, [id]);

  /**
   * 通知詳細をAPIから取得
   */
  async function loadNotificationDetail() {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchNotificationDetail(id);
      setNotification(data);

      // 未読の場合は自動的に既読にする
      if (!data.isRead) {
        await markNotificationAsRead(id);
        setNotification((prev) => (prev ? { ...prev, isRead: true } : null));
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "通知詳細の取得に失敗しました"
      );
    } finally {
      setIsLoading(false);
    }
  }

  // ローディング表示（Skeleton で統一）
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  // エラー表示（Alert で統一）
  if (error || !notification) {
    return (
      <Alert variant="destructive">
        <AlertTitle>通知の取得に失敗しました</AlertTitle>
        <AlertDescription>
          {error || "通知が見つかりません"}
          <div className="mt-3">
            <Button onClick={loadNotificationDetail} size="sm" variant="default">
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
        <h1 className="text-3xl font-bold text-white">通知詳細</h1>
        <Link
          href="/notifications"
          className="px-3 py-2 rounded-lg text-sm font-medium text-gray-300 hover:bg-slate-700/50 hover:text-white transition-all duration-300"
        >
          ← 一覧に戻る
        </Link>
      </div>

      {/* 通知サマリー（Card 構造へ統一） */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>通知サマリー</CardTitle>
        </CardHeader>
        <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 左カラム */}
          <div className="space-y-4">
            <div>
              <div className="text-sm text-gray-400 mb-1">通貨ペア</div>
              <div className="text-lg font-bold text-white">
                {notification.tradeNote.symbol}
              </div>
            </div>

            <div>
              <div className="text-sm text-gray-400 mb-1">売買方向</div>
              <Badge variant={notification.tradeNote.side === "BUY" ? "secondary" : "destructive"}>
                {notification.tradeNote.side}
              </Badge>
            </div>

            <div>
              <div className="text-sm text-gray-400 mb-1">時間足</div>
              <div className="text-base font-semibold text-gray-200">
                {notification.tradeNote.timeframe}
              </div>
            </div>
          </div>

          {/* 右カラム */}
          <div className="space-y-4">
            <div>
              <div className="text-sm text-gray-400 mb-1">判定時刻</div>
              <div className="text-base text-gray-300">
                {new Date(notification.matchResult.evaluatedAt).toLocaleString(
                  "ja-JP"
                )}
              </div>
            </div>

            <div>
              <div className="text-sm text-gray-400 mb-1">通知送信時刻</div>
              <div className="text-base text-gray-300">
                {new Date(notification.sentAt).toLocaleString("ja-JP")}
              </div>
            </div>

            <div>
              <div className="text-sm text-gray-400 mb-2">一致度スコア</div>
              <ScoreGauge score={notification.matchResult.score} size="large" />
            </div>
          </div>
        </div>
        </CardContent>
      </Card>

      {/* 判定理由（Card 構造へ統一） */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>判定理由</CardTitle>
        </CardHeader>
        <CardContent>
          <MatchReasonVisualizer reasons={notification.matchResult.reasons} />
        </CardContent>
      </Card>

      {/* MarketSnapshot 表示（Card 構造で他画面と統一） */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>市場スナップショット</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* 15分足 */}
            <MarketSnapshotView snapshot={notification.marketSnapshot15m} />

            {/* 60分足 */}
            <MarketSnapshotView snapshot={notification.marketSnapshot60m} />
          </div>
        </CardContent>
      </Card>

      {/* Order Preset 連携（Card 構造へ統一） */}
      <Card>
        <CardHeader>
          <CardTitle>発注支援（参照のみ）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-4">
            <p className="text-sm text-yellow-400">
              ⚠️ このリンクは参照用です。実際の発注はブローカーの画面で確認・実行してください。
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Button asChild>
              <Link
                href={`/orders/preset?noteId=${notification.tradeNote.id}`}
                target="_blank"
              >
                発注画面を開く（新しいタブ）
              </Link>
            </Button>
            <span className="text-sm text-gray-400">※ 自動実行は行いません</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
