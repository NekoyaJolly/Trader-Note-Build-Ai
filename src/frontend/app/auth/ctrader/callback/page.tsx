/**
 * cTrader OAuth Callback ページ
 * 
 * 目的: cTrader からの認証コールバックを処理し、バックエンド API に code を転送
 * 
 * フロー:
 * 1. cTrader が ?code=xxx&state=yyy で リダイレクト
 * 2. このページで code を取得
 * 3. バックエンド API /api/auth/ctrader/callback に POST
 * 4. 成功したら /settings?ctrader=connected にリダイレクト
 * 5. 失敗したら /settings?ctrader=error にリダイレクト
 */

'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { isBrowserLocalDevOrigin } from '@/lib/isLocalDevOrigin';
import { resolvePostLoginRedirect } from '@/lib/postLoginRedirect';
import { getPublicApiBaseUrl } from '@/lib/publicApiBaseUrl';

/**
 * Callback 処理コンポーネント（useSearchParams 使用）
 */
function CallbackHandler() {
  const router = useRouter();
  const { setUser, saveToken } = useAuth();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [message, setMessage] = useState('cTrader 認証を処理中...');
  // React Strict Mode での二重実行を防止
  const isProcessingRef = useRef(false);

  useEffect(() => {
    const handleCallback = async () => {
      // 既に処理中なら重複実行しない（OAuth code は一度限り有効）
      if (isProcessingRef.current) {
        console.log('[Callback] 既に処理中のためスキップ');
        return;
      }
      isProcessingRef.current = true;
      // URL パラメータから code と state を取得
      const code = searchParams.get('code');
      // OAuth state: ログイン開始時に AuthContext が渡した社内パス（未指定時は null）
      const oauthState = searchParams.get('state');
      const error = searchParams.get('error');
      const errorDescription = searchParams.get('error_description');

      // cTrader からエラーが返された場合
      if (error) {
        console.error('cTrader 認証エラー:', error, errorDescription);
        setStatus('error');
        setMessage(`認証エラー: ${errorDescription || error}`);
        setTimeout(() => {
          router.push(`/settings?ctrader=error&message=${encodeURIComponent(errorDescription || error)}`);
        }, 2000);
        return;
      }

      // code がない場合
      if (!code) {
        setStatus('error');
        setMessage('認証コードが見つかりません');
        setTimeout(() => {
          router.push('/settings?ctrader=error&message=no_code');
        }, 2000);
        return;
      }

      try {
        // バックエンド API に code を送信してトークン交換
        console.log('[Callback] トークン交換開始:', {
          apiUrl: `${getPublicApiBaseUrl()}/api/auth/ctrader/callback`,
          codeLength: code.length,
        });

        const localOAuth = isBrowserLocalDevOrigin();
        const callbackRedirectUri = localOAuth
          ? `${window.location.origin}/auth/ctrader/callback`
          : undefined;
        const response = await fetch(`${getPublicApiBaseUrl()}/api/auth/ctrader/callback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include', // Cookie を受け取る
          body: JSON.stringify(
            callbackRedirectUri ? { code, redirect_uri: callbackRedirectUri } : { code },
          ),
        });

        console.log('[Callback] APIレスポンス:', {
          status: response.status,
          statusText: response.statusText,
          headers: {
            contentType: response.headers.get('content-type'),
            setCookie: response.headers.get('set-cookie'),
          },
        });

        const data = await response.json();
        console.log('[Callback] レスポンスデータ:', {
          success: data.success,
          hasUser: !!data.user,
          error: data.error,
        });

        if (response.ok && data.success) {
          // JWT トークンを localStorage に保存（クロスオリジン Cookie 問題の回避策）
          if (data.token) {
            saveToken(data.token);
            console.log('[Callback] JWT トークンを localStorage に保存しました');
          }

          // バックエンドから返されたユーザー情報をセット
          setUser(data.user);

          setStatus('success');
          setMessage(data.isNewUser ? 'アカウントを作成しました！' : 'ログインに成功しました！');

          console.log('[Callback] ログイン成功、リダイレクト中...');
          setTimeout(() => {
            router.push(resolvePostLoginRedirect(oauthState));
          }, 1500);
        } else {
          throw new Error(data.error || 'ログインに失敗しました');
        }
      } catch (err) {
        console.error('[Callback] ログインエラー:', err);
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'エラーが発生しました');
        setTimeout(() => {
          router.push('/login?error=callback_failed');
        }, 2000);
      }
    };

    handleCallback();
  }, [searchParams, router, setUser, saveToken]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="bg-gray-800 rounded-lg p-8 shadow-xl max-w-md w-full text-center">
        {/* ステータスアイコン */}
        <div className="mb-6">
          {status === 'processing' && (
            <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-blue-500 border-opacity-75 mx-auto" />
          )}
          {status === 'success' && (
            <div className="h-16 w-16 bg-green-500 rounded-full flex items-center justify-center mx-auto">
              <svg className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
          {status === 'error' && (
            <div className="h-16 w-16 bg-red-500 rounded-full flex items-center justify-center mx-auto">
              <svg className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          )}
        </div>

        {/* タイトル */}
        <h1 className="text-xl font-bold text-white mb-2">
          {status === 'processing' && 'cTrader 認証中'}
          {status === 'success' && '連携完了！'}
          {status === 'error' && '認証エラー'}
        </h1>

        {/* メッセージ */}
        <p className="text-gray-400">{message}</p>

        {/* 処理中の説明 */}
        {status === 'processing' && (
          <p className="text-gray-500 text-sm mt-4">
            アクセストークンを取得しています...
          </p>
        )}

        {/* 成功時の説明 */}
        {status === 'success' && (
          <p className="text-gray-500 text-sm mt-4">
            次の画面へ移動します...
          </p>
        )}

        {/* エラー時の手動リンク */}
        {status === 'error' && (
          <button
            onClick={() => router.push('/settings')}
            className="mt-6 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
          >
            設定画面に戻る
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * ローディングコンポーネント（Suspense fallback）
 */
function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="bg-gray-800 rounded-lg p-8 shadow-xl max-w-md w-full text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-blue-500 border-opacity-75 mx-auto mb-6" />
        <h1 className="text-xl font-bold text-white mb-2">読み込み中...</h1>
        <p className="text-gray-400">cTrader 認証を準備しています</p>
      </div>
    </div>
  );
}

/**
 * メインページコンポーネント（Suspense でラップ）
 */
export default function CTraderCallbackPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <CallbackHandler />
    </Suspense>
  );
}
