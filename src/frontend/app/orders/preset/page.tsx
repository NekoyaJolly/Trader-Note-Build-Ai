/**
 * 発注支援画面（参照専用）
 * /orders/preset?noteId=...
 *
 * 機能:
 * - noteId から注文プリセット情報を取得して表示
 * - 注文確認情報の表示
 * - 警告: 自動売買は行わない（参照のみ）
 *
 * 注意: 本システムは自動売買を行いません。
 * すべての注文は取引所の画面で確認・実行してください。
 */

"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  fetchOrderPreset,
  fetchOrderConfirmation,
  type OrderPreset,
  type OrderConfirmation,
} from "@/lib/api";

/**
 * メインページコンポーネント（Suspense でラップして export）
 */
export default function OrderPresetPage() {
  return (
    <Suspense fallback={<OrderPresetLoadingFallback />}>
      <OrderPresetContent />
    </Suspense>
  );
}

/**
 * ローディングフォールバック
 */
function OrderPresetLoadingFallback() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}

/**
 * 発注支援画面コンテンツ（実際のロジック）
 */
function OrderPresetContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // noteId はクエリパラメータから取得
  const noteId = searchParams.get("noteId");

  // 状態管理
  const [preset, setPreset] = useState<OrderPreset | null>(null);
  const [confirmation, setConfirmation] = useState<OrderConfirmation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * noteId から注文プリセットを取得
   */
  useEffect(() => {
    if (!noteId) {
      setError("noteId が指定されていません");
      setIsLoading(false);
      return;
    }

    loadOrderPreset();
  }, [noteId]);

  /**
   * 注文プリセットを API から取得
   */
  async function loadOrderPreset() {
    if (!noteId) return;

    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchOrderPreset(noteId);
      setPreset(data.preset);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "注文プリセットの取得に失敗しました"
      );
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * 注文確認情報を取得
   */
  async function handleGetConfirmation() {
    if (!preset) return;

    try {
      setIsConfirming(true);
      const data = await fetchOrderConfirmation({
        symbol: preset.symbol,
        side: preset.side.toLowerCase(),
        price: preset.suggestedPrice,
        quantity: preset.suggestedQuantity,
      });
      setConfirmation(data.confirmation);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "注文確認情報の取得に失敗しました"
      );
    } finally {
      setIsConfirming(false);
    }
  }

  // ローディング表示
  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  // エラー表示
  if (error || !preset) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Alert variant="destructive">
          <AlertTitle>エラー</AlertTitle>
          <AlertDescription>
            {error || "注文プリセットが見つかりません"}
            <div className="mt-3 flex gap-2">
              <Button onClick={loadOrderPreset} size="sm" variant="default">
                再読み込み
              </Button>
              <Button onClick={() => router.back()} size="sm" variant="outline">
                戻る
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // side を正規化（大文字小文字統一）
  const normalizedSide = preset.side.toUpperCase() as "BUY" | "SELL";

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-white">発注支援（参照専用）</h1>
        <Button variant="outline" onClick={() => router.back()}>
          ← 戻る
        </Button>
      </div>

      {/* 重要な警告 */}
      <Alert className="mb-6 bg-yellow-500/10 border-yellow-500/30">
        <AlertTitle className="text-yellow-400">⚠️ 重要な注意事項</AlertTitle>
        <AlertDescription className="text-yellow-300">
          <p className="mt-2">
            本システムは<strong>自動売買を行いません</strong>。
            以下の情報は<strong>参考値</strong>です。
          </p>
          <p className="mt-1">
            実際の注文は必ず<strong>取引所の画面</strong>で確認・実行してください。
          </p>
        </AlertDescription>
      </Alert>

      {/* プリセット情報 */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>注文プリセット</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 左カラム */}
            <div className="space-y-4">
              <div>
                <div className="text-sm text-gray-400 mb-1">通貨ペア</div>
                <div className="text-lg font-bold text-white">{preset.symbol}</div>
              </div>

              <div>
                <div className="text-sm text-gray-400 mb-1">売買方向</div>
                <Badge
                  variant={normalizedSide === "BUY" ? "secondary" : "destructive"}
                >
                  {normalizedSide}
                </Badge>
              </div>

              <div>
                <div className="text-sm text-gray-400 mb-1">参照ノートID</div>
                <Link
                  href={`/notes/${preset.basedOnNoteId}`}
                  className="text-blue-400 hover:underline text-sm"
                >
                  {preset.basedOnNoteId}
                </Link>
              </div>
            </div>

            {/* 右カラム */}
            <div className="space-y-4">
              <div>
                <div className="text-sm text-gray-400 mb-1">参考価格</div>
                <div className="text-lg font-semibold text-white">
                  {preset.suggestedPrice.toLocaleString()}
                </div>
              </div>

              <div>
                <div className="text-sm text-gray-400 mb-1">参考数量</div>
                <div className="text-lg font-semibold text-white">
                  {preset.suggestedQuantity}
                </div>
              </div>

              <div>
                <div className="text-sm text-gray-400 mb-1">信頼度</div>
                <div className="text-base text-gray-300">
                  {(preset.confidence * 100).toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 注文確認セクション */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>注文確認（参考情報）</CardTitle>
        </CardHeader>
        <CardContent>
          {!confirmation ? (
            <div className="text-center py-4">
              <p className="text-gray-400 mb-4">
                上記のプリセット情報を元に、概算コストを確認できます。
              </p>
              <Button
                onClick={handleGetConfirmation}
                disabled={isConfirming}
              >
                {isConfirming ? "計算中..." : "概算を確認"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-gray-400">概算コスト</div>
                  <div className="text-white font-semibold">
                    {confirmation.estimatedCost.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400">概算手数料（0.1%）</div>
                  <div className="text-white font-semibold">
                    {confirmation.estimatedFee.toLocaleString()}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-gray-400">合計（参考）</div>
                  <div className="text-xl text-white font-bold">
                    {confirmation.total.toLocaleString()}
                  </div>
                </div>
              </div>

              <Alert className="bg-red-500/10 border-red-500/30 mt-4">
                <AlertDescription className="text-red-300">
                  {confirmation.warning}
                </AlertDescription>
              </Alert>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ナビゲーション */}
      <div className="flex gap-4">
        <Button variant="outline" asChild>
          <Link href="/notifications">通知一覧へ</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/notes">ノート一覧へ</Link>
        </Button>
      </div>
    </div>
  );
}
