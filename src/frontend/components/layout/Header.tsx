"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * アプリ共通ヘッダー
 * ナビゲーションとアプリ名を表示する。
 */
export default function Header() {
  const pathname = usePathname();

  // 現在のパスに応じてナビの強調表示を切り替える
  const isActive = (href: string) => pathname?.startsWith(href);

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="container mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
        {/* アプリ名 */}
        <Link href="/" className="text-xl font-bold text-gray-900">
          TradeAssist MVP
        </Link>

        {/* ナビゲーション */}
        <nav className="flex items-center gap-4">
          <Link
            href="/notifications"
            className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
              isActive("/notifications")
                ? "bg-blue-100 text-blue-700"
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            通知
          </Link>
          <Link
            href="/notes"
            className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
              isActive("/notes")
                ? "bg-blue-100 text-blue-700"
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            ノート
          </Link>
        </nav>
      </div>
    </header>
  );
}
