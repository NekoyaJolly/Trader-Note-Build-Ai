"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/Alert";
import {
  fetchNotePerformance,
  type NotePerformanceReport,
  type HourlyPerformance,
  type ConditionPerformance,
  type WeakPattern,
  type MarketCondition,
} from "@/lib/api";

interface PerformancePanelProps {
  noteId: string;
}

/**
 * 相場状況の日本語ラベル
 */
const CONDITION_LABELS: Record<MarketCondition, string> = {
  trending_up: "上昇トレンド",
  trending_down: "下降トレンド",
  ranging: "レンジ",
  volatile: "高ボラティリティ",
};

/**
 * 相場状況のアイコン
 */
const CONDITION_ICONS: Record<MarketCondition, string> = {
  trending_up: "📈",
  trending_down: "📉",
  ranging: "➡️",
  volatile: "⚡",
};

/**
 * ノートパフォーマンスパネル
 * 
 * フェーズ9「ノートの自己評価」のUI
 * EvaluationLog から集計したパフォーマンス情報を表示
 */
export default function PerformancePanel({ noteId }: PerformancePanelProps) {
  const [report, setReport] = useState<NotePerformanceReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPerformance();
  }, [noteId]);

  async function loadPerformance() {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchNotePerformance(noteId);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "パフォーマンスデータの取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  }

  // ローディング
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>📊 パフォーマンス分析</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // エラー
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>📊 パフォーマンス分析</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>エラー</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // データなし
  if (!report) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>📊 パフォーマンス分析</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-400">
            <p>評価ログがありません</p>
            <p className="text-sm mt-2">
              マッチング実行後にパフォーマンスデータが蓄積されます
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>📊 パフォーマンス分析</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 基本統計 */}
        <BasicStats report={report} />

        {/* 時間帯別パフォーマンス */}
        <HourlyChart hourlyData={report.performanceByHour} />

        {/* 相場状況別パフォーマンス */}
        <ConditionChart conditionData={report.performanceByMarketCondition} />

        {/* 弱いパターン */}
        {report.weakPatterns.length > 0 && (
          <WeakPatternsSection patterns={report.weakPatterns} />
        )}

        {/* メタ情報 */}
        <div className="text-xs text-gray-500 text-right">
          最終評価: {report.lastEvaluatedAt ? new Date(report.lastEvaluatedAt).toLocaleString("ja-JP") : "-"}
          {" | "}
          レポート生成: {new Date(report.generatedAt).toLocaleString("ja-JP")}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * 基本統計セクション
 */
function BasicStats({ report }: { report: NotePerformanceReport }) {
  // 発火率に基づいたカラー
  const getTriggerRateColor = (rate: number) => {
    if (rate >= 0.3) return "text-green-400";
    if (rate >= 0.15) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        label="総評価回数"
        value={report.totalEvaluations.toLocaleString()}
        icon="🔄"
      />
      <StatCard
        label="発火回数"
        value={report.triggeredCount.toLocaleString()}
        icon="🎯"
      />
      <StatCard
        label="発火率"
        value={`${(report.triggerRate * 100).toFixed(1)}%`}
        icon="📊"
        valueClassName={getTriggerRateColor(report.triggerRate)}
      />
      <StatCard
        label="平均類似度"
        value={`${(report.avgSimilarity * 100).toFixed(1)}%`}
        icon="📏"
      />
    </div>
  );
}

/**
 * 統計カード
 */
function StatCard({
  label,
  value,
  icon,
  valueClassName = "",
}: {
  label: string;
  value: string;
  icon: string;
  valueClassName?: string;
}) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
      <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <div className={`text-xl font-bold ${valueClassName || "text-white"}`}>
        {value}
      </div>
    </div>
  );
}

/**
 * 時間帯別パフォーマンスチャート（簡易バー）
 */
function HourlyChart({ hourlyData }: { hourlyData: HourlyPerformance[] }) {
  // 評価回数が0の時間帯を除外
  const activeHours = hourlyData.filter((h) => h.evaluationCount > 0);
  
  if (activeHours.length === 0) {
    return null;
  }

  const maxTriggerRate = Math.max(...activeHours.map((h) => h.triggerRate));

  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-400 mb-3">
        🕐 時間帯別パフォーマンス（UTC）
      </h4>
      <div className="flex items-end gap-1 h-20 bg-slate-800/30 rounded-lg p-2">
        {hourlyData.map((h) => {
          const height = h.evaluationCount > 0 && maxTriggerRate > 0
            ? (h.triggerRate / maxTriggerRate) * 100
            : 0;
          const bgColor = h.triggerRate >= 0.3
            ? "bg-green-500"
            : h.triggerRate >= 0.15
            ? "bg-yellow-500"
            : "bg-slate-600";

          return (
            <div
              key={h.hour}
              className="flex-1 flex flex-col items-center group"
              title={`${h.hour}時: 発火率 ${(h.triggerRate * 100).toFixed(1)}%, 評価 ${h.evaluationCount}件`}
            >
              <div
                className={`w-full rounded-t ${bgColor} transition-all duration-300 hover:opacity-80`}
                style={{ height: `${Math.max(height, 2)}%` }}
              />
              {h.hour % 6 === 0 && (
                <span className="text-[10px] text-gray-500 mt-1">{h.hour}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 相場状況別パフォーマンス
 */
function ConditionChart({ conditionData }: { conditionData: ConditionPerformance[] }) {
  // 評価回数が0の状況を除外
  const activeConditions = conditionData.filter((c) => c.evaluationCount > 0);
  
  if (activeConditions.length === 0) {
    return null;
  }

  // 発火率でソート
  const sorted = [...activeConditions].sort((a, b) => b.triggerRate - a.triggerRate);

  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-400 mb-3">
        📈 相場状況別パフォーマンス
      </h4>
      <div className="space-y-2">
        {sorted.map((c) => (
          <div
            key={c.condition}
            className="flex items-center gap-3 bg-slate-800/30 rounded-lg p-3"
          >
            <span className="text-lg">{CONDITION_ICONS[c.condition]}</span>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-300">
                  {CONDITION_LABELS[c.condition]}
                </span>
                <span className="text-sm font-medium text-white">
                  {(c.triggerRate * 100).toFixed(1)}%
                </span>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${c.triggerRate * 100}%` }}
                />
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {c.evaluationCount}件の評価
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 弱いパターンセクション
 */
function WeakPatternsSection({ patterns }: { patterns: WeakPattern[] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-400 mb-3">
        ⚠️ 弱いパターン（注意が必要な状況）
      </h4>
      <div className="space-y-2">
        {patterns.map((p, idx) => (
          <div
            key={idx}
            className="flex items-center justify-between bg-red-900/20 border border-red-800/30 rounded-lg p-3"
          >
            <div>
              <span className="text-red-400 font-medium">{p.description}</span>
              <span className="text-gray-500 text-sm ml-2">
                ({p.occurrences}回発生)
              </span>
            </div>
            <Badge variant="outline" className="text-red-400 border-red-600/50">
              平均 {(p.avgSimilarity * 100).toFixed(0)}%
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
