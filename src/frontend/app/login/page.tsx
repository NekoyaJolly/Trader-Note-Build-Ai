/**
 * ログインページ（cTrader OAuth 専用）
 * 
 * cTraderアカウントでのログインのみ提供
 * email/passwordログインは廃止
 */

'use client';

import { useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { getPostLoginPath } from '@/lib/postLoginRedirect';

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();

  // 既にログイン済み: getPostLoginPath() で端末別の着地点へ
  useEffect(() => {
    if (!loading && user) {
      router.push(getPostLoginPath());
    }
  }, [user, loading, router]);

  // ローディング中
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-blue-500 border-opacity-75 mx-auto mb-4" />
          <p className="text-gray-300 text-lg">読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 px-4">
      <div className="max-w-md w-full">
        {/* ロゴ・タイトル */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="bg-blue-600 rounded-full p-4">
              <svg 
                className="h-12 w-12 text-white" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" 
                />
              </svg>
            </div>
          </div>
          <h1 className="text-4xl font-bold text-white mb-2">TradeAssist</h1>
          <p className="text-gray-300 text-lg">トレード支援プラットフォーム</p>
        </div>

        {/* ログインカード */}
        <div className="bg-gray-800 rounded-lg shadow-2xl p-8 border border-gray-700">
          <h2 className="text-2xl font-bold text-white mb-6 text-center">
            ログイン
          </h2>

          {/* cTraderログインボタン */}
          <button
            onClick={() => login()}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold py-4 px-6 rounded-lg transition duration-200 transform hover:scale-105 shadow-lg flex items-center justify-center space-x-3"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            <span>cTrader でログイン</span>
          </button>

          {/* 説明テキスト */}
          <div className="mt-6 text-center text-sm text-gray-400">
            <p className="mb-2">
              cTrader アカウントでログインして、
            </p>
            <p>
              リアルタイムチャートとトレードノートを活用しましょう
            </p>
          </div>

          {/* セキュリティ情報 */}
          <div className="mt-8 pt-6 border-t border-gray-700">
            <div className="flex items-start space-x-3 text-sm text-gray-400">
              <svg
                className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              <div>
                <p className="font-semibold text-gray-300 mb-1">
                  安全なOAuth認証
                </p>
                <p>
                  パスワードを TradeAssist に保存することはありません。
                  cTrader の公式 OAuth 経由で安全にログインします。
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* フッター */}
        <div className="mt-8 text-center text-gray-500 text-sm">
          <p>&copy; 2026 TradeAssist. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
