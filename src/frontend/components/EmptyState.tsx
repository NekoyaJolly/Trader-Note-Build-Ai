/**
 * 空状態コンポーネント
 * 
 * データがない場合や初期状態を表示する共通コンポーネント
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

import React from "react";

interface EmptyStateProps {
  /**
   * アイコン（React Node）
   */
  icon?: React.ReactNode;
  /**
   * タイトル
   */
  title: string;
  /**
   * 説明文
   */
  description?: string;
  /**
   * アクションボタン（オプション）
   */
  action?: {
    label: string;
    onClick: () => void;
  };
  /**
   * アクションリンク（オプション）
   */
  actionLink?: {
    label: string;
    href: string;
  };
}

// デフォルトのアイコン
const DefaultIcon = () => (
  <svg
    className="w-16 h-16 text-gray-500"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
    />
  </svg>
);

/**
 * 空状態表示コンポーネント
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  actionLink,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {/* アイコン */}
      <div className="mb-4 opacity-60">
        {icon || <DefaultIcon />}
      </div>

      {/* タイトル */}
      <h3 className="text-lg font-medium text-gray-300 mb-2">
        {title}
      </h3>

      {/* 説明文 */}
      {description && (
        <p className="text-sm text-gray-500 mb-6 max-w-sm">
          {description}
        </p>
      )}

      {/* アクションボタン */}
      {action && (
        <button
          onClick={action.onClick}
          className="
            px-4 py-2 rounded-lg font-medium text-sm
            bg-gradient-to-r from-pink-500 to-violet-500
            text-white
            hover:opacity-90 transition-opacity
          "
        >
          {action.label}
        </button>
      )}

      {/* アクションリンク */}
      {actionLink && (
        <a
          href={actionLink.href}
          className="
            px-4 py-2 rounded-lg font-medium text-sm
            bg-gradient-to-r from-pink-500 to-violet-500
            text-white
            hover:opacity-90 transition-opacity
          "
        >
          {actionLink.label}
        </a>
      )}
    </div>
  );
}
