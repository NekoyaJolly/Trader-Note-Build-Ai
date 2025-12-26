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

  // ローディング表示
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600">読み込み中...</div>
      </div>
    );
  }

  // エラー表示
  if (error || !notification) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">
          エラー: {error || "通知が見つかりません"}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-800">通知詳細</h1>
        <Link
          href="/notifications"
          className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
        >
          一覧に戻る
        </Link>
      </div>

      {/* 通知サマリー */}
      <section className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">
          通知サマリー
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 左カラム */}
          <div className="space-y-4">
            <div>
              <div className="text-sm text-gray-500 mb-1">通貨ペア</div>
              <div className="text-lg font-bold text-gray-800">
                {notification.tradeNote.symbol}
              </div>
            </div>

            <div>
              <div className="text-sm text-gray-500 mb-1">売買方向</div>
              <span
                className={`inline-block px-3 py-1 rounded font-semibold ${
                  notification.tradeNote.side === "BUY"
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {notification.tradeNote.side}
              </span>
            </div>

            <div>
              <div className="text-sm text-gray-500 mb-1">時間足</div>
              <div className="text-base font-semibold text-gray-800">
                {notification.tradeNote.timeframe}
              </div>
            </div>
          </div>

          {/* 右カラム */}
          <div className="space-y-4">
            <div>
              <div className="text-sm text-gray-500 mb-1">判定時刻</div>
              <div className="text-base text-gray-700">
                {new Date(notification.matchResult.evaluatedAt).toLocaleString(
                  "ja-JP"
                )}
              </div>
            </div>

            <div>
              <div className="text-sm text-gray-500 mb-1">通知送信時刻</div>
              <div className="text-base text-gray-700">
                {new Date(notification.sentAt).toLocaleString("ja-JP")}
              </div>
            </div>

            <div>
              <div className="text-sm text-gray-500 mb-2">一致度スコア</div>
              <ScoreGauge score={notification.matchResult.score} size="large" />
            </div>
          </div>
        </div>
      </section>

      {/* 判定理由（メイン） */}
      <section className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">判定理由</h2>
        <MatchReasonVisualizer reasons={notification.matchResult.reasons} />
      </section>

      {/* MarketSnapshot 表示 */}
      <section className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">
          市場スナップショット
        </h2>

        <div className="space-y-4">
          {/* 15分足 */}
          <MarketSnapshotView snapshot={notification.marketSnapshot15m} />

          {/* 60分足 */}
          <MarketSnapshotView snapshot={notification.marketSnapshot60m} />
        </div>
      </section>

      {/* Order Preset 連携 */}
      <section className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">
          発注支援（参照のみ）
        </h2>

        <div className="bg-yellow-50 border border-yellow-200 rounded p-4 mb-4">
          <p className="text-sm text-yellow-800">
            ⚠️
            このリンクは参照用です。実際の発注はブローカーの画面で確認・実行してください。
          </p>
        </div>

        <div className="flex items-center gap-4">
          <Link
            href={`/orders/preset?symbol=${notification.tradeNote.symbol}&side=${notification.tradeNote.side}`}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            target="_blank"
          >
            発注画面を開く（新しいタブ）
          </Link>

          <span className="text-sm text-gray-500">
            ※ 自動実行は行いません
          </span>
        </div>
      </section>
    </div>
  );
}
