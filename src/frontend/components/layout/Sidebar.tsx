"use client";

/**
 * サイドバーナビゲーションコンポーネント
 * 
 * アコーディオン式カテゴリ分け:
 * - Side-A: トレードノート関連
 * - Side-B: AI アシスタント関連
 * - Strategies: 戦略・分析ツール
 * - Settings: アプリ設定
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import {
  Home,
  FileText,
  Upload,
  Bell,
  Bot,
  Brain,
  TrendingUp,
  Target,
  Activity,
  BarChart3,
  Database,
  Settings,
  ChevronRight,
  X,
  Sparkles,
  Plus,
  User,
  LineChart,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import IndicatorConfigModal from "@/components/IndicatorConfigModal";
import {
  fetchIndicatorSettings,
  fetchIndicatorMetadata,
  saveIndicatorConfig,
  deleteIndicatorConfig,
} from "@/lib/api";
import type {
  IndicatorMetadata,
  IndicatorConfig,
  IndicatorParams,
  IndicatorId,
  IndicatorCategory,
} from "@/types/indicator";

// ============================================
// 型定義
// ============================================

/** ナビゲーションアイテム */
interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  color?: string;
  children?: NavItem[];
}

/** カテゴリ定義 */
interface NavCategory {
  id: string;
  label: string;
  color: string;
  items: NavItem[];
  defaultOpen?: boolean;
}

// ============================================
// ナビゲーション構造定義
// ============================================

const topNavItems: NavItem[] = [
  {
    href: "/",
    label: "HOME",
    icon: Home,
    color: "cyan",
  },
];

const navCategories: NavCategory[] = [
  {
    id: "side-a",
    label: "Side-A",
    color: "cyan",
    defaultOpen: true,
    items: [
      {
        href: "/notes",
        label: "トレードノート",
        icon: FileText,
        color: "cyan",
        children: [
          { href: "/notes", label: "一覧", icon: FileText, color: "cyan" },
          { href: "/import", label: "インポート", icon: Upload, color: "cyan" },
          { href: "/notifications", label: "通知", icon: Bell, color: "cyan" },
        ],
      },
    ],
  },
  {
    id: "side-b",
    label: "Side-B",
    color: "purple",
    defaultOpen: false,
    items: [
      {
        href: "/side-b",
        label: "AIダッシュボード",
        icon: Bot,
        color: "purple",
        children: [
          { href: "/side-b", label: "ダッシュボード", icon: Bot, color: "purple" },
          { href: "/side-b/ai-notes", label: "AIノート", icon: Brain, color: "purple" },
          { href: "/side-b/trades", label: "仮想トレード", icon: TrendingUp, color: "purple" },
          { href: "/side-b/strategies", label: "AI戦略", icon: Sparkles, color: "purple" },
        ],
      },
    ],
  },
  {
    id: "strategies",
    label: "Strategies",
    color: "green",
    defaultOpen: false,
    items: [
      {
        href: "/strategies",
        label: "ストラテジー",
        icon: Target,
        color: "green",
        children: [
          { href: "/strategies", label: "一覧", icon: Target, color: "green" },
          { href: "/strategies/new", label: "新規作成", icon: Plus, color: "green" },
          { href: "#indicators", label: "インジケーター", icon: Activity, color: "green" },
        ],
      },
      {
        href: "/market-analysis",
        label: "マーケット分析",
        icon: LineChart,
        color: "green",
      },
      {
        href: "/backtest",
        label: "バックテスト",
        icon: BarChart3,
        color: "green",
      },
      {
        href: "/data-presets",
        label: "ヒストリカルデータ",
        icon: Database,
        color: "green",
      },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    color: "slate",
    defaultOpen: false,
    items: [
      {
        href: "/settings",
        label: "設定",
        icon: Settings,
        color: "slate",
        children: [
          { href: "/settings", label: "アプリ設定", icon: Settings, color: "slate" },
          { href: "/settings/profiles", label: "プロファイル", icon: User, color: "slate" },
        ],
      },
    ],
  },
];

// カテゴリ別のネオンカラー設定
const CATEGORY_COLORS: Record<string, {
  bg: string;
  border: string;
  text: string;
  textHover: string;
  glow: string;
}> = {
  cyan: {
    bg: "from-cyan-500/20 to-blue-500/20",
    border: "border-cyan-500/40",
    text: "text-cyan-400",
    textHover: "group-hover:text-cyan-300",
    glow: "shadow-[0_0_10px_rgba(6,182,212,0.3)]",
  },
  purple: {
    bg: "from-purple-500/20 to-pink-500/20",
    border: "border-purple-500/40",
    text: "text-purple-400",
    textHover: "group-hover:text-purple-300",
    glow: "shadow-[0_0_10px_rgba(168,85,247,0.3)]",
  },
  green: {
    bg: "from-green-500/20 to-emerald-500/20",
    border: "border-green-500/40",
    text: "text-green-400",
    textHover: "group-hover:text-green-300",
    glow: "shadow-[0_0_10px_rgba(34,197,94,0.3)]",
  },
  slate: {
    bg: "from-slate-500/20 to-gray-500/20",
    border: "border-slate-500/40",
    text: "text-slate-400",
    textHover: "group-hover:text-slate-300",
    glow: "shadow-[0_0_10px_rgba(100,116,139,0.3)]",
  },
};

// インジケーターカテゴリ表示
const INDICATOR_CATEGORY_DISPLAY: Record<IndicatorCategory, { label: string; color: string }> = {
  momentum: { label: 'モメンタム', color: 'text-blue-400' },
  trend: { label: 'トレンド', color: 'text-green-400' },
  volatility: { label: 'ボラティリティ', color: 'text-yellow-400' },
  volume: { label: '出来高', color: 'text-purple-400' },
};

// ============================================
// サイドバーコンポーネント
// ============================================

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  // カテゴリの展開状態
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    navCategories.forEach(cat => {
      initial[cat.id] = cat.defaultOpen ?? false;
    });
    return initial;
  });

  // 子メニューの展開状態
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({
    "/notes": false,
  });

  // インジケーター関連
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const [indicators, setIndicators] = useState<IndicatorMetadata[]>([]);
  const [activeConfigs, setActiveConfigs] = useState<IndicatorConfig[]>([]);
  const [selectedIndicator, setSelectedIndicator] = useState<IndicatorMetadata | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // インジケーター設定を読み込む
  const loadIndicatorData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [metadataRes, settingsRes] = await Promise.allSettled([
        fetchIndicatorMetadata(),
        fetchIndicatorSettings(),
      ]);

      // メタデータの処理（成功時のみ）
      if (metadataRes.status === 'fulfilled') {
        setIndicators(metadataRes.value.indicators);
      } else {
        console.warn('インジケーターメタデータの取得に失敗（フロントエンド定義を使用）:', metadataRes.reason);
        // フロントエンド定義を使用
        const { INDICATOR_DEFINITIONS } = await import('@/lib/indicatorDefinitions');
        setIndicators(INDICATOR_DEFINITIONS.map(def => ({
          id: def.id,
          name: def.name,
          category: def.category,
          description: def.description || '',
          defaultParams: def.defaultParams,
          paramDescriptions: def.paramDescriptions,
          paramConstraints: {} as any,
        })) as any);
      }

      // 設定の処理（成功時のみ）
      if (settingsRes.status === 'fulfilled') {
        setActiveConfigs(settingsRes.value.activeSet.configs.filter(c => c.enabled));
      } else {
        console.warn('インジケーター設定の取得に失敗:', settingsRes.reason);
        setActiveConfigs([]);
      }
    } catch (error) {
      console.error('インジケーター設定の読み込みエラー:', error);
      // エラーが発生してもUIは表示できるようにする
      setIndicators([]);
      setActiveConfigs([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIndicatorData();
  }, [loadIndicatorData]);

  // アクティブ判定
  const isActive = (href: string) => {
    if (href === "/" || href.startsWith("#")) {
      return pathname === href || pathname === "/";
    }
    return pathname === href || pathname?.startsWith(href + "/");
  };

  // インジケーターがアクティブか
  const isIndicatorActive = (indicatorId: IndicatorId): boolean => {
    return activeConfigs.some(c => c.indicatorId === indicatorId);
  };

  // 既存のコンフィグを取得
  const getExistingConfig = (indicatorId: IndicatorId): IndicatorConfig | undefined => {
    return activeConfigs.find(c => c.indicatorId === indicatorId);
  };

  // インジケーター保存
  const handleSaveIndicator = async (params: IndicatorParams) => {
    if (!selectedIndicator) return;
    try {
      await saveIndicatorConfig({
        indicatorId: selectedIndicator.id,
        params,
        enabled: true,
      });
      await loadIndicatorData();
      setIsModalOpen(false);
      setSelectedIndicator(null);
    } catch (error) {
      console.error('インジケーター保存エラー:', error);
      alert('インジケーターの保存に失敗しました');
    }
  };

  // インジケーター削除
  const handleDeleteIndicator = async () => {
    if (!selectedIndicator) return;
    try {
      await deleteIndicatorConfig(selectedIndicator.id);
      await loadIndicatorData();
      setIsModalOpen(false);
      setSelectedIndicator(null);
    } catch (error) {
      console.error('インジケーター削除エラー:', error);
      alert('インジケーターの削除に失敗しました');
    }
  };

  // カテゴリ展開トグル
  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [categoryId]: !prev[categoryId],
    }));
  };

  // 子メニュー展開トグル
  const toggleMenu = (href: string) => {
    setExpandedMenus(prev => ({
      ...prev,
      [href]: !prev[href],
    }));
  };

  // ナビクリック時にサイドバーを閉じる
  const handleNavClick = () => {
    onClose?.();
  };

  // ナビアイテムのレンダリング
  const renderNavItem = (item: NavItem, categoryColor: string, depth = 0) => {
    const active = isActive(item.href);
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedMenus[item.href];
    const colors = CATEGORY_COLORS[item.color || categoryColor];
    const Icon = item.icon;

    // インジケーターは特別処理
    if (item.href === "#indicators") {
      const isCompact = depth > 0;
      return (
        <div key={item.href} className="w-full">
          <button
            onClick={() => setIndicatorMenuOpen(!indicatorMenuOpen)}
            className={`
              w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg
              ${isCompact ? "text-xs" : "text-sm"} font-medium transition-all duration-200 group
              ${indicatorMenuOpen || activeConfigs.length > 0
                ? `bg-gradient-to-r ${colors.bg} text-white border ${colors.border} ${colors.glow}`
                : "text-gray-400 hover:bg-slate-700/50 hover:text-white"
              }
            `}
          >
            <div className="flex items-center gap-2">
              <Icon
                className={`w-4 h-4 ${indicatorMenuOpen || activeConfigs.length > 0 ? colors.text : `text-gray-500 ${colors.textHover}`}`}
                strokeWidth={1.5}
              />
              <span className="flex items-center gap-2">
                インジケーター
                {activeConfigs.length > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-green-500/30 text-green-300">
                    {activeConfigs.length}
                  </span>
                )}
              </span>
            </div>
            <ChevronRight
              className={`w-4 h-4 transition-transform duration-200 ${indicatorMenuOpen ? "rotate-90" : ""}`}
              strokeWidth={1.5}
            />
          </button>

          {/* インジケーター一覧 */}
          {indicatorMenuOpen && (
            <div className="mt-1 ml-4 border-l border-slate-700 pl-2 space-y-1 max-h-48 overflow-y-auto">
              {isLoading ? (
                <p className="text-xs text-gray-500 px-3 py-2">読み込み中...</p>
              ) : (
                (['trend', 'momentum', 'volatility', 'volume'] as IndicatorCategory[]).map(category => {
                  const categoryIndicators = indicators.filter(i => i.category === category);
                  if (categoryIndicators.length === 0) return null;

                  return (
                    <div key={category} className="mb-2">
                      <p className={`px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${INDICATOR_CATEGORY_DISPLAY[category].color}`}>
                        {INDICATOR_CATEGORY_DISPLAY[category].label}
                      </p>
                      {categoryIndicators.map(indicator => {
                        const isActiveInd = isIndicatorActive(indicator.id);
                        const config = getExistingConfig(indicator.id);

                        return (
                          <button
                            key={indicator.id}
                            onClick={() => {
                              setSelectedIndicator(indicator);
                              setIsModalOpen(true);
                            }}
                            className={`
                              w-full flex items-center justify-between px-2 py-1 rounded
                              text-xs transition-all duration-200
                              ${isActiveInd
                                ? "text-white bg-slate-700/50"
                                : "text-gray-400 hover:text-white hover:bg-slate-700/30"
                              }
                            `}
                          >
                            <span className="truncate">
                              {config?.label || indicator.displayName}
                            </span>
                            {isActiveInd && (
                              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      );
    }

    // 子メニューを持つ場合
    if (hasChildren) {
      const isChildActive = item.children?.some(child => isActive(child.href));

      return (
        <div key={item.href} className="w-full">
          <div
            className="flex items-stretch rounded-lg border border-slate-700/60 bg-slate-800/50 overflow-hidden"
          >
            <Link
              href={item.href}
              onClick={handleNavClick}
              className={`
                flex-1 flex items-center gap-2 px-3 py-2
                text-sm font-medium transition-all duration-200 group
                ${active || isChildActive
                  ? "text-white bg-slate-800/80"
                  : "text-gray-400 hover:bg-slate-800/60 hover:text-white"
                }
              `}
            >
              <Icon
                className={`w-4 h-4 ${active || isChildActive ? colors.text : `text-gray-500 ${colors.textHover}`}`}
                strokeWidth={1.5}
              />
              <span>{item.label}</span>
            </Link>
            <button
              onClick={() => toggleMenu(item.href)}
              className={`
                px-2 py-2 flex items-center justify-center transition-all duration-200
                ${active || isChildActive
                  ? "text-white bg-slate-800/80"
                  : "text-gray-400 hover:bg-slate-800/60 hover:text-white"
                }
              `}
            >
              <ChevronRight
                className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                strokeWidth={1.5}
              />
            </button>
          </div>

          {isExpanded && (
            <div className="mt-1 ml-4 border-l border-slate-700 pl-2 space-y-1">
              {item.children?.map(child => renderNavItem(child, categoryColor, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    // 単独リンク
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={handleNavClick}
        className={`
          flex items-center gap-2 px-3 py-2 rounded-lg
          text-sm font-medium transition-all duration-200 group
          ${active
            ? `bg-gradient-to-r ${colors.bg} text-white border ${colors.border} ${colors.glow}`
            : "text-gray-400 hover:bg-slate-700/50 hover:text-white"
          }
          ${depth > 0 ? "text-xs" : ""}
        `}
      >
        <Icon
          className={`w-4 h-4 ${active ? colors.text : `text-gray-500 ${colors.textHover}`}`}
          strokeWidth={1.5}
        />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <>
      {/* オーバーレイ */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity duration-300 animate-fade-in"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* サイドバー */}
      <aside
        className={`
          fixed top-0 left-0 z-50
          h-screen w-72
          flex flex-col
          glass-strong border-r border-slate-700/30
          transform transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700/30">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-purple-500 flex items-center justify-center shadow-lg shadow-cyan-500/30 animate-pulse-glow">
              <span className="text-white text-sm font-bold">T</span>
            </div>
            <span className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              TradeAssist
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-slate-700/50 transition-all duration-200 press-scale"
            aria-label="閉じる"
          >
            <X className="w-5 h-5" strokeWidth={1.5} />
          </button>
        </div>

        {/* ナビゲーション */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-2 scrollbar-thin">
          {/* トップレベル（HOME） */}
          {topNavItems.map(item => {
            const active = isActive(item.href);
            const colors = CATEGORY_COLORS[item.color || "cyan"];
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={handleNavClick}
                className={`
                  flex items-center gap-2 px-3 py-2 rounded-lg
                  text-sm font-medium transition-all duration-200 group
                  ${active
                    ? `bg-gradient-to-r ${colors.bg} text-white border ${colors.border} ${colors.glow}`
                    : "text-gray-200 hover:bg-slate-800/50 hover:text-white"
                  }
                `}
              >
                <Icon
                  className={`w-4 h-4 ${active ? colors.text : "text-gray-400"}`}
                  strokeWidth={1.5}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}

          {navCategories.map(category => {
            const colors = CATEGORY_COLORS[category.color];
            const isExpanded = expandedCategories[category.id];

            return (
              <div key={category.id} className="space-y-1">
                {/* カテゴリヘッダー */}
                <button
                  onClick={() => toggleCategory(category.id)}
                  className={`
                    w-full flex items-center justify-between px-3 py-2 rounded-lg
                    text-xs font-semibold uppercase tracking-wider
                    transition-all duration-200 border
                    ${isExpanded
                      ? `${colors.text} bg-gradient-to-r ${colors.bg} ${colors.border} ${colors.glow}`
                      : `text-gray-400 border-slate-700/50 bg-slate-800/30 hover:bg-slate-700/50 hover:${colors.text} shadow-[0_0_8px_rgba(100,116,139,0.15)]`
                    }
                  `}
                >
                  <span>{category.label}</span>
                  <ChevronRight
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                    strokeWidth={2}
                  />
                </button>

                {/* カテゴリアイテム */}
                {isExpanded && (
                  <div className="space-y-1 pl-1">
                    {category.items.map(item => renderNavItem(item, category.color))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* フッター: ユーザー情報 + ログアウト */}
        <div className="p-4 border-t border-slate-700/30 space-y-2">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl glass-surface group hover:border-slate-600/60 transition-all duration-200">
            <div className="w-8 h-8 rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 flex items-center justify-center shadow-md shadow-cyan-500/20">
              <span className="text-white text-xs font-bold">
                {(user?.displayName || 'T').charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.displayName || 'Trader'}</p>
              <p className="text-[10px] text-gray-500">{user?.email || 'cTrader Account'}</p>
            </div>
          </div>
          {user && (
            <button
              onClick={async () => {
                onClose?.();
                await logout();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all duration-200 group press-scale"
            >
              <LogOut className="w-4 h-4 text-red-500 group-hover:text-red-400" strokeWidth={1.5} />
              <span>ログアウト</span>
            </button>
          )}
        </div>
      </aside>

      {/* インジケーター設定モーダル */}
      {isModalOpen && selectedIndicator && (
        <IndicatorConfigModal
          indicator={selectedIndicator}
          existingConfig={getExistingConfig(selectedIndicator.id)}
          onSave={handleSaveIndicator}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedIndicator(null);
          }}
          onDelete={isIndicatorActive(selectedIndicator.id) ? handleDeleteIndicator : undefined}
        />
      )}
    </>
  );
}
