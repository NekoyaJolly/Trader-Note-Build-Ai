"use client";

import NotificationBell from "@/components/NotificationBell";

/**
 * アプリ共通ヘッダー
 * 
 * サイドバーが全デバイスで表示されるようになったため、
 * ヘッダーは通知ベル専用のシンプルな固定バーとして機能
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */
export default function Header() {
  // TODO: 実際の未読数を API から取得
  const unreadCount = 3;

  return (
    <header className="sticky top-0 z-30 w-full border-b border-slate-700 bg-slate-900/95 backdrop-blur-sm">
      <div className="flex items-center justify-end px-4 py-3">
        {/* 通知ベル */}
        <NotificationBell unreadCount={unreadCount} />
      </div>
    </header>
  );
}
