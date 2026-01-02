"use client";

import Link from "next/link";
import NotificationBell from "@/components/NotificationBell";

/**
 * アプリ共通ヘッダー
 * 
 * レイアウト: [ハンバーガーメニュー] [アプリタイトル] ... [通知ベル]
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
  // TODO: 実際の未読数を API から取得
  const unreadCount = 3;

  return (
    <header className="sticky top-0 z-30 w-full border-b border-slate-700 bg-slate-900/95 backdrop-blur-sm">
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3">
        {/* 左側: ハンバーガーメニュー + アプリタイトル */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* サイドバートグルボタン（ハンバーガーメニュー） */}
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="p-1.5 sm:p-2 rounded-lg text-gray-400 hover:text-white hover:bg-slate-700 transition-all"
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
          <Link href="/" className="flex items-center">
            <span className="text-base sm:text-lg md:text-xl font-bold neon-text">TradeAssist</span>
          </Link>
        </div>

        {/* 右側: 通知ベル */}
        <NotificationBell unreadCount={unreadCount} />
      </div>
    </header>
  );
}
