import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import BottomNavigation from "@/components/layout/BottomNavigation";

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
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* 共通ヘッダー */}
        <Header />
        {/* メインコンテンツ領域 */}
        <main className="container mx-auto max-w-7xl px-4 py-6 min-h-screen">{children}</main>
        {/* 共通フッター */}
        <Footer />
        {/* モバイル用ボトムナビゲーション */}
        <BottomNavigation />
      </body>
    </html>
  );
}
