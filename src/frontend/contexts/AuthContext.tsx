/**
 * 認証コンテキスト（cTrader OAuth 統合認証）
 * 
 * JWT ベースのセッション管理を提供
 * - ログイン状態の管理
 * - ユーザー情報の取得
 * - ログアウト機能
 */

'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isBrowserLocalDevOrigin } from '@/lib/isLocalDevOrigin';

// API ベースURL（環境変数から取得）
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

// ========================================
// 型定義
// ========================================

interface CTraderAccount {
  accountId: string;
  expiresAt: string;
  lastConnectedAt: string | null;
}

interface User {
  id: string;
  primaryAccountId: string;
  displayName: string | null;
  email: string | null;
  role: 'user' | 'admin';
  active: boolean;
  lastLoginAt: string | null;
  ctraderAccounts: CTraderAccount[];
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (redirectTo?: string) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUser: (user: User | null) => void;
  /** JWT トークンを localStorage に保存（クロスオリジン環境用） */
  saveToken: (token: string) => void;
}

// ========================================
// コンテキスト作成
// ========================================

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ========================================
// AuthProvider コンポーネント
// ========================================

// localStorage のキー名
const AUTH_TOKEN_KEY = 'auth_token';

/** localStorage から JWT トークンを取得 */
function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  /**
   * JWT トークンを localStorage に保存
   */
  const saveToken = (token: string) => {
    try {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
      console.log('[AuthContext] トークンを localStorage に保存しました');
    } catch (error) {
      console.error('[AuthContext] トークン保存エラー:', error);
    }
  };

  /**
   * ユーザー情報を取得
   */
  const fetchUser = async (): Promise<User | null> => {
    try {
      console.log('[AuthContext] ユーザー情報取得開始');
      // Cookie に加えて、localStorage の JWT トークンも Authorization ヘッダーで送信
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const storedToken = getStoredToken();
      if (storedToken) {
        headers['Authorization'] = `Bearer ${storedToken}`;
      }
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        method: 'GET',
        credentials: 'include', // Cookie も送信（本番環境用）
        headers,
      });

      console.log('[AuthContext] /api/auth/me レスポンス:', response.status, response.statusText);

      if (response.ok) {
        const data = await response.json();
        console.log('[AuthContext] ユーザー情報取得成功:', data.user);
        return data.user;
      }

      const errorText = await response.text();
      console.log('[AuthContext] ユーザー情報取得失敗:', response.status, errorText);
      return null;
    } catch (error) {
      console.error('[AuthContext] ユーザー情報取得エラー:', error);
      return null;
    }
  };

  /**
   * 初回ロード時にユーザー情報を取得
   */
  useEffect(() => {
    const init = async () => {
      try {
        const userData = await fetchUser();
        setUser(userData);
      } catch (error) {
        console.error('[AuthContext] 初期化エラー:', error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, []);

  /**
   * ユーザー情報を再取得
   */
  const refreshUser = async () => {
    const userData = await fetchUser();
    setUser(userData);
  };

  /**
   * cTrader OAuth ログインを開始
   * 
   * @param redirectTo - ログイン後のリダイレクト先（任意）
   */
  const login = async (redirectTo?: string) => {
    try {
      // バックエンドから認証URLを取得
      const local = isBrowserLocalDevOrigin();
      const urlPath = local
        ? `${API_BASE_URL}/api/auth/ctrader/url?redirect_base=${encodeURIComponent(window.location.origin)}`
        : `${API_BASE_URL}/api/auth/ctrader/url`;
      const response = await fetch(urlPath, {
        method: 'GET',
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();

        // state パラメータにリダイレクト先を含める（任意）
        const authUrl = redirectTo
          ? `${data.authUrl}&state=${encodeURIComponent(redirectTo)}`
          : data.authUrl;

        // cTrader 認証画面にリダイレクト
        window.location.href = authUrl;
      } else {
        const body = await response.text();
        console.error("[AuthContext] 認証URL取得エラー:", response.status, body);
        // ローカルで 404 が多い原因: NEXT_PUBLIC_API_BASE_URL 未設定で Next 自身に fetch している
        if (typeof window !== "undefined") {
          const hint =
            response.status === 404
              ? "\n\n【よくある原因】フロントがバックエンドに届いていません。src/frontend/.env.local に NEXT_PUBLIC_API_BASE_URL=http://localhost:3100 を設定し、API（npm run dev:backend 等）を起動してください。\nローカルでは redirect_uri はポートに合わせ自動決定されます。cTrader アプリの Redirect URIs に http://localhost:3102/auth/ctrader/callback（ポート違いならその origin）を1本登録してください。手順: docs/cTrader-localhost-cheatsheet.md"
              : "";
          window.alert(
            `認証URLの取得に失敗しました（HTTP ${response.status}）。${hint}\n\n${body.slice(0, 300)}`,
          );
        }
      }
    } catch (error) {
      console.error("[AuthContext] ログインエラー:", error);
      if (typeof window !== "undefined") {
        window.alert(
          "ログイン要求の送信中にエラーが発生しました。バックエンドが起動しているか、NEXT_PUBLIC_API_BASE_URL が正しいか確認してください。",
        );
      }
    }
  };

  /**
   * ログアウト
   */
  const logout = async () => {
    try {
      const headers: Record<string, string> = {};
      const storedToken = getStoredToken();
      if (storedToken) {
        headers['Authorization'] = `Bearer ${storedToken}`;
      }
      await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers,
      });

      // localStorage のトークンもクリア
      try {
        localStorage.removeItem(AUTH_TOKEN_KEY);
      } catch { /* ignore */ }

      setUser(null);
      router.push('/login');
    } catch (error) {
      console.error('[AuthContext] ログアウトエラー:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser, setUser, saveToken }}>
      {children}
    </AuthContext.Provider>
  );
}

// ========================================
// useAuth フック
// ========================================

/**
 * 認証コンテキストを使用するためのフック
 * 
 * @returns 認証コンテキストの値
 * @throws AuthProvider 外で使用された場合
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}
