/**
 * TradeAssist MVP - ホーム画面
 * Phase5 通知・判定可視化システム
 */

import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <main className="max-w-4xl w-full mx-auto px-6 py-12">
        {/* ヘッダー */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            TradeAssist MVP
          </h1>
          <p className="text-lg text-gray-600">
            トレードノート自動生成 + 市場一致判定システム
          </p>
        </div>

        {/* 機能カード */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* 通知一覧カード */}
          <Link
            href="/notifications"
            className="block bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow"
          >
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-blue-500 rounded-lg flex items-center justify-center text-white text-2xl">
                🔔
              </div>
              <h2 className="ml-4 text-2xl font-semibold text-gray-800">
                通知一覧
              </h2>
            </div>
            <p className="text-gray-600">
              市場との一致判定結果を確認し、注目すべきタイミングを見逃しません。
            </p>
          </Link>

          {/* トレードノートカード */}
          <Link
            href="/notes"
            className="block bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow"
          >
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-gray-500 rounded-lg flex items-center justify-center text-white text-2xl">
                📊
              </div>
              <h2 className="ml-4 text-2xl font-semibold text-gray-800">
                トレードノート
              </h2>
            </div>
            <p className="text-gray-600">
              生成されたノートの一覧と詳細を確認し、AI 要約をレビューします。
            </p>
          </Link>
        </div>

        {/* 説明セクション */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-xl font-semibold text-gray-800 mb-4">
            システムの特徴
          </h3>
          <ul className="space-y-3 text-gray-700">
            <li className="flex items-start">
              <span className="mr-3 text-green-500">✓</span>
              <span>
                過去のトレード履歴から自動でトレードノートを生成
              </span>
            </li>
            <li className="flex items-start">
              <span className="mr-3 text-green-500">✓</span>
              <span>
                リアルタイム市場データとルールベースで一致判定
              </span>
            </li>
            <li className="flex items-start">
              <span className="mr-3 text-green-500">✓</span>
              <span>
                判定理由を完全可視化し、納得できる通知を実現
              </span>
            </li>
            <li className="flex items-start">
              <span className="mr-3 text-blue-500">⚠</span>
              <span className="font-semibold">
                自動売買は行いません。最終判断はトレーダーが行います。
              </span>
            </li>
          </ul>
        </div>

        {/* フッター */}
        <div className="text-center mt-12 text-sm text-gray-500">
          <p>TradeAssist MVP - Phase5 UI</p>
        </div>
      </main>
    </div>
  );
}
