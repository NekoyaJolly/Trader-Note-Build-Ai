import type { NextConfig } from "next";

/**
 * Next.js 設定
 *
 * PWA (Progressive Web App) 対応:
 * - Service Worker によるオフラインサポート
 * - Web Push 通知
 * - アプリライクなインストール体験
 * 
 * 注意: Next.js 16+ では Turbopack がデフォルト
 * next-pwa は webpack ベースのため、Turbopack と互換性がない
 * 現在は PWA 機能を無効化し、手動の Service Worker で対応
 */
const nextConfig: NextConfig = {
  // GCP Cloud Run デプロイ用: standalone 出力で node_modules 不要の自己完結型ビルド
  output: 'standalone',
  // Turbopack を明示的に有効化（空の設定でもOK）
  // これにより webpack 設定との競合警告を抑制
  turbopack: {},
};

export default nextConfig;
