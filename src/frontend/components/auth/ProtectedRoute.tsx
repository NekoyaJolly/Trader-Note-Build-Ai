'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!loading && !user) {
      const qs = searchParams.toString();
      const next = `${pathname}${qs ? `?${qs}` : ''}`;
      router.push(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [user, loading, router, pathname, searchParams]);

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

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
