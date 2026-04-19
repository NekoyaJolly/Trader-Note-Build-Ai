"use client";

/**
 * ボトムナビゲーションコンポーネント
 *
 * モバイル用。左端はチャート（/market-analysis）を固定（再設計案 §3-4）
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

// ナビゲーションアイテムの定義
const navItems = [
  {
    href: "/market-analysis",
    label: "チャート",
    icon: (active: boolean) => (
      <svg className="w-5 h-5" fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
      </svg>
    ),
  },
  {
    href: "/notifications",
    label: "通知",
    icon: (active: boolean) => (
      <svg className="w-5 h-5" fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    ),
  },
  {
    href: "/notes",
    label: "ノート",
    icon: (active: boolean) => (
      <svg className="w-5 h-5" fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "設定",
    icon: (active: boolean) => (
      <svg className="w-5 h-5" fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

/**
 * ボトムナビゲーション（モバイル専用）
 */
export default function BottomNavigation() {
  const pathname = usePathname();

  // アクティブ判定（完全一致またはプレフィックス一致）
  const isActive = (href: string) => {
    if (!pathname) return false;
    if (href === "/market-analysis") {
      return pathname === "/market-analysis" || pathname.startsWith("/market-analysis/");
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50">
      {/* グラスモーフィズムの背景 */}
      <div className="mx-3 mb-3 rounded-2xl glass-strong border border-slate-700/40 shadow-lg shadow-black/20">
        <div className="flex items-center justify-around py-1.5">
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  relative flex flex-col items-center gap-0.5 px-4 py-2 rounded-xl
                  transition-all duration-300 press-scale
                  ${active
                    ? "text-white"
                    : "text-gray-500 hover:text-gray-300"
                  }
                `}
              >
                {/* アクティブピル背景 */}
                {active && (
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-pink-500/20 to-violet-500/20 border border-pink-500/30 animate-scale-in" />
                )}

                {/* アイコン */}
                <div className={`relative z-10 transition-transform duration-300 ${active ? "scale-110" : ""}`}>
                  {item.icon(active)}
                </div>

                {/* ラベル */}
                <span className={`relative z-10 text-[10px] font-medium tracking-wide ${active ? "neon-text" : ""}`}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

