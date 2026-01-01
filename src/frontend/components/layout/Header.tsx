"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import NotificationBell from "@/components/NotificationBell";
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

/**
 * アプリ共通ヘッダー（Neon Dark テーマ対応）
 * 
 * モバイル画面用のヘッダー
 * デスクトップではサイドバーを使用するため、ヘッダーはモバイル専用
 * インジケーター設定機能を含む（サイドバーと同等の機能）
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

// カテゴリ表示情報
const CATEGORY_DISPLAY: Record<IndicatorCategory, { label: string; color: string }> = {
  momentum: { label: 'モメンタム', color: 'text-blue-400' },
  trend: { label: 'トレンド', color: 'text-green-400' },
  volatility: { label: 'ボラティリティ', color: 'text-yellow-400' },
  volume: { label: '出来高', color: 'text-purple-400' },
};

// シェブロンアイコン
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

export default function Header() {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // インジケーター関連の状態
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const [indicators, setIndicators] = useState<IndicatorMetadata[]>([]);
  const [activeConfigs, setActiveConfigs] = useState<IndicatorConfig[]>([]);
  const [selectedIndicator, setSelectedIndicator] = useState<IndicatorMetadata | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // TODO: 実際の未読数を API から取得
  const unreadCount = 3;

  // インジケーター設定を読み込む
  const loadIndicatorData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [metadataRes, settingsRes] = await Promise.all([
        fetchIndicatorMetadata(),
        fetchIndicatorSettings(),
      ]);
      setIndicators(metadataRes.indicators);
      setActiveConfigs(settingsRes.activeSet.configs.filter(c => c.enabled));
    } catch (error) {
      console.error('インジケーター設定の読み込みエラー:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // メニューが開かれた時にデータをロード
  useEffect(() => {
    if (isMobileMenuOpen && indicators.length === 0) {
      loadIndicatorData();
    }
  }, [isMobileMenuOpen, indicators.length, loadIndicatorData]);

  // インジケーターがアクティブか判定
  const isIndicatorActive = (indicatorId: IndicatorId): boolean => {
    return activeConfigs.some(c => c.indicatorId === indicatorId);
  };

  // 指定インジケーターの設定を取得
  const getExistingConfig = (indicatorId: IndicatorId): IndicatorConfig | undefined => {
    return activeConfigs.find(c => c.indicatorId === indicatorId);
  };

  // インジケーター保存ハンドラ
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

  // インジケーター削除ハンドラ
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

  // アクティブ判定（現在のパス）
  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/";
    }
    return pathname === href || pathname?.startsWith(href + "/");
  };

  return (
    <header className="md:hidden sticky top-0 z-40 w-full border-b border-slate-700 bg-slate-900">
      <div className="px-4 py-3 flex items-center justify-between">
        {/* アプリ名（ネオンテキスト） */}
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl font-bold neon-text">TradeAssist</span>
        </Link>

        {/* モバイルメニューボタン */}
        <div className="flex items-center gap-2">
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
        <div className="border-t border-slate-700 bg-slate-800 px-4 py-2 max-h-[80vh] overflow-y-auto">
          {/* メインナビゲーション */}
          <div className="mb-3">
            <p className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              メニュー
            </p>
            <Link
              href="/"
              onClick={() => setIsMobileMenuOpen(false)}
              className={`block px-3 py-2.5 text-sm rounded-lg ${
                isActive('/') 
                  ? 'bg-gradient-to-r from-pink-500/20 to-violet-500/20 text-white border border-pink-500/30' 
                  : 'text-gray-300 hover:bg-slate-700'
              }`}
            >
              🏠 ホーム
            </Link>
            <Link
              href="/notifications"
              onClick={() => setIsMobileMenuOpen(false)}
              className={`block px-3 py-2.5 text-sm rounded-lg ${
                isActive('/notifications') 
                  ? 'bg-gradient-to-r from-pink-500/20 to-violet-500/20 text-white border border-pink-500/30' 
                  : 'text-gray-300 hover:bg-slate-700'
              }`}
            >
              🔔 通知
            </Link>
            <Link
              href="/notes"
              onClick={() => setIsMobileMenuOpen(false)}
              className={`block px-3 py-2.5 text-sm rounded-lg ${
                isActive('/notes') 
                  ? 'bg-gradient-to-r from-pink-500/20 to-violet-500/20 text-white border border-pink-500/30' 
                  : 'text-gray-300 hover:bg-slate-700'
              }`}
            >
              📋 ノート一覧
            </Link>
            <Link
              href="/import"
              onClick={() => setIsMobileMenuOpen(false)}
              className={`block px-3 py-2.5 text-sm rounded-lg ${
                isActive('/import') 
                  ? 'bg-gradient-to-r from-pink-500/20 to-violet-500/20 text-white border border-pink-500/30' 
                  : 'text-gray-300 hover:bg-slate-700'
              }`}
            >
              📥 CSVインポート
            </Link>
            <Link
              href="/backtest"
              onClick={() => setIsMobileMenuOpen(false)}
              className={`block px-3 py-2.5 text-sm rounded-lg ${
                isActive('/backtest') 
                  ? 'bg-gradient-to-r from-pink-500/20 to-violet-500/20 text-white border border-pink-500/30' 
                  : 'text-gray-300 hover:bg-slate-700'
              }`}
            >
              📊 バックテスト
            </Link>
          </div>

          {/* 分析ツール（インジケーター設定） */}
          <div className="border-t border-slate-700 pt-3 mb-3">
            <button
              onClick={() => setIndicatorMenuOpen(!indicatorMenuOpen)}
              className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-300 transition-colors"
            >
              <span className="flex items-center gap-2">
                📈 分析ツール
                {activeConfigs.length > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-cyan-500/30 text-cyan-300">
                    {activeConfigs.length}
                  </span>
                )}
              </span>
              <ChevronIcon isOpen={indicatorMenuOpen} />
            </button>
            
            {indicatorMenuOpen && (
              <div className="mt-2 space-y-2">
                {/* アクティブなインジケーター一覧 */}
                {activeConfigs.length > 0 && (
                  <div className="px-3 py-2 bg-slate-700/30 rounded-lg">
                    <p className="text-xs text-cyan-400 font-medium mb-2">
                      ✅ 有効なインジケーター
                    </p>
                    <div className="space-y-1">
                      {activeConfigs.map(config => {
                        const indicator = indicators.find(i => i.id === config.indicatorId);
                        return (
                          <button
                            key={config.indicatorId}
                            onClick={() => {
                              if (indicator) {
                                setSelectedIndicator(indicator);
                                setIsModalOpen(true);
                              }
                            }}
                            className="w-full flex items-center justify-between px-2 py-1.5 text-xs text-white bg-slate-700/50 rounded hover:bg-slate-600/50 transition-colors"
                          >
                            <span>{config.label || indicator?.displayName || config.indicatorId}</span>
                            <span 
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{
                                background: 'linear-gradient(90deg, #06b6d4, #3b82f6)',
                                boxShadow: '0 0 8px #06b6d4',
                              }}
                            />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* カテゴリ別インジケーター一覧 */}
                {isLoading ? (
                  <p className="text-xs text-gray-500 px-3 py-2">読み込み中...</p>
                ) : (
                  <div className="space-y-2">
                    {(['trend', 'momentum', 'volatility', 'volume'] as IndicatorCategory[]).map(category => {
                      const categoryIndicators = indicators.filter(i => i.category === category);
                      if (categoryIndicators.length === 0) return null;
                      
                      return (
                        <div key={category} className="px-3">
                          <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${CATEGORY_DISPLAY[category].color}`}>
                            {CATEGORY_DISPLAY[category].label}
                          </p>
                          <div className="grid grid-cols-2 gap-1">
                            {categoryIndicators.map(indicator => {
                              const isActiveIndicator = isIndicatorActive(indicator.id);
                              const config = getExistingConfig(indicator.id);
                              
                              return (
                                <button
                                  key={indicator.id}
                                  onClick={() => {
                                    setSelectedIndicator(indicator);
                                    setIsModalOpen(true);
                                  }}
                                  className={`
                                    flex items-center justify-between px-2 py-1.5 rounded text-xs
                                    transition-all duration-200
                                    ${isActiveIndicator
                                      ? "text-white bg-slate-700/70 border border-cyan-500/30"
                                      : "text-gray-400 hover:text-white bg-slate-700/30 hover:bg-slate-700/50"
                                    }
                                  `}
                                >
                                  <span className="truncate text-left">
                                    {config?.label || indicator.displayName}
                                  </span>
                                  {isActiveIndicator && (
                                    <span 
                                      className="w-1.5 h-1.5 rounded-full flex-shrink-0 ml-1"
                                      style={{
                                        background: 'linear-gradient(90deg, #06b6d4, #3b82f6)',
                                        boxShadow: '0 0 6px #06b6d4',
                                      }}
                                    />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ユーティリティ */}
          <div className="border-t border-slate-700 pt-3">
            <p className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              設定
            </p>
            <Link
              href="/settings"
              onClick={() => setIsMobileMenuOpen(false)}
              className={`block px-3 py-2.5 text-sm rounded-lg ${
                isActive('/settings') 
                  ? 'bg-gradient-to-r from-pink-500/20 to-violet-500/20 text-white border border-pink-500/30' 
                  : 'text-gray-300 hover:bg-slate-700'
              }`}
            >
              ⚙️ 設定
            </Link>
            <Link
              href="/onboarding"
              onClick={() => setIsMobileMenuOpen(false)}
              className={`block px-3 py-2.5 text-sm rounded-lg ${
                isActive('/onboarding') 
                  ? 'bg-gradient-to-r from-pink-500/20 to-violet-500/20 text-white border border-pink-500/30' 
                  : 'text-gray-300 hover:bg-slate-700'
              }`}
            >
              ⚡ オンボーディング
            </Link>
          </div>
        </div>
      )}

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
    </header>
  );
}
