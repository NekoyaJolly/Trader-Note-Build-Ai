"use client";

/**
 * 旧バックテストページ
 * 
 * このページは `/strategies` へリダイレクトされます。
 * バックテスト機能はストラテジーページに統合されました。
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function BacktestPage() {
  const router = useRouter();

  useEffect(() => {
    // ストラテジー一覧ページへ即時リダイレクト
    router.replace("/strategies");
  }, [router]);

  // リダイレクト中のフォールバック表示
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-cyan-500 mx-auto mb-4" />
        <p className="text-gray-400">ストラテジーページへ移動中...</p>
        <p className="text-xs text-gray-500 mt-2">
          バックテスト機能はストラテジーページに統合されました
        </p>
      </div>
    </div>
  );
}
