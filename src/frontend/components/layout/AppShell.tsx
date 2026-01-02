"use client";

/**
 * アプリケーションシェルコンポーネント
 * 
 * サイドバーナビゲーションとメインコンテンツエリアを統合するラッパー
 * モバイル: サイドバーはオーバーレイ表示（デフォルト非表示）
 * デスクトップ: サイドバーは固定表示
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

import { useState, useEffect } from "react";
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

  // クライアントサイドでのみ初期化
  useEffect(() => {
    setMounted(true);
  }, []);

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

      {/* サイドバー（オーバーレイ式） */}
      <Sidebar 
        isOpen={isSidebarOpen} 
        onClose={handleCloseSidebar} 
      />
      
      {/* メインコンテンツエリア */}
      <div className="flex-1 flex flex-col">
        {children}
      </div>
    </div>
  );
}
