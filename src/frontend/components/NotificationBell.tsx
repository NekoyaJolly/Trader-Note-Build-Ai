"use client";

/**
 * 通知ベルコンポーネント
 * 
 * ヘッダー用の未読バッジ付き通知アイコン
 * クリックで通知一覧ページへ遷移
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

import Link from "next/link";

interface NotificationBellProps {
  /**
   * 未読通知数
   */
  unreadCount?: number;
  /**
   * リンク先（デフォルト: /notifications）
   */
  href?: string;
}

/**
 * 通知ベルアイコン（未読バッジ付き）
 */
export default function NotificationBell({
  unreadCount = 0,
  href = "/notifications",
}: NotificationBellProps) {
  // 表示する未読数（99+対応）
  const displayCount = unreadCount > 99 ? "99+" : unreadCount;
  const hasUnread = unreadCount > 0;

  return (
    <Link
      href={href}
      className="relative p-2 rounded-lg hover:bg-slate-700 transition-smooth"
      aria-label={`通知 ${hasUnread ? `${unreadCount}件の未読` : ""}`}
    >
      {/* ベルアイコン */}
      <svg
        className="w-6 h-6 text-gray-300 hover:text-white transition-colors"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
        />
      </svg>

      {/* 未読バッジ */}
      {hasUnread && (
        <span
          className="
            absolute -top-0.5 -right-0.5
            min-w-[18px] h-[18px]
            flex items-center justify-center
            bg-red-500 text-white text-[10px] font-bold
            rounded-full px-1
            animate-pulse
          "
        >
          {displayCount}
        </span>
      )}
    </Link>
  );
}
