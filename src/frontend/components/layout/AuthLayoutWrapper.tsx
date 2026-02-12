/**
 * 認証レイアウトラッパー
 * 
 * 特定のパスを除いてすべてのページに認証を要求するラッパー
 * 
 * NEXT_PUBLIC_SKIP_AUTH=true を設定すると認証をスキップ（プレビュー確認用）
 */

'use client';

import { usePathname } from 'next/navigation';
import { ProtectedRoute } from '../auth/ProtectedRoute';

// 認証不要なパス（公開ページ）
const PUBLIC_PATHS = [
  '/login',
  '/auth/ctrader/callback',
];

interface AuthLayoutWrapperProps {
  children: React.ReactNode;
}

/**
 * 認証レイアウトラッパー
 * 
 * 公開パス以外は ProtectedRoute でラップする
 * NEXT_PUBLIC_SKIP_AUTH=true でプレビュー確認用に認証バイパス
 */
export function AuthLayoutWrapper({ children }: AuthLayoutWrapperProps) {
  const pathname = usePathname();

  // プレビュー確認用：環境変数で認証をスキップ
  const skipAuth = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true';
  if (skipAuth) {
    return <>{children}</>;
  }

  // 現在のパスが公開パスかどうか判定
  const isPublicPath = PUBLIC_PATHS.some(path => pathname.startsWith(path));

  // 公開パスの場合は認証なしでコンテンツを表示
  if (isPublicPath) {
    return <>{children}</>;
  }

  // それ以外は認証が必要
  return (
    <ProtectedRoute>
      {children}
    </ProtectedRoute>
  );
}

