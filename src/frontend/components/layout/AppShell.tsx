"use client";

/**
 * アプリケーションシェルコンポーネント
 * 
 * サイドバーナビゲーションとメインコンテンツエリアを統合するラッパー
 * デスクトップ画面でサイドバーを表示し、モバイルでは非表示
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

import { useState, useEffect } from "react";
import Sidebar from "./Sidebar";

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * アプリケーションシェル
 * サイドバーの状態（折りたたみ/展開）を管理し、
 * メインコンテンツのマージンを動的に調整
 */
export default function AppShell({ children }: AppShellProps) {
  // サイドバーの折りたたみ状態をローカルストレージから復元
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  // クライアントサイドでのみローカルストレージを使用
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved !== null) {
      setIsCollapsed(JSON.parse(saved));
    }
  }, []);

  // 折りたたみ状態を保存
  const handleCollapsedChange = (collapsed: boolean) => {
    setIsCollapsed(collapsed);
    localStorage.setItem("sidebar-collapsed", JSON.stringify(collapsed));
  };

  // 初回レンダリング時のハイドレーションエラーを防ぐ
  if (!mounted) {
    return (
      <div className="min-h-screen">
        {children}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* サイドバー（デスクトップのみ） */}
      <Sidebar 
        isCollapsed={isCollapsed} 
        onCollapsedChange={handleCollapsedChange} 
      />
      
      {/* メインコンテンツエリア */}
      <div 
        className={`
          flex-1 flex flex-col min-h-screen
          transition-all duration-300 ease-in-out
          md:ml-64
          ${isCollapsed ? "md:ml-16" : "md:ml-64"}
        `}
      >
        {children}
      </div>
    </div>
  );
}
