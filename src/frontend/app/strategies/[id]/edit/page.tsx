/**
 * ストラテジー編集ページ
 * 
 * 目的:
 * - 既存ストラテジーを編集するフォームを表示
 * - 更新時は常に新しいバージョンとして保存
 */

"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import StrategyForm from "@/components/strategy/StrategyForm";
import { fetchStrategy } from "@/lib/api";
import type { Strategy } from "@/types/strategy";

export default function EditStrategyPage() {
  const params = useParams();
  const router = useRouter();
  const strategyId = params.id as string;

  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ストラテジー取得
  useEffect(() => {
    const loadStrategy = async () => {
      try {
        setIsLoading(true);
        const data = await fetchStrategy(strategyId);
        setStrategy(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "データの取得に失敗しました";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };
    loadStrategy();
  }, [strategyId]);

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
          <li>
            <Link
              href={`/strategies/${strategy.id}`}
              className="text-gray-400 hover:text-blue-400 truncate max-w-[150px] inline-block"
            >
              {strategy.name}
            </Link>
          </li>
          <li className="text-gray-500">/</li>
          <li className="text-gray-200">編集</li>
        </ol>
      </nav>

      {/* ページヘッダー */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-200">ストラテジーを編集</h1>
        <p className="text-gray-400 text-sm mt-1">
          変更を保存すると新しいバージョンとして記録されます（v{(strategy.currentVersion?.versionNumber || 0) + 1}）
        </p>
      </div>

      {/* フォーム */}
      <StrategyForm
        strategy={strategy}
        onCancel={() => router.push(`/strategies/${strategy.id}`)}
      />
    </div>
  );
}
