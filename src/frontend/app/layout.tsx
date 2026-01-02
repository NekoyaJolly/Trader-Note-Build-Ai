import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Footer from "@/components/layout/Footer";
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
  title: "TradeAssist",
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
        {/* アプリシェル（ヘッダー + サイドバー + メインコンテンツ） */}
        <AppShell>
          {/* メインコンテンツ領域 */}
          <main className="min-h-screen px-3 sm:px-4 md:px-8 py-4 sm:py-6">{children}</main>
          {/* 共通フッター */}
          <Footer />
        </AppShell>
      </body>
    </html>
  );
}
