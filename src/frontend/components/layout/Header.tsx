"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import NotificationBell from "@/components/NotificationBell";

/**
 * アプリ共通ヘッダー（Neon Dark テーマ対応）
 * 
 * モバイル画面用のヘッダー
 * デスクトップではサイドバーを使用するため、ヘッダーはモバイル専用
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */
export default function Header() {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // TODO: 実際の未読数を API から取得
  const unreadCount = 3;

  return (
    <header className="md:hidden sticky top-0 z-40 w-full border-b border-slate-700 bg-slate-900">
      <div className="px-4 py-3 flex items-center justify-between">
        {/* アプリ名（ネオンテキスト） */}
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl font-bold neon-text">TradeAssist</span>
        </Link>

        {/* モバイルメニューボタン */}
        <div className="flex items-center gap-2">
          <NotificationBell unreadCount={unreadCount} />
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 rounded-lg text-gray-300 hover:bg-slate-700 transition-smooth"
            aria-label="メニュー"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isMobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* モバイルメニュー */}
      {isMobileMenuOpen && (
        <div className="border-t border-slate-700 bg-slate-800 px-4 py-2">
          <Link
            href="/"
            onClick={() => setIsMobileMenuOpen(false)}
            className="block px-3 py-2.5 text-sm text-gray-300 hover:bg-slate-700 rounded-lg"
          >
            🏠 ホーム
          </Link>
          <Link
            href="/notifications"
            onClick={() => setIsMobileMenuOpen(false)}
            className="block px-3 py-2.5 text-sm text-gray-300 hover:bg-slate-700 rounded-lg"
          >
            🔔 通知
          </Link>
          <Link
            href="/notes"
            onClick={() => setIsMobileMenuOpen(false)}
            className="block px-3 py-2.5 text-sm text-gray-300 hover:bg-slate-700 rounded-lg"
          >
            📋 ノート一覧
          </Link>
          <Link
            href="/import"
            onClick={() => setIsMobileMenuOpen(false)}
            className="block px-3 py-2.5 text-sm text-gray-300 hover:bg-slate-700 rounded-lg"
          >
            📥 CSVインポート
          </Link>
          <Link
            href="/settings"
            onClick={() => setIsMobileMenuOpen(false)}
            className="block px-3 py-2.5 text-sm text-gray-300 hover:bg-slate-700 rounded-lg"
          >
            ⚙️ 設定
          </Link>
          <Link
            href="/onboarding"
            onClick={() => setIsMobileMenuOpen(false)}
            className="block px-3 py-2.5 text-sm text-gray-300 hover:bg-slate-700 rounded-lg"
          >
            ⚡ オンボーディング
          </Link>
        </div>
      )}
    </header>
  );
}
