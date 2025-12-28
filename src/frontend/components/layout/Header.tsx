"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";

/**
 * アプリ共通ヘッダー
 * ナビゲーションとアプリ名を表示する。
 * 「ノート」ボタンはドロップダウンメニューを持ち、ノート一覧とインポート画面への導線を提供。
 */
export default function Header() {
  const pathname = usePathname();
  const [isNoteMenuOpen, setIsNoteMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-white text-slate-900 shadow-sm">
      <div className="container mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
        {/* アプリ名 */}
        <Link href="/" className="text-xl font-bold text-slate-900">
          TradeAssist MVP
        </Link>

        {/* ナビゲーション */}
        <nav className="flex items-center gap-4">
          {/* 通知ボタン */}
          <Link
            href="/notifications"
            className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
              isActive("/notifications")
                ? "bg-blue-100 text-slate-900"
                : "text-slate-800 hover:bg-slate-100"
            }`}
          >
            通知
          </Link>

          {/* ノートメニュー（ドロップダウン） */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setIsNoteMenuOpen(!isNoteMenuOpen)}
              className={`px-3 py-2 rounded text-sm font-medium transition-colors flex items-center gap-1 ${
                isActive("/notes") || isActive("/import")
                  ? "bg-blue-100 text-slate-900"
                  : "text-slate-800 hover:bg-slate-100"
              }`}
            >
              ノート
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
              <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50">
                <Link
                  href="/notes"
                  onClick={() => setIsNoteMenuOpen(false)}
                  className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  📋 ノート一覧
                </Link>
                <Link
                  href="/import"
                  onClick={() => setIsNoteMenuOpen(false)}
                  className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  📥 ノート作成（インポート）
                </Link>
              </div>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
