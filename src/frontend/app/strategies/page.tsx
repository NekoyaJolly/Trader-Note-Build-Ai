/**
 * ストラテジー管理ページ - 一覧表示
 * 
 * 目的:
 * - 登録済みストラテジーの一覧を表示
 * - 新規作成・詳細・削除へのナビゲーション
 */

"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchStrategies, deleteStrategy, updateStrategyStatus, duplicateStrategy } from "@/lib/api";
import type { Strategy, StrategyStatus } from "@/types/strategy";

// ============================================
// サブコンポーネント: ストラテジーカード
// ============================================

interface StrategyCardProps {
  strategy: Strategy;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: StrategyStatus) => void;
  onDuplicate: (id: string) => void;
}

function StrategyCard({ strategy, onDelete, onStatusChange, onDuplicate }: StrategyCardProps) {
  const router = useRouter();
  const [showMenu, setShowMenu] = useState(false);

  // ステータスバッジの色
  const statusColors: Record<StrategyStatus, string> = {
    draft: "bg-yellow-600",
    active: "bg-green-600",
    archived: "bg-gray-600",
  };

  // ステータスのラベル
  const statusLabels: Record<StrategyStatus, string> = {
    draft: "下書き",
    active: "アクティブ",
    archived: "アーカイブ",
  };

  // 売買方向のスタイル
  const sideStyle = strategy.side === "buy"
    ? "text-green-400"
    : "text-red-400";

  // 日付フォーマット
  const formatDate = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-4 hover:border-slate-600 transition-colors">
      {/* ヘッダー部分 */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <Link href={`/strategies/${strategy.id}`}>
            <h3 className="text-lg font-semibold text-gray-200 hover:text-blue-400 transition-colors cursor-pointer">
              {strategy.name}
            </h3>
          </Link>
          <div className="flex items-center gap-2 mt-1">
            <span className={`px-2 py-0.5 text-xs rounded ${statusColors[strategy.status]} text-white`}>
              {statusLabels[strategy.status]}
            </span>
            <span className="text-sm text-gray-400">{strategy.symbol}</span>
            <span className={`text-sm font-medium ${sideStyle}`}>
              {strategy.side === "buy" ? "買い" : "売り"}
            </span>
            {strategy.currentVersion && (
              <span className="text-xs text-gray-500">v{strategy.currentVersion.versionNumber}</span>
            )}
          </div>
        </div>

        {/* メニューボタン */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 text-gray-400 hover:text-gray-200 hover:bg-slate-700 rounded"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </button>

          {/* ドロップダウンメニュー */}
          {showMenu && (
            <div className="absolute right-0 mt-1 w-40 bg-slate-700 rounded-lg shadow-lg z-10 border border-slate-600">
              <button
                onClick={() => { router.push(`/strategies/${strategy.id}/edit`); setShowMenu(false); }}
                className="w-full px-4 py-2 text-left text-sm text-gray-200 hover:bg-slate-600 rounded-t-lg"
              >
                編集
              </button>
              <button
                onClick={() => { onDuplicate(strategy.id); setShowMenu(false); }}
                className="w-full px-4 py-2 text-left text-sm text-gray-200 hover:bg-slate-600"
              >
                複製
              </button>
              <hr className="border-slate-600" />
              {strategy.status !== "active" && (
                <button
                  onClick={() => { onStatusChange(strategy.id, "active"); setShowMenu(false); }}
                  className="w-full px-4 py-2 text-left text-sm text-green-400 hover:bg-slate-600"
                >
                  アクティブにする
                </button>
              )}
              {strategy.status !== "archived" && (
                <button
                  onClick={() => { onStatusChange(strategy.id, "archived"); setShowMenu(false); }}
                  className="w-full px-4 py-2 text-left text-sm text-yellow-400 hover:bg-slate-600"
                >
                  アーカイブ
                </button>
              )}
              <hr className="border-slate-600" />
              <button
                onClick={() => { onDelete(strategy.id); setShowMenu(false); }}
                className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-slate-600 rounded-b-lg"
              >
                削除
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 説明文 */}
      {strategy.description && (
        <p className="text-sm text-gray-400 mb-3 line-clamp-2">
          {strategy.description}
        </p>
      )}

      {/* タグ */}
      {strategy.tags && strategy.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {strategy.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 bg-slate-700 text-xs text-gray-300 rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* フッター */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>作成: {formatDate(strategy.createdAt)}</span>
        <span>更新: {formatDate(strategy.updatedAt)}</span>
      </div>
    </div>
  );
}

// ============================================
// メインコンポーネント
// ============================================

export default function StrategiesPage() {
  const router = useRouter();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StrategyStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // ストラテジー一覧を取得
  const loadStrategies = async () => {
    try {
      setIsLoading(true);
      const data = await fetchStrategies(
        statusFilter === "all" ? undefined : statusFilter
      );
      setStrategies(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "データの取得に失敗しました";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStrategies();
  }, [statusFilter]);

  // 削除処理
  const handleDelete = async (id: string) => {
    if (!confirm("このストラテジーを削除しますか？この操作は取り消せません。")) {
      return;
    }

    try {
      await deleteStrategy(id);
      setStrategies(strategies.filter((s) => s.id !== id));
    } catch (err) {
      const message = err instanceof Error ? err.message : "削除に失敗しました";
      alert(message);
    }
  };

  // ステータス変更処理
  const handleStatusChange = async (id: string, status: StrategyStatus) => {
    try {
      const updated = await updateStrategyStatus(id, status);
      setStrategies(strategies.map((s) => (s.id === id ? updated : s)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "ステータス変更に失敗しました";
      alert(message);
    }
  };

  // 複製処理
  const handleDuplicate = async (id: string) => {
    try {
      const duplicated = await duplicateStrategy(id);
      setStrategies([duplicated, ...strategies]);
      router.push(`/strategies/${duplicated.id}/edit`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "複製に失敗しました";
      alert(message);
    }
  };

  // 検索フィルタ
  const filteredStrategies = strategies.filter((s) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.description?.toLowerCase().includes(q) ||
      s.symbol.toLowerCase().includes(q) ||
      s.tags?.some((t) => t.toLowerCase().includes(q))
    );
  });

  return (
    <div className="max-w-6xl mx-auto">
      {/* ヘッダー */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-200">ストラテジー</h1>
                <p className="text-gray-400 text-sm">
                  インジケーター条件を組み合わせたエントリー戦略を管理
                </p>
              </div>
              <Link
                href="/strategies/new"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors flex items-center gap-2 w-fit"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                新規作成
              </Link>
            </div>

            {/* フィルター・検索 */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              {/* 検索 */}
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="名前、説明、シンボル、タグで検索..."
                  className="w-full px-4 py-2 rounded-lg bg-slate-800 text-gray-200 border border-slate-700 focus:border-blue-500 focus:outline-none"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* ステータスフィルター */}
              <select
                className="px-4 py-2 rounded-lg bg-slate-800 text-gray-200 border border-slate-700 focus:border-blue-500 focus:outline-none"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StrategyStatus | "all")}
              >
                <option value="all">すべてのステータス</option>
                <option value="active">アクティブ</option>
                <option value="draft">下書き</option>
                <option value="archived">アーカイブ</option>
              </select>
            </div>

            {/* コンテンツ */}
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                <span className="ml-3 text-gray-400">読み込み中...</span>
              </div>
            ) : error ? (
              <div className="p-6 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-center">
                {error}
                <button
                  onClick={loadStrategies}
                  className="ml-4 text-blue-400 hover:text-blue-300"
                >
                  再読み込み
                </button>
              </div>
            ) : filteredStrategies.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-gray-500 mb-4">
                  {searchQuery
                    ? "検索条件に一致するストラテジーがありません"
                    : "ストラテジーがまだ登録されていません"}
                </div>
                {!searchQuery && (
                  <Link
                    href="/strategies/new"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                  >
                    最初のストラテジーを作成
                  </Link>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredStrategies.map((strategy) => (
                  <StrategyCard
                    key={strategy.id}
                    strategy={strategy}
                    onDelete={handleDelete}
                    onStatusChange={handleStatusChange}
                    onDuplicate={handleDuplicate}
                  />
                ))}
              </div>
            )}
    </div>
  );
}
