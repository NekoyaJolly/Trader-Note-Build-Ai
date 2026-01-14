/**
 * ProtectedRoute コンポーネント
 * 
 * 認証が必要なページをラップするコンポーネント
 * - 未認証ユーザーを /login にリダイレクト
 * - ローディング中は専用UIを表示
 * - 認証済みユーザーのみコンテンツを表示
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /**
   * リダイレクト先のパス（デフォルト: '/login'）
   */
  redirectTo?: string;
}

/**
 * ProtectedRoute コンポーネント
 * 
 * 使用例:
 * ```tsx
 * export default function DashboardPage() {
 *   return (
 *     <ProtectedRoute>
 *       <div>ダッシュボードコンテンツ</div>
 *     </ProtectedRoute>
 *   );
 * }
 * ```
 */
export function ProtectedRoute({ 
  children, 
  redirectTo = '/login' 
}: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // ローディング完了後、未認証ならリダイレクト
    if (!loading && !user) {
      router.push(redirectTo);
    }
  }, [user, loading, router, redirectTo]);

  // ローディング中はスピナーを表示
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

  // 未認証の場合は何も表示しない（リダイレクト中）
  if (!user) {
    return null;
  }

  // 認証済みの場合のみコンテンツを表示
  return <>{children}</>;
}
