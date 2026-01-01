import type { NextConfig } from "next";
// @ts-expect-error next-pwa には型定義がない
import withPWA from "next-pwa";

/**
 * Next.js 設定
 *
 * PWA (Progressive Web App) 対応:
 * - Service Worker によるオフラインサポート
 * - Web Push 通知
 * - アプリライクなインストール体験
 */
const nextConfig: NextConfig = {
  // 他の設定があればここに追加
};

/**
 * PWA 設定
 *
 * 開発環境では無効化（頻繁なリロードでキャッシュが問題になるため）
 * 本番環境では有効化
 */
const pwaConfig = withPWA({
  dest: "public",
  // 開発環境では PWA を無効化
  disable: process.env.NODE_ENV === "development",
  // Service Worker の登録範囲
  scope: "/",
  // キャッシュ戦略をカスタマイズ
  runtimeCaching: [
    {
      // API レスポンスはネットワーク優先
      urlPattern: /^https?:\/\/.*\/api\/.*/,
      handler: "NetworkFirst",
      options: {
        cacheName: "api-cache",
        expiration: {
          maxEntries: 100,
          maxAgeSeconds: 60 * 60, // 1時間
        },
      },
    },
    {
      // 静的アセットはキャッシュ優先
      urlPattern: /^https?:\/\/.*\.(png|jpg|jpeg|svg|gif|ico|woff2?)$/,
      handler: "CacheFirst",
      options: {
        cacheName: "static-assets",
        expiration: {
          maxEntries: 100,
          maxAgeSeconds: 60 * 60 * 24 * 30, // 30日
        },
      },
    },
  ],
});

export default pwaConfig(nextConfig);
