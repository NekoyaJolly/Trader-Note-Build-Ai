/**
 * ストラテジー詳細ページ
 * 
 * 目的:
 * - ストラテジーの詳細情報を表示
 * - バージョン履歴の閲覧
 * - 編集・削除・バックテストへのナビゲーション
 */

"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  fetchStrategy,
  deleteStrategy,
  updateStrategyStatus,
  duplicateStrategy,
} from "@/lib/api";
import type { Strategy, StrategyStatus, ConditionGroup, IndicatorCondition } from "@/types/strategy";

// ============================================
// 条件表示用サブコンポーネント
// ============================================

/** 単一条件を表示 */
function ConditionDisplay({ condition }: { condition: IndicatorCondition }) {
  // インジケーターフィールドの日本語ラベル
  const fieldLabels: Record<string, string> = {
    value: "値",
    macd: "MACD線",
    signal: "シグナル線",
    histogram: "ヒストグラム",
    upper: "上バンド",
    middle: "中央バンド",
    lower: "下バンド",
  };

  // 比較演算子の表示
  const operatorLabels: Record<string, string> = {
    ">": "＞",
    "<": "＜",
    ">=": "≧",
    "<=": "≦",
    "==": "＝",
    "cross_above": "↑ 上抜け",
    "cross_below": "↓ 下抜け",
  };

  // 比較対象の表示
  let compareTargetDisplay = "";
  if (condition.compareTarget.type === "fixed") {
    compareTargetDisplay = String(condition.compareTarget.value);
  } else if (condition.compareTarget.type === "indicator") {
    const params = condition.compareTarget.params
      ? `(${Object.values(condition.compareTarget.params).join(",")})`
      : "";
    const field = condition.compareTarget.field
      ? `.${condition.compareTarget.field}`
      : "";
    compareTargetDisplay = `${condition.compareTarget.indicatorId}${params}${field}`;
  } else if (condition.compareTarget.type === "price") {
    compareTargetDisplay = condition.compareTarget.priceType || "close";
  }

  const field = condition.field !== "value" ? `.${fieldLabels[condition.field] || condition.field}` : "";
  const params = condition.params
    ? `(${Object.values(condition.params).join(",")})`
    : "";

  return (
    <div className="bg-slate-700 px-3 py-2 rounded text-sm text-gray-200">
      <span className="text-blue-400">{condition.indicatorId.toUpperCase()}</span>
      <span className="text-gray-400">{params}</span>
      <span className="text-purple-400">{field}</span>
      <span className="mx-2 text-yellow-400">{operatorLabels[condition.operator] || condition.operator}</span>
      <span className="text-green-400">{compareTargetDisplay}</span>
    </div>
  );
}

/** 条件グループを再帰的に表示 */
function ConditionGroupDisplay({ group, depth = 0 }: { group: ConditionGroup; depth?: number }) {
  const operatorLabel = group.operator === "AND" ? "かつ" : group.operator === "OR" ? "または" : "NOT";
  const operatorColor = group.operator === "AND" ? "text-blue-400" : group.operator === "OR" ? "text-orange-400" : "text-red-400";

  return (
    <div className={`${depth > 0 ? "ml-4 pl-4 border-l-2 border-slate-600" : ""}`}>
      {depth > 0 && (
        <div className={`text-sm font-medium ${operatorColor} mb-2`}>
          {operatorLabel}
        </div>
      )}
      <div className="space-y-2">
        {group.conditions.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            {"conditionId" in item ? (
              <ConditionDisplay condition={item as IndicatorCondition} />
            ) : (
              <ConditionGroupDisplay group={item as ConditionGroup} depth={depth + 1} />
            )}
            {index < group.conditions.length - 1 && (
              <span className={`text-xs ${operatorColor}`}>{operatorLabel}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// メインコンポーネント
// ============================================

export default function StrategyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const strategyId = params.id as string;

  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVersionNumber, setSelectedVersionNumber] = useState<number | null>(null);

  // ストラテジー取得
  useEffect(() => {
    const loadStrategy = async () => {
      try {
        setIsLoading(true);
        const data = await fetchStrategy(strategyId);
        setStrategy(data);
        if (data.currentVersion) {
          setSelectedVersionNumber(data.currentVersion.versionNumber);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "データの取得に失敗しました";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };
    loadStrategy();
  }, [strategyId]);

  // 削除処理
  const handleDelete = async () => {
    if (!confirm("このストラテジーを削除しますか？この操作は取り消せません。")) {
      return;
    }

    try {
      await deleteStrategy(strategyId);
      router.push("/strategies");
    } catch (err) {
      const message = err instanceof Error ? err.message : "削除に失敗しました";
      alert(message);
    }
  };

  // ステータス変更処理
  const handleStatusChange = async (status: StrategyStatus) => {
    try {
      const updated = await updateStrategyStatus(strategyId, status);
      setStrategy(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : "ステータス変更に失敗しました";
      alert(message);
    }
  };

  // 複製処理
  const handleDuplicate = async () => {
    try {
      const duplicated = await duplicateStrategy(strategyId);
      router.push(`/strategies/${duplicated.id}/edit`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "複製に失敗しました";
      alert(message);
    }
  };

  // ステータスバッジの色
  const statusColors: Record<StrategyStatus, string> = {
    draft: "bg-yellow-600",
    active: "bg-green-600",
    archived: "bg-gray-600",
  };

  const statusLabels: Record<StrategyStatus, string> = {
    draft: "下書き",
    active: "アクティブ",
    archived: "アーカイブ",
  };

  // 日付フォーマット
  const formatDateTime = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // ローディング
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-3 text-gray-400">読み込み中...</span>
      </div>
    );
  }

  // エラー
  if (error || !strategy) {
    return (
      <div className="text-center py-12">
        <div className="text-red-400 mb-4">{error || "ストラテジーが見つかりません"}</div>
        <Link href="/strategies" className="text-blue-400 hover:text-blue-300">
          一覧に戻る
        </Link>
      </div>
    );
  }

  const currentVersion = strategy.currentVersion;
  const exitSettings = currentVersion?.exitSettings as {
    takeProfit: { value: number; unit: string };
    stopLoss: { value: number; unit: string };
    maxHoldingMinutes?: number;
  } | null;

  return (
    <div className="max-w-4xl mx-auto">
      {/* パンくずリスト */}
      <nav className="mb-6">
        <ol className="flex items-center gap-2 text-sm">
          <li>
            <Link href="/strategies" className="text-gray-400 hover:text-blue-400">
              ストラテジー
            </Link>
          </li>
          <li className="text-gray-500">/</li>
          <li className="text-gray-200 truncate max-w-[200px]">{strategy.name}</li>
        </ol>
      </nav>

      {/* ヘッダー */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-2xl font-bold text-gray-200">{strategy.name}</h1>
                  <span className={`px-2 py-0.5 text-xs rounded ${statusColors[strategy.status]} text-white`}>
                    {statusLabels[strategy.status]}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-400">
                  <span>{strategy.symbol}</span>
                  <span className={strategy.side === "buy" ? "text-green-400" : "text-red-400"}>
                    {strategy.side === "buy" ? "買い" : "売り"}
                  </span>
                  {currentVersion && (
                    <span className="text-gray-500">v{currentVersion.versionNumber}</span>
                  )}
                </div>
              </div>

              {/* アクションボタン */}
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/strategies/${strategy.id}/edit`}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors text-sm"
                >
                  編集
                </Link>
                <Link
                  href={`/strategies/${strategy.id}/backtest`}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors text-sm"
                >
                  バックテスト
                </Link>
                <button
                  onClick={handleDuplicate}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-gray-200 rounded-lg transition-colors text-sm"
                >
                  複製
                </button>
                {strategy.status !== "active" && (
                  <button
                    onClick={() => handleStatusChange("active")}
                    className="px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg transition-colors text-sm"
                  >
                    アクティブにする
                  </button>
                )}
                {strategy.status !== "archived" && (
                  <button
                    onClick={() => handleStatusChange("archived")}
                    className="px-4 py-2 bg-yellow-700 hover:bg-yellow-600 text-white rounded-lg transition-colors text-sm"
                  >
                    アーカイブ
                  </button>
                )}
                <button
                  onClick={handleDelete}
                  className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg transition-colors text-sm"
                >
                  削除
                </button>
              </div>
            </div>

            {/* 説明 */}
            {strategy.description && (
              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 mb-6">
                <p className="text-gray-300">{strategy.description}</p>
              </div>
            )}

            {/* タグ */}
            {strategy.tags && strategy.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                {strategy.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-3 py-1 bg-slate-700 text-sm text-gray-300 rounded"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* エントリー条件 */}
            {currentVersion && (
              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 mb-6">
                <h2 className="text-lg font-semibold text-gray-200 mb-4">エントリー条件</h2>
                <ConditionGroupDisplay
                  group={currentVersion.entryConditions as ConditionGroup}
                />
              </div>
            )}

            {/* イグジット設定 */}
            {exitSettings && (
              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 mb-6">
                <h2 className="text-lg font-semibold text-gray-200 mb-4">イグジット設定</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-slate-700 p-3 rounded">
                    <div className="text-xs text-gray-400 mb-1">利確 (TP)</div>
                    <div className="text-lg text-green-400">
                      {exitSettings.takeProfit.value}{" "}
                      {exitSettings.takeProfit.unit === "percent" ? "%" : "Pips"}
                    </div>
                  </div>
                  <div className="bg-slate-700 p-3 rounded">
                    <div className="text-xs text-gray-400 mb-1">損切 (SL)</div>
                    <div className="text-lg text-red-400">
                      {exitSettings.stopLoss.value}{" "}
                      {exitSettings.stopLoss.unit === "percent" ? "%" : "Pips"}
                    </div>
                  </div>
                  <div className="bg-slate-700 p-3 rounded">
                    <div className="text-xs text-gray-400 mb-1">最大保有時間</div>
                    <div className="text-lg text-gray-200">
                      {exitSettings.maxHoldingMinutes
                        ? `${exitSettings.maxHoldingMinutes}分`
                        : "制限なし"}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* バージョン履歴 */}
            {strategy.versions && strategy.versions.length > 0 && (
              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 mb-6">
                <h2 className="text-lg font-semibold text-gray-200 mb-4">バージョン履歴</h2>
                <div className="space-y-2">
                  {strategy.versions.map((version) => (
                    <div
                      key={version.id}
                      className={`flex items-center justify-between p-3 rounded ${
                        version.versionNumber === selectedVersionNumber
                          ? "bg-blue-900/30 border border-blue-700"
                          : "bg-slate-700"
                      }`}
                    >
                      <div>
                        <span className="text-gray-200 font-medium">v{version.versionNumber}</span>
                        <span className="text-gray-500 text-sm ml-3">
                          {formatDateTime(version.createdAt)}
                        </span>
                        {version.changeNote && (
                          <span className="text-gray-400 text-sm ml-3">
                            {version.changeNote}
                          </span>
                        )}
                      </div>
                      {version.versionNumber === currentVersion?.versionNumber && (
                        <span className="px-2 py-0.5 bg-blue-600 text-xs text-white rounded">
                          現在
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

      {/* メタ情報 */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">作成日時</span>
            <span className="text-gray-300 ml-2">{formatDateTime(strategy.createdAt)}</span>
          </div>
          <div>
            <span className="text-gray-500">更新日時</span>
            <span className="text-gray-300 ml-2">{formatDateTime(strategy.updatedAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
