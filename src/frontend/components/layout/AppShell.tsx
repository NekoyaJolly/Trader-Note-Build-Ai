"use client";

/**
 * アプリケーションシェルコンポーネント
 * 
 * サイドバーナビゲーションとメインコンテンツエリアを統合するラッパー
 * モバイル: サイドバーはオーバーレイ（ハンバーガーで開閉）
 * デスクトップ（md 以上）: サイドバーは常時表示、メインと横並び
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { writeLastSideAPath } from "@/lib/lastSideAPath";
import Sidebar from "./Sidebar";
import Header from "./Header";

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * アプリケーションシェル
 * サイドバーの状態（展開/非表示）を管理し、
 * ヘッダーにサイドバートグルボタンを配置
 */
export default function AppShell({ children }: AppShellProps) {
  // サイドバーの表示状態（モバイル: false=非表示, デスクトップ: false=折りたたみ）
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  // クライアントサイドでのみ初期化（非同期で setState して react-hooks ルール準拠）
  useEffect(() => {
    queueMicrotask(() => setMounted(true));
  }, []);

  // Side-A ホーム「前回の続き」用: pathname のみ（トースト用クエリ等を保存しない）
  useEffect(() => {
    writeLastSideAPath(pathname);
  }, [pathname]);

  // サイドバートグル
  const handleToggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  // サイドバーを閉じる（ナビゲーション選択時など）
  const handleCloseSidebar = () => {
    setIsSidebarOpen(false);
  };

  // 初回レンダリング時のハイドレーションエラーを防ぐ
  if (!mounted) {
    return (
      <div className="flex flex-col min-h-screen">
        {/* ヘッダープレースホルダー */}
        <div className="h-12 sm:h-14 border-b border-slate-700 bg-slate-900" />
        <main className="flex-1">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* 共通ヘッダー（ハンバーガーメニュー + タイトル + 通知ベル） */}
      <Header 
        isSidebarOpen={isSidebarOpen} 
        onToggleSidebar={handleToggleSidebar} 
      />

      {/* md 以上: サイドバー常時 + メインを横並び。未満: サイドバーはオーバーレイのみ */}
      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        <Sidebar 
          isOpen={isSidebarOpen} 
          onClose={handleCloseSidebar} 
        />
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
