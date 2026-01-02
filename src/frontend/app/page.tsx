/**
 * TradeAssist - ホーム画面（Neon Dark テーマ対応）
 * 
 * ダッシュボード機能を提供
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

import Link from "next/link";
import OnboardingIntro from "@/components/OnboardingIntro";

export default function Home() {
  return (
    <div className="min-h-screen">
      <main className="max-w-4xl w-full mx-auto px-3 sm:px-4 md:px-6 py-6 sm:py-8 md:py-12">
        {/* 初回オンボーディング（初回のみオーバーレイ表示） */}
        <OnboardingIntro />
        
        {/* ヘッダー */}
        <div className="text-center mb-6 sm:mb-8 md:mb-12">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-2 sm:mb-4">
            <span className="neon-text">TradeAssist</span>
          </h1>
          <p className="text-xs sm:text-sm md:text-lg text-gray-400">
            トレードノート自動生成システム
          </p>
        </div>

        {/* 機能カード */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6 md:mb-8">
          {/* トレード取込カード */}
          <Link
            href="/import"
            className="block card-surface p-3 sm:p-4 md:p-6 hover-glow transition-smooth"
          >
            <div className="flex items-center mb-2 sm:mb-3 md:mb-4">
              <div className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg flex items-center justify-center text-white text-base sm:text-xl md:text-2xl">
                📥
              </div>
              <h2 className="ml-2 sm:ml-3 md:ml-4 text-base sm:text-lg md:text-2xl font-semibold text-white">
                トレード取込
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-gray-400">
              CSVからトレード履歴をインポート
            </p>
          </Link>

          {/* 通知一覧カード */}
          <Link
            href="/notifications"
            className="block card-surface p-3 sm:p-4 md:p-6 hover-glow transition-smooth"
          >
            <div className="flex items-center mb-2 sm:mb-3 md:mb-4">
              <div className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 bg-gradient-to-br from-pink-500 to-violet-500 rounded-lg flex items-center justify-center text-white text-base sm:text-xl md:text-2xl">
                🔔
              </div>
              <h2 className="ml-2 sm:ml-3 md:ml-4 text-base sm:text-lg md:text-2xl font-semibold text-white">
                通知一覧
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-gray-400">
              市場一致の通知を確認
            </p>
          </Link>

          {/* トレードノートカード */}
          <Link
            href="/notes"
            className="block card-surface p-3 sm:p-4 md:p-6 hover-glow transition-smooth"
          >
            <div className="flex items-center mb-2 sm:mb-3 md:mb-4">
              <div className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center text-white text-base sm:text-xl md:text-2xl">
                📊
              </div>
              <h2 className="ml-2 sm:ml-3 md:ml-4 text-base sm:text-lg md:text-2xl font-semibold text-white">
                トレードノート
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-gray-400">
              ノート一覧とAI要約を確認
            </p>
          </Link>

          {/* 設定カード */}
          <Link
            href="/settings"
            className="block card-surface p-3 sm:p-4 md:p-6 hover-glow transition-smooth"
          >
            <div className="flex items-center mb-2 sm:mb-3 md:mb-4">
              <div className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 bg-gradient-to-br from-gray-500 to-slate-600 rounded-lg flex items-center justify-center text-white text-base sm:text-xl md:text-2xl">
                ⚙️
              </div>
              <h2 className="ml-2 sm:ml-3 md:ml-4 text-base sm:text-lg md:text-2xl font-semibold text-white">
                設定
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-gray-400">
              通知やインジケーターを設定
            </p>
          </Link>
        </div>

        {/* 説明セクション */}
        <div className="card-surface p-3 sm:p-4 md:p-6">
          <h3 className="text-sm sm:text-base md:text-xl font-semibold text-white mb-2 sm:mb-3 md:mb-4">
            システムの特徴
          </h3>
          <ul className="space-y-1.5 sm:space-y-2 md:space-y-3 text-xs sm:text-sm md:text-base text-gray-300">
            <li className="flex items-start">
              <span className="mr-2 sm:mr-3 text-green-400 flex-shrink-0">✓</span>
              <span>履歴からノートを自動生成</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2 sm:mr-3 text-green-400 flex-shrink-0">✓</span>
              <span>リアルタイム市場と一致判定</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2 sm:mr-3 text-green-400 flex-shrink-0">✓</span>
              <span>判定理由を完全可視化</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2 sm:mr-3 text-amber-400 flex-shrink-0">⚠</span>
              <span className="font-semibold">自動売買なし・判断は人間</span>
            </li>
          </ul>
        </div>

        {/* フッター */}
        <div className="text-center mt-6 sm:mt-8 md:mt-12 text-xs sm:text-sm text-gray-500">
          <p>TradeAssist MVP</p>
        </div>
      </main>
    </div>
  );
}
