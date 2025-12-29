/**
 * 類似トレード検索画面
 * /notes/:id/similar
 *
 * 機能:
 * - 指定ノートに類似したトレードノートを一覧表示
 * - 類似度スコアでソート
 * - FeatureVectorViz による可視化
 */
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/Alert";
import SimilarNoteCard, { SimilarNote } from "@/components/SimilarNoteCard";
import FeatureVectorViz, { FeatureDataPoint } from "@/components/FeatureVectorViz";
import EmptyState from "@/components/EmptyState";

// モックデータ用の型定義
interface SimilarNotesResponse {
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

  const [data, setData] = useState<SimilarNotesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!noteId) return;
    loadSimilarNotes();
  }, [noteId]);

  /**
   * 類似ノートデータを取得
   * ※ 現在はモックデータを使用
   */
  async function loadSimilarNotes() {
    try {
      setIsLoading(true);
      setError(null);

      // TODO: 実際の API 呼び出しに置き換え
      // const response = await fetch(`/api/trades/notes/${noteId}/similar`);
      // const data = await response.json();

      // モックデータ（開発用）
      await new Promise((resolve) => setTimeout(resolve, 800));

      const mockData: SimilarNotesResponse = {
        baseNote: {
          id: noteId,
          symbol: "USD/JPY",
          side: "buy",
          timestamp: new Date().toISOString(),
        },
        similarNotes: [
          {
            id: "similar-1",
            symbol: "USD/JPY",
            side: "buy",
            similarity: 92,
            timestamp: "2024-12-20T10:30:00Z",
            summarySnippet: "RSIが30を下回り、MACDがゴールデンクロス直前。上昇トレンドへの転換シグナル。",
            result: "win",
          },
          {
            id: "similar-2",
            symbol: "USD/JPY",
            side: "buy",
            similarity: 85,
            timestamp: "2024-12-15T14:00:00Z",
            summarySnippet: "ボリンジャーバンドの下限に接触後の反発。RSIは35付近。",
            result: "win",
          },
          {
            id: "similar-3",
            symbol: "EUR/USD",
            side: "buy",
            similarity: 78,
            timestamp: "2024-12-10T09:15:00Z",
            summarySnippet: "日足で強い支持線に到達。4時間足でダイバージェンス確認。",
            result: "loss",
          },
          {
            id: "similar-4",
            symbol: "USD/JPY",
            side: "buy",
            similarity: 72,
            timestamp: "2024-12-05T16:45:00Z",
            summarySnippet: "経済指標発表後の急落からの戻り。テクニカル的には過売り状態。",
            result: "breakeven",
          },
        ],
        featureVector: [
          { feature: "RSI", label: "RSI", noteValue: 28, currentValue: 45 },
          { feature: "MACD Histogram", label: "MACD", noteValue: -15, currentValue: 5 },
          { feature: "BB Position", label: "BB", noteValue: 10, currentValue: 50 },
          { feature: "Volume", label: "VOL", noteValue: 85, currentValue: 60 },
          { feature: "Trend Strength", label: "Trend", noteValue: 65, currentValue: 70 },
          { feature: "Volatility", label: "Volat", noteValue: 40, currentValue: 35 },
        ],
      };

      setData(mockData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "類似ノートの取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  }

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
            <Link href={`/notes/${noteId}`} className="text-violet-400 hover:underline">
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
            {data.baseNote.symbol} - {data.baseNote.side.toUpperCase()} の類似パターン
          </p>
        </div>
        <Link
          href={`/notes/${noteId}`}
          className="px-3 py-2 rounded-lg text-sm font-medium text-gray-300 hover:bg-slate-700/50 hover:text-white transition-all duration-300"
        >
          ← ノート詳細に戻る
        </Link>
      </div>

      {/* 特徴量ベクトル可視化 */}
      <FeatureVectorViz
        data={data.featureVector}
        showComparison={true}
        title="特徴量比較（ノート作成時 vs 現在）"
      />

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
                <div className="text-3xl font-bold text-white">{data.similarNotes.length}</div>
                <div className="text-sm text-gray-400">類似ノート数</div>
              </div>
              
              {/* 平均類似度 */}
              <div className="text-center p-4 bg-slate-700/30 rounded-lg">
                <div className="text-3xl font-bold text-violet-400">
                  {Math.round(
                    data.similarNotes.reduce((sum, n) => sum + n.similarity, 0) /
                      data.similarNotes.length
                  )}%
                </div>
                <div className="text-sm text-gray-400">平均類似度</div>
              </div>
              
              {/* 勝率 */}
              <div className="text-center p-4 bg-slate-700/30 rounded-lg">
                <div className="text-3xl font-bold text-green-400">
                  {Math.round(
                    (data.similarNotes.filter((n) => n.result === "win").length /
                      data.similarNotes.filter((n) => n.result).length) *
                      100
                  ) || 0}%
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
