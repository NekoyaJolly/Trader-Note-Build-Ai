"use client";

/**
 * サイドバーナビゲーションコンポーネント
 * 
 * デスクトップ画面で表示される固定サイドバー
 * プロジェクト内の全ページへの遷移を提供
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

// ナビゲーションアイテムの型定義
interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  description?: string;
  children?: NavItem[];
}

// SVGアイコンコンポーネント
const HomeIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
  </svg>
);

const NoteIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

const NotificationIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
  </svg>
);

const ImportIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
);

const SettingsIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const OnboardingIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);

const ChartIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

const SearchIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const ChevronIcon = ({ isOpen }: { isOpen: boolean }) => (
  <svg 
    className={`w-4 h-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} 
    fill="none" 
    stroke="currentColor" 
    viewBox="0 0 24 24"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

// ナビゲーション構造定義
const navItems: NavItem[] = [
  {
    href: "/",
    label: "ホーム",
    icon: <HomeIcon />,
    description: "ダッシュボード",
  },
  {
    href: "/notes",
    label: "トレードノート",
    icon: <NoteIcon />,
    description: "ノート一覧・管理",
    children: [
      {
        href: "/notes",
        label: "ノート一覧",
        icon: <NoteIcon />,
      },
      {
        href: "/import",
        label: "インポート",
        icon: <ImportIcon />,
        description: "CSVからトレードを取り込み",
      },
    ],
  },
  {
    href: "/notifications",
    label: "通知",
    icon: <NotificationIcon />,
    description: "マッチング通知",
  },
  {
    href: "/settings",
    label: "設定",
    icon: <SettingsIcon />,
    description: "アプリ設定",
  },
  {
    href: "/onboarding",
    label: "オンボーディング",
    icon: <OnboardingIcon />,
    description: "初期設定ウィザード",
  },
];

// サイドバーの状態を管理するコンテキスト用（オプション）
interface SidebarProps {
  isCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

/**
 * サイドバーナビゲーション
 * デスクトップ画面（md以上）で表示
 */
export default function Sidebar({ isCollapsed = false, onCollapsedChange }: SidebarProps) {
  const pathname = usePathname();
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({
    "/notes": true, // デフォルトで展開
  });

  // アクティブ判定
  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/";
    }
    return pathname === href || pathname?.startsWith(href + "/");
  };

  // 子メニュー展開トグル
  const toggleMenu = (href: string) => {
    setExpandedMenus(prev => ({
      ...prev,
      [href]: !prev[href],
    }));
  };

  // ナビアイテムのレンダリング
  const renderNavItem = (item: NavItem, depth = 0) => {
    const active = isActive(item.href);
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedMenus[item.href];

    // 子メニューのいずれかがアクティブか
    const isChildActive = hasChildren && item.children?.some(child => isActive(child.href));

    return (
      <div key={item.href} className="w-full">
        {hasChildren ? (
          // 子メニューを持つ場合はボタン
          <>
            <button
              onClick={() => toggleMenu(item.href)}
              className={`
                w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg
                text-sm font-medium transition-smooth group
                ${active || isChildActive
                  ? "bg-gradient-to-r from-pink-500/20 to-violet-500/20 text-white border border-pink-500/30"
                  : "text-gray-300 hover:bg-slate-700/50 hover:text-white"
                }
                ${depth > 0 ? "pl-10" : ""}
              `}
            >
              <div className="flex items-center gap-3">
                <span className={`${active || isChildActive ? "text-pink-400" : "text-gray-400 group-hover:text-gray-300"}`}>
                  {item.icon}
                </span>
                {!isCollapsed && <span>{item.label}</span>}
              </div>
              {!isCollapsed && <ChevronIcon isOpen={isExpanded || false} />}
            </button>
            
            {/* 子メニュー */}
            {!isCollapsed && isExpanded && (
              <div className="mt-1 ml-4 border-l border-slate-700 pl-2 space-y-1">
                {item.children?.map(child => renderNavItem(child, depth + 1))}
              </div>
            )}
          </>
        ) : (
          // 単独リンク
          <Link
            href={item.href}
            className={`
              flex items-center gap-3 px-3 py-2.5 rounded-lg
              text-sm font-medium transition-smooth group
              ${active
                ? "bg-gradient-to-r from-pink-500/20 to-violet-500/20 text-white border border-pink-500/30"
                : "text-gray-300 hover:bg-slate-700/50 hover:text-white"
              }
              ${depth > 0 ? "pl-6" : ""}
            `}
          >
            <span className={`${active ? "text-pink-400" : "text-gray-400 group-hover:text-gray-300"}`}>
              {item.icon}
            </span>
            {!isCollapsed && (
              <div className="flex flex-col">
                <span>{item.label}</span>
                {item.description && depth === 0 && (
                  <span className="text-xs text-gray-500">{item.description}</span>
                )}
              </div>
            )}
            
            {/* アクティブインジケーター */}
            {active && (
              <div className="absolute left-0 w-1 h-8 bg-gradient-to-b from-pink-500 to-violet-500 rounded-r-full" />
            )}
          </Link>
        )}
      </div>
    );
  };

  return (
    <aside 
      className={`
        hidden md:flex flex-col fixed top-0 left-0 z-40
        h-screen bg-slate-900 border-r border-slate-700
        transition-all duration-300 ease-in-out
        ${isCollapsed ? "w-16" : "w-64"}
      `}
    >
      {/* ロゴ部分 */}
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <Link href="/" className="flex items-center gap-2">
          {!isCollapsed && (
            <span className="text-xl font-bold neon-text">TradeAssist</span>
          )}
          {isCollapsed && (
            <span className="text-xl font-bold neon-text">TA</span>
          )}
        </Link>
        
        {/* 折りたたみボタン */}
        <button
          onClick={() => onCollapsedChange?.(!isCollapsed)}
          className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-slate-700 transition-smooth"
          aria-label={isCollapsed ? "サイドバーを展開" : "サイドバーを折りたたみ"}
        >
          <svg 
            className={`w-5 h-5 transition-transform ${isCollapsed ? "rotate-180" : ""}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* ナビゲーション */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {/* メインナビゲーション */}
        <div className="space-y-1">
          {!isCollapsed && (
            <p className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              メインメニュー
            </p>
          )}
          {navItems.slice(0, 4).map(item => renderNavItem(item))}
        </div>

        {/* ユーティリティ */}
        <div className="pt-4 mt-4 border-t border-slate-700 space-y-1">
          {!isCollapsed && (
            <p className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              ユーティリティ
            </p>
          )}
          {navItems.slice(4).map(item => renderNavItem(item))}
        </div>
      </nav>

      {/* フッター情報 */}
      {!isCollapsed && (
        <div className="p-4 border-t border-slate-700">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-800/50">
            <div className="w-8 h-8 rounded-full bg-gradient-to-r from-pink-500 to-violet-500 flex items-center justify-center">
              <span className="text-white text-sm font-bold">T</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">Trader</p>
              <p className="text-xs text-gray-400 truncate">MVP Version</p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
