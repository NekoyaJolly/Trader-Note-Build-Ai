"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import NotificationBell from "@/components/NotificationBell";
import SideToggle from "./SideToggle";
import { fetchUnreadNotificationCount } from "@/lib/api";

/**
 * アプリ共通ヘッダー
 * 
 * レイアウト: [ハンバーガーメニュー] [アプリタイトル + Side切替] ... [通知ベル]
 * 
 * Side-A: 人間用取引支援（従来機能）
 * Side-B: AI用取引プラン生成（新機能）
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

interface HeaderProps {
  /** サイドバー展開/折りたたみ状態 */
  isSidebarOpen?: boolean;
  /** サイドバー展開/折りたたみトグル */
  onToggleSidebar?: () => void;
}

export default function Header({ isSidebarOpen, onToggleSidebar }: HeaderProps) {
  // 未読通知数をAPIから取得
  const [unreadCount, setUnreadCount] = useState<number>(0);

  useEffect(() => {
    // 初回読み込み
    fetchUnreadNotificationCount()
      .then(setUnreadCount)
      .catch(console.error);

    // 30秒ごとに更新（ポーリング）
    const interval = setInterval(() => {
      fetchUnreadNotificationCount()
        .then(setUnreadCount)
        .catch(console.error);
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  return (
    <header className="sticky top-0 z-30 w-full glass-strong">
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3">
        {/* 左側: ハンバーガーメニュー + アプリタイトル + Side切替 */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* サイドバートグルボタン（ハンバーガーメニュー） */}
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              className="md:hidden p-1.5 sm:p-2 rounded-lg text-gray-400 hover:text-white hover:bg-slate-700/60 transition-all duration-200 press-scale"
              aria-label={isSidebarOpen ? "メニューを閉じる" : "メニューを開く"}
            >
              {isSidebarOpen ? (
                // 閉じるアイコン（X）
                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                // ハンバーガーアイコン
                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          )}

          {/* アプリタイトル */}
          <Link href="/" className="flex items-center mr-2 sm:mr-3 group">
            <span className="text-base sm:text-lg md:text-xl font-bold neon-text transition-all duration-300 group-hover:drop-shadow-[0_0_8px_rgba(236,72,153,0.5)]">TradeAssist</span>
          </Link>

          {/* Side切替トグル */}
          <div className="border-l border-slate-600/50 pl-2 sm:pl-3">
            <SideToggle />
          </div>
        </div>

        {/* 右側: 通知ベル */}
        <NotificationBell unreadCount={unreadCount} />
      </div>
      {/* グラデーションライン */}
      <div className="gradient-line" />
    </header>
  );
}

