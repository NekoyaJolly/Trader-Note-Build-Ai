"use client";

/**
 * アプリケーションシェルコンポーネント
 * 
 * サイドバーナビゲーションとメインコンテンツエリアを統合するラッパー
 * 全デバイスでサイドバーを表示
 * 初期状態：折りたたみ
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
  // サイドバーの折りたたみ状態（初期値: true = 折りたたみ）
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [mounted, setMounted] = useState(false);

  // クライアントサイドでのみローカルストレージを使用
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved !== null) {
      setIsCollapsed(JSON.parse(saved));
    }
    // 初回アクセス時（保存値がない）は折りたたみ状態を維持
  }, []);

  // 折りたたみ状態を保存
  const handleCollapsedChange = (collapsed: boolean) => {
    setIsCollapsed(collapsed);
    localStorage.setItem("sidebar-collapsed", JSON.stringify(collapsed));
  };

  // 初回レンダリング時のハイドレーションエラーを防ぐ
  // 折りたたみ状態でレンダリング（デフォルト = w-16）
  if (!mounted) {
    return (
      <div className="flex min-h-screen">
        <div className="w-16" /> {/* サイドバーのプレースホルダー */}
        <div className="flex-1 flex flex-col min-h-screen ml-16">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* サイドバー（全デバイスで表示） */}
      <Sidebar 
        isCollapsed={isCollapsed} 
        onCollapsedChange={handleCollapsedChange} 
      />
      
      {/* メインコンテンツエリア */}
      <div 
        className={`
          flex-1 flex flex-col min-h-screen
          transition-all duration-300 ease-in-out
          ${isCollapsed ? "ml-16" : "ml-64"}
        `}
      >
        {children}
      </div>
    </div>
  );
}
