import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import BottomNavigation from "@/components/layout/BottomNavigation";
import AppShell from "@/components/layout/AppShell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TradeAssist MVP",
  description: "トレードノート支援 + 市場一致判定 UI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-slate-900`}
      >
        {/* アプリシェル（サイドバー + メインコンテンツ） */}
        <AppShell>
          {/* 共通ヘッダー（モバイルのみ表示） */}
          <Header />
          {/* メインコンテンツ領域 */}
          <main className="min-h-screen px-4 py-6 md:px-8">{children}</main>
          {/* 共通フッター */}
          <Footer />
        </AppShell>
        {/* モバイル用ボトムナビゲーション */}
        <BottomNavigation />
      </body>
    </html>
  );
}
