/**
 * FAB (Floating Action Button) コンポーネント
 * 
 * 機能:
 * - 画面右下に固定表示されるアクションボタン
 * - ネオングラデーション対応
 * - 展開可能なサブアクション（オプション）
 * - ダークモード対応 (Neon Dark テーマ)
 */
"use client";

import React, { useState } from "react";
import Link from "next/link";

// サブアクション
export interface FABAction {
  /** アクション ID */
  id: string;
  /** ラベル */
  label: string;
  /** アイコン（ReactNode） */
  icon: React.ReactNode;
  /** クリック時の処理またはリンク先 */
  onClick?: () => void;
  href?: string;
}

export interface FABProps {
  /** メインアイコン（デフォルト: + アイコン） */
  icon?: React.ReactNode;
  /** メインボタンクリック時の処理 */
  onClick?: () => void;
  /** メインボタンのリンク先 */
  href?: string;
  /** サブアクション一覧（展開可能） */
  actions?: FABAction[];
  /** ツールチップラベル */
  label?: string;
  /** 位置 */
  position?: "bottom-right" | "bottom-left" | "bottom-center";
  /** 追加の CSS クラス */
  className?: string;
}

/**
 * デフォルトのプラスアイコン
 */
function PlusIcon() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

/**
 * ポジションに応じた CSS クラス
 */
const positionClasses: Record<string, string> = {
  "bottom-right": "bottom-20 right-4 md:bottom-6 md:right-6",
  "bottom-left": "bottom-20 left-4 md:bottom-6 md:left-6",
  "bottom-center": "bottom-20 left-1/2 -translate-x-1/2 md:bottom-6",
};

/**
 * FAB コンポーネント
 * 
 * フローティングアクションボタン
 * - シンプルなクリック/リンク
 * - 展開可能なサブアクション
 */
export default function FAB({
  icon,
  onClick,
  href,
  actions,
  label,
  position = "bottom-right",
  className = "",
}: FABProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasActions = actions && actions.length > 0;

  // メインボタンのクリック処理
  function handleMainClick() {
    if (hasActions) {
      setIsExpanded(!isExpanded);
    } else if (onClick) {
      onClick();
    }
  }

  // メインボタンの内容
  const mainButtonContent = (
    <>
      <span
        className={`transition-transform duration-300 ${
          isExpanded ? "rotate-45" : ""
        }`}
      >
        {icon || <PlusIcon />}
      </span>
      {/* ツールチップ（ホバー時） */}
      {label && !isExpanded && (
        <span className="absolute right-full mr-3 px-2 py-1 text-sm text-white bg-slate-800 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          {label}
        </span>
      )}
    </>
  );

  // メインボタンのスタイル
  const mainButtonStyles = `
    group relative w-14 h-14 rounded-full
    bg-gradient-to-r from-pink-500 to-violet-500
    text-white shadow-lg
    flex items-center justify-center
    transition-all duration-300
    hover:shadow-[0_0_30px_rgba(236,72,153,0.5)]
    focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-slate-900
    active:scale-95
  `;

  return (
    <div className={`fixed ${positionClasses[position]} z-50 ${className}`}>
      {/* サブアクション（展開時） */}
      {hasActions && (
        <div
          className={`absolute bottom-16 right-0 space-y-2 transition-all duration-300 ${
            isExpanded
              ? "opacity-100 translate-y-0 pointer-events-auto"
              : "opacity-0 translate-y-4 pointer-events-none"
          }`}
        >
          {actions.map((action) => {
            const actionContent = (
              <div className="flex items-center gap-3">
                {/* ラベル */}
                <span className="px-3 py-1.5 text-sm text-white bg-slate-800 rounded-lg whitespace-nowrap shadow-lg">
                  {action.label}
                </span>
                {/* アイコンボタン */}
                <span className="w-12 h-12 rounded-full bg-slate-700 text-white flex items-center justify-center shadow-lg hover:bg-slate-600 transition-colors">
                  {action.icon}
                </span>
              </div>
            );

            if (action.href) {
              return (
                <Link
                  key={action.id}
                  href={action.href}
                  onClick={() => setIsExpanded(false)}
                  className="block"
                >
                  {actionContent}
                </Link>
              );
            }

            return (
              <button
                key={action.id}
                type="button"
                onClick={() => {
                  action.onClick?.();
                  setIsExpanded(false);
                }}
                className="block w-full"
              >
                {actionContent}
              </button>
            );
          })}
        </div>
      )}

      {/* メインボタン */}
      {href && !hasActions ? (
        <Link href={href} className={mainButtonStyles}>
          {mainButtonContent}
        </Link>
      ) : (
        <button
          type="button"
          onClick={handleMainClick}
          className={mainButtonStyles}
          aria-label={label || "アクション"}
          aria-expanded={isExpanded}
        >
          {mainButtonContent}
        </button>
      )}

      {/* オーバーレイ（展開時） */}
      {hasActions && isExpanded && (
        <div
          className="fixed inset-0 -z-10"
          onClick={() => setIsExpanded(false)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
