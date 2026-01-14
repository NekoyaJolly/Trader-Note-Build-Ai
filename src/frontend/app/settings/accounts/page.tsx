/**
 * cTrader アカウント管理ページ
 * 
 * 機能:
 * - 接続済みcTraderアカウントの一覧表示
 * - 新規アカウント追加（複数アカウント対応）
 * - アカウント削除
 * - プライマリアカウント切り替え
 */

'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { useRouter } from 'next/navigation';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3100';

interface CTraderAccount {
  accountId: string;
  expiresAt: string;
  lastConnectedAt: string | null;
}

export default function AccountsPage() {
  const { user, refreshUser, login } = useAuth();
  const router = useRouter();
  const [accounts, setAccounts] = useState<CTraderAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // アカウント一覧を取得
  useEffect(() => {
    if (user) {
      setAccounts(user.ctraderAccounts || []);
      setLoading(false);
    }
  }, [user]);

  // 新規アカウント追加（OAuth フロー開始）
  const handleAddAccount = () => {
    login(); // AuthContext の login を使って OAuth フローを開始
  };

  // アカウント削除
  const handleDeleteAccount = async (accountId: string) => {
    if (!confirm(`アカウント ${accountId} を削除しますか？`)) {
      return;
    }

    setDeletingAccountId(accountId);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/ctrader`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accountId }),
      });

      if (response.ok) {
        // ユーザー情報を再取得してアカウント一覧を更新
        await refreshUser();
        alert('アカウントを削除しました');
      } else {
        const data = await response.json();
        setError(data.error || 'アカウント削除に失敗しました');
      }
    } catch (err) {
      console.error('アカウント削除エラー:', err);
      setError('アカウント削除に失敗しました');
    } finally {
      setDeletingAccountId(null);
    }
  };

  // プライマリアカウント切り替え（バックエンドAPIが必要）
  const handleSetPrimary = async (accountId: string) => {
    // TODO: バックエンドにプライマリアカウント変更APIを実装
    alert(`プライマリアカウント切り替え機能は未実装です。\n選択: ${accountId}`);
  };

  // 有効期限切れチェック
  const isExpired = (expiresAt: string) => {
    return new Date(expiresAt) < new Date();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-blue-500 border-opacity-75 mx-auto mb-4" />
          <p className="text-gray-300 text-lg">読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      {/* ヘッダー */}
      <div className="mb-8">
        <button
          onClick={() => router.push('/settings')}
          className="text-blue-400 hover:text-blue-300 mb-4 flex items-center"
        >
          <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          設定に戻る
        </button>
        <h1 className="text-3xl font-bold text-white mb-2">cTrader アカウント管理</h1>
        <p className="text-gray-400">
          複数の cTrader アカウントを管理できます
        </p>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="mb-6 bg-red-900/50 border border-red-700 rounded-lg p-4">
          <p className="text-red-200">{error}</p>
        </div>
      )}

      {/* アカウント一覧 */}
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 mb-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-white">接続済みアカウント</h2>
          <button
            onClick={handleAddAccount}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition duration-200 flex items-center"
          >
            <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            アカウント追加
          </button>
        </div>

        {accounts.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 mb-4">接続済みのアカウントがありません</p>
            <button
              onClick={handleAddAccount}
              className="text-blue-400 hover:text-blue-300"
            >
              最初のアカウントを追加
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {accounts.map((account) => {
              const expired = isExpired(account.expiresAt);
              const isPrimary = account.accountId === user?.primaryAccountId;

              return (
                <div
                  key={account.accountId}
                  className={`border rounded-lg p-4 ${
                    isPrimary
                      ? 'border-blue-500 bg-blue-900/20'
                      : 'border-gray-700 bg-gray-900/50'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-white">
                          {account.accountId}
                        </h3>
                        {isPrimary && (
                          <span className="bg-blue-600 text-white text-xs font-semibold px-2 py-1 rounded">
                            プライマリ
                          </span>
                        )}
                        {expired && (
                          <span className="bg-red-600 text-white text-xs font-semibold px-2 py-1 rounded">
                            期限切れ
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-400 space-y-1">
                        <p>
                          有効期限: {new Date(account.expiresAt).toLocaleString('ja-JP')}
                        </p>
                        {account.lastConnectedAt && (
                          <p>
                            最終接続: {new Date(account.lastConnectedAt).toLocaleString('ja-JP')}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      {!isPrimary && (
                        <button
                          onClick={() => handleSetPrimary(account.accountId)}
                          className="text-blue-400 hover:text-blue-300 text-sm font-semibold px-3 py-1 rounded border border-blue-400 hover:border-blue-300 transition"
                        >
                          プライマリに設定
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteAccount(account.accountId)}
                        disabled={deletingAccountId === account.accountId || isPrimary}
                        className={`text-sm font-semibold px-3 py-1 rounded transition ${
                          isPrimary
                            ? 'text-gray-600 cursor-not-allowed'
                            : 'text-red-400 hover:text-red-300 border border-red-400 hover:border-red-300'
                        }`}
                        title={isPrimary ? 'プライマリアカウントは削除できません' : ''}
                      >
                        {deletingAccountId === account.accountId ? '削除中...' : '削除'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 説明 */}
      <div className="bg-gray-800 rounded-lg shadow-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-3">アカウント管理について</h3>
        <div className="text-gray-400 text-sm space-y-2">
          <p>
            ✅ 複数の cTrader アカウントを登録できます
          </p>
          <p>
            ✅ プライマリアカウントがリアルタイム接続に使用されます
          </p>
          <p>
            ⚠️ プライマリアカウントは削除できません（他のアカウントをプライマリに設定してから削除してください）
          </p>
          <p>
            ⚠️ アカウントの有効期限が切れた場合は、再度「アカウント追加」で認証してください
          </p>
        </div>
      </div>
    </div>
  );
}
