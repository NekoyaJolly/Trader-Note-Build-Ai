/**
 * 類似トレード検索画面
 * /notes/:id/similar
 *
 * 機能:
 * - 指定ノートに類似したトレードノートを一覧表示
 * - 12次元特徴量ベクトル + コサイン類似度で検索
 * - 類似度スコアでソート
 * - FeatureVectorViz による可視化
 */
"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/Alert";
import SimilarNoteCard, { SimilarNote } from "@/components/SimilarNoteCard";
import FeatureVectorViz, { FeatureDataPoint } from "@/components/FeatureVectorViz";
import EmptyState from "@/components/EmptyState";
import { SIMILARITY_THRESHOLDS } from "@/lib/api";

// バックエンド API のベース URL
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3100";

// APIレスポンス型
interface SimilarNotesApiResponse {
  success: boolean;
  data?: {
    baseNoteId: string;
    similarNotes: Array<{
      noteId: string;
      symbol: string;
      side: string;
      timestamp: string;
      similarity: number;
      summarySnippet: string;
      result: string;
    }>;
    threshold: number;
    limit: number;
  };
  error?: string;
}

// コンポーネント用データ型
interface SimilarNotesData {
  baseNote: {
    id: string;
    symbol: string;
    side: string;
    timestamp: string;
  };
  similarNotes: SimilarNote[];
  featureVector: FeatureDataPoint[];
}

/**
 * 類似ノートページコンポーネント
 */
export default function SimilarNotesPage() {
  const params = useParams();
  const noteId = params.id as string;

  const [data, setData] = useState<SimilarNotesData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * 類似ノートデータをバックエンドAPIから取得
   */
  const loadSimilarNotes = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // 類似ノート検索API呼び出し
      const response = await fetch(
        `${API_BASE_URL}/api/trades/notes/${noteId}/similar`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            threshold: SIMILARITY_THRESHOLDS.WEAK, // 0.70
            limit: 20,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result: SimilarNotesApiResponse = await response.json();

      if (!result.success || !result.data) {
        throw new Error(result.error || "類似ノートの取得に失敗しました");
      }

      // 基準ノート情報を取得（最初の類似ノートから推測、または別APIから取得）
      // TODO: 基準ノートの詳細情報を別途取得する
      const baseNoteInfo = result.data.similarNotes[0]
        ? {
            id: noteId,
            symbol: result.data.similarNotes[0].symbol,
            side: result.data.similarNotes[0].side,
            timestamp: new Date().toISOString(),
          }
        : {
            id: noteId,
            symbol: "不明",
            side: "不明",
            timestamp: new Date().toISOString(),
          };

      // APIレスポンスをコンポーネント用データに変換
      const formattedData: SimilarNotesData = {
        baseNote: baseNoteInfo,
        similarNotes: result.data.similarNotes.map((n) => ({
          id: n.noteId,
          symbol: n.symbol,
          // バックエンド API のレスポンスを SimilarNote 型に合わせてキャスト
          side: n.side as "BUY" | "SELL" | "buy" | "sell",
          similarity: n.similarity,
          timestamp: n.timestamp,
          summarySnippet: n.summarySnippet,
          result: n.result as "win" | "loss" | "breakeven" | "pending",
        })),
        // TODO: 特徴量ベクトルの比較データを取得
        featureVector: [],
      };

      setData(formattedData);
    } catch (err) {
      console.error("類似ノート取得エラー:", err);
      setError(
        err instanceof Error ? err.message : "類似ノートの取得に失敗しました"
      );
    } finally {
      setIsLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    if (!noteId) return;
    loadSimilarNotes();
  }, [noteId, loadSimilarNotes]);

  // ローディング表示
  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  // エラー表示
  if (error || !data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>読み込みエラー</AlertTitle>
        <AlertDescription>
          {error || "データが見つかりませんでした"}
          <div className="mt-3">
            <Link
              href={`/notes/${noteId}`}
              className="text-violet-400 hover:underline"
            >
              ノート詳細に戻る
            </Link>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">類似トレード</h1>
          <p className="text-gray-400 mt-1">
            {data.baseNote.symbol} - {data.baseNote.side.toUpperCase()}{" "}
            の類似パターン
          </p>
        </div>
        <Link
          href={`/notes/${noteId}`}
          className="px-3 py-2 rounded-lg text-sm font-medium text-gray-300 hover:bg-slate-700/50 hover:text-white transition-all duration-300"
        >
          ← ノート詳細に戻る
        </Link>
      </div>

      {/* 特徴量ベクトル可視化（データがある場合のみ表示） */}
      {data.featureVector.length > 0 && (
        <FeatureVectorViz
          data={data.featureVector}
          showComparison={true}
          title="特徴量比較（ノート作成時 vs 現在）"
        />
      )}

      {/* 類似ノート一覧 */}
      <Card>
        <CardHeader>
          <CardTitle>類似ノート一覧</CardTitle>
        </CardHeader>
        <CardContent>
          {data.similarNotes.length === 0 ? (
            <EmptyState
              icon="📊"
              title="類似ノートが見つかりません"
              description="このトレードパターンに類似したノートはまだ記録されていません。"
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {data.similarNotes.map((note) => (
                <SimilarNoteCard key={note.id} note={note} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 統計サマリー */}
      {data.similarNotes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>類似パターン統計</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* 類似ノート数 */}
              <div className="text-center p-4 bg-slate-700/30 rounded-lg">
                <div className="text-3xl font-bold text-white">
                  {data.similarNotes.length}
                </div>
                <div className="text-sm text-gray-400">類似ノート数</div>
              </div>

              {/* 平均類似度 */}
              <div className="text-center p-4 bg-slate-700/30 rounded-lg">
                <div className="text-3xl font-bold text-violet-400">
                  {Math.round(
                    data.similarNotes.reduce((sum, n) => sum + n.similarity, 0) /
                      data.similarNotes.length
                  )}
                  %
                </div>
                <div className="text-sm text-gray-400">平均類似度</div>
              </div>

              {/* 勝率 */}
              <div className="text-center p-4 bg-slate-700/30 rounded-lg">
                <div className="text-3xl font-bold text-green-400">
                  {Math.round(
                    (data.similarNotes.filter((n) => n.result === "win").length /
                      data.similarNotes.filter((n) => n.result && n.result !== "pending").length) *
                      100
                  ) || 0}
                  %
                </div>
                <div className="text-sm text-gray-400">勝率</div>
              </div>

              {/* 最高類似度 */}
              <div className="text-center p-4 bg-slate-700/30 rounded-lg">
                <div className="text-3xl font-bold text-pink-400">
                  {Math.max(...data.similarNotes.map((n) => n.similarity))}%
                </div>
                <div className="text-sm text-gray-400">最高類似度</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
