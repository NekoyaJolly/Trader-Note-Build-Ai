/**
 * 認証レイアウトラッパー
 *
 * - 公開パス: 背景のみ + ページ本体（AppShell・サイドバーなし）
 * - 保護パス: ProtectedRoute 通過後に AppShell（ヘッダー・サイドバー・フッター）
 */

"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { ProtectedRoute } from "../auth/ProtectedRoute";
import AppShell from "./AppShell";
import Footer from "./Footer";

// 認証不要なパス（公開ページ）
const PUBLIC_PATHS = ["/login", "/auth/ctrader/callback"];

interface AuthLayoutWrapperProps {
  children: React.ReactNode;
}

/** 全ページ共通の背景装飾（ログイン画面でも軽く表示） */
function AmbientBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-pink-500/10 rounded-full blur-3xl animate-pulse-glow" />
      <div
        className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"
        style={{ animationDelay: "1s", animation: "pulseGlow 4s ease-in-out infinite" }}
      />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl" />
    </div>
  );
}

export function AuthLayoutWrapper({ children }: AuthLayoutWrapperProps) {
  const pathname = usePathname();

  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (isPublicPath) {
    return (
      <>
        <AmbientBackground />
        {children}
      </>
    );
  }

  return (
    <>
      <AmbientBackground />
      {/* ProtectedRoute が useSearchParams を使うため Suspense 必須 */}
      <Suspense
        fallback={
          <div className="relative z-10 min-h-screen flex items-center justify-center">
            <div className="text-center text-gray-300">
              <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-blue-500 border-opacity-75 mx-auto mb-4" />
              <p>読み込み中...</p>
            </div>
          </div>
        }
      >
        <ProtectedRoute>
          <AppShell>
            <main className="relative z-10 min-h-screen px-3 sm:px-4 md:px-8 py-4 sm:py-6">
              {children}
            </main>
            <Footer />
          </AppShell>
        </ProtectedRoute>
      </Suspense>
    </>
  );
}
