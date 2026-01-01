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
      <main className="max-w-4xl w-full mx-auto px-6 py-12">
        {/* 初回オンボーディング（初回のみオーバーレイ表示） */}
        <OnboardingIntro />
        
        {/* ヘッダー */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-white mb-4">
            <span className="neon-text">TradeAssist</span>
          </h1>
          <p className="text-lg text-gray-400">
            トレードノート自動生成 + 市場一致判定システム
          </p>
        </div>

        {/* 機能カード */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* トレード取込カード */}
          <Link
            href="/import"
            className="block card-surface p-6 hover-glow transition-smooth"
          >
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg flex items-center justify-center text-white text-2xl">
                📥
              </div>
              <h2 className="ml-4 text-2xl font-semibold text-white">
                トレード取込
              </h2>
            </div>
            <p className="text-gray-400">
              CSVファイルから過去のトレード履歴をインポートし、ノートを自動生成します。
            </p>
          </Link>

          {/* 通知一覧カード */}
          <Link
            href="/notifications"
            className="block card-surface p-6 hover-glow transition-smooth"
          >
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-gradient-to-br from-pink-500 to-violet-500 rounded-lg flex items-center justify-center text-white text-2xl">
                🔔
              </div>
              <h2 className="ml-4 text-2xl font-semibold text-white">
                通知一覧
              </h2>
            </div>
            <p className="text-gray-400">
              市場との一致判定結果を確認し、注目すべきタイミングを見逃しません。
            </p>
          </Link>

          {/* トレードノートカード */}
          <Link
            href="/notes"
            className="block card-surface p-6 hover-glow transition-smooth"
          >
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center text-white text-2xl">
                📊
              </div>
              <h2 className="ml-4 text-2xl font-semibold text-white">
                トレードノート
              </h2>
            </div>
            <p className="text-gray-400">
              生成されたノートの一覧と詳細を確認し、AI 要約をレビューします。
            </p>
          </Link>

          {/* 設定カード */}
          <Link
            href="/settings"
            className="block card-surface p-6 hover-glow transition-smooth"
          >
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-gradient-to-br from-gray-500 to-slate-600 rounded-lg flex items-center justify-center text-white text-2xl">
                ⚙️
              </div>
              <h2 className="ml-4 text-2xl font-semibold text-white">
                設定
              </h2>
            </div>
            <p className="text-gray-400">
              通知閾値、時間足、インジケーター設定などをカスタマイズします。
            </p>
          </Link>
        </div>

        {/* 説明セクション */}
        <div className="card-surface p-6">
          <h3 className="text-xl font-semibold text-white mb-4">
            システムの特徴
          </h3>
          <ul className="space-y-3 text-gray-300">
            <li className="flex items-start">
              <span className="mr-3 text-green-400">✓</span>
              <span>
                過去のトレード履歴から自動でトレードノートを生成
              </span>
            </li>
            <li className="flex items-start">
              <span className="mr-3 text-green-400">✓</span>
              <span>
                リアルタイム市場データとルールベースで一致判定
              </span>
            </li>
            <li className="flex items-start">
              <span className="mr-3 text-green-400">✓</span>
              <span>
                判定理由を完全可視化し、納得できる通知を実現
              </span>
            </li>
            <li className="flex items-start">
              <span className="mr-3 text-amber-400">⚠</span>
              <span className="font-semibold">
                自動売買は行いません。最終判断はトレーダーが行います。
              </span>
            </li>
          </ul>
        </div>

        {/* フッター */}
        <div className="text-center mt-12 text-sm text-gray-500">
          <p>TradeAssist - Phase5 UI</p>
        </div>
      </main>
    </div>
  );
}
