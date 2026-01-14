import type { Metadata } from "next";
import "./globals.css";
import Footer from "@/components/layout/Footer";
import AppShell from "@/components/layout/AppShell";
import { AuthProvider } from "../contexts/AuthContext";
import { AuthLayoutWrapper } from "@/components/layout/AuthLayoutWrapper";

// システムフォントを使用（Google Fontsの代わり）
// Railway環境などでGoogle Fontsが取得できない場合のフォールバック
const fontVariables = "--font-geist-sans --font-geist-mono";

export const metadata: Metadata = {
  title: "TradeAssist",
  description: "トレードノート支援 + 市場一致判定 UI",
  icons: {
    icon: [
      { url: '/icon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-96x96.png', sizes: '96x96', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-icon-180x180.png', sizes: '180x180', type: 'image/png' },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className="antialiased bg-slate-900 font-sans"
        style={{
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
        }}
      >
        <AuthProvider>
          <AuthLayoutWrapper>
            {/* 背景のネオン光源（全ページ共通） */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
              <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-pink-500/10 rounded-full blur-3xl"></div>
              <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"></div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl"></div>
            </div>

            {/* アプリシェル（ヘッダー + サイドバー + メインコンテンツ） */}
            <AppShell>
              {/* メインコンテンツ領域 */}
              <main className="relative z-10 min-h-screen px-3 sm:px-4 md:px-8 py-4 sm:py-6">{children}</main>
              {/* 共通フッター */}
              <Footer />
            </AppShell>
          </AuthLayoutWrapper>
        </AuthProvider>
      </body>
    </html>
  );
}
