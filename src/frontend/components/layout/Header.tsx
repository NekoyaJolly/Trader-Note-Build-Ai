"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import NotificationBell from "@/components/NotificationBell";

/**
 * アプリ共通ヘッダー（Neon Dark テーマ対応）
 * 
 * ナビゲーションとアプリ名を表示する。
 * NotificationBell コンポーネントで未読通知を表示。
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */
export default function Header() {
  const pathname = usePathname();
  const [isNoteMenuOpen, setIsNoteMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // TODO: 実際の未読数を API から取得
  const unreadCount = 3;

  // 現在のパスに応じてナビの強調表示を切り替える
  const isActive = (href: string) => pathname?.startsWith(href);

  // メニュー外クリックで閉じる
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsNoteMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ナビリンクのスタイル
  const navLinkClass = (href: string) => `
    px-3 py-2 rounded-lg text-sm font-medium transition-smooth
    ${isActive(href)
      ? "bg-slate-700 text-white"
      : "text-gray-300 hover:bg-slate-700 hover:text-white"
    }
  `;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-700 bg-slate-900">
      <div className="container mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
        {/* アプリ名（ネオンテキスト） */}
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl font-bold neon-text">TradeAssist</span>
        </Link>

        {/* デスクトップナビゲーション */}
        <nav className="hidden md:flex items-center gap-2">
          {/* ホーム */}
          <Link href="/" className={navLinkClass("/dashboard")}>
            🏠 ホーム
          </Link>

          {/* ノートメニュー（ドロップダウン） */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setIsNoteMenuOpen(!isNoteMenuOpen)}
              className={`
                px-3 py-2 rounded-lg text-sm font-medium transition-smooth
                flex items-center gap-1
                ${isActive("/notes") || isActive("/import")
                  ? "bg-slate-700 text-white"
                  : "text-gray-300 hover:bg-slate-700 hover:text-white"
                }
              `}
            >
              📝 ノート
              <svg
                className={`w-4 h-4 transition-transform ${isNoteMenuOpen ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* ドロップダウンメニュー */}
            {isNoteMenuOpen && (
              <div className="absolute right-0 mt-2 w-52 bg-slate-800 border border-slate-700 rounded-lg shadow-lg py-1 z-50">
                <Link
                  href="/notes"
                  onClick={() => setIsNoteMenuOpen(false)}
                  className="block px-4 py-2.5 text-sm text-gray-300 hover:bg-slate-700 hover:text-white transition-colors"
                >
                  📋 ノート一覧
                </Link>
                <Link
                  href="/import"
                  onClick={() => setIsNoteMenuOpen(false)}
                  className="block px-4 py-2.5 text-sm text-gray-300 hover:bg-slate-700 hover:text-white transition-colors"
                >
                  📥 CSVインポート
                </Link>
              </div>
            )}
          </div>

          {/* 通知ベル */}
          <NotificationBell unreadCount={unreadCount} />
        </nav>

        {/* モバイルメニューボタン */}
        <div className="flex md:hidden items-center gap-2">
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
        <div className="md:hidden border-t border-slate-700 bg-slate-800 px-4 py-2">
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
        </div>
      )}
    </header>
  );
}
