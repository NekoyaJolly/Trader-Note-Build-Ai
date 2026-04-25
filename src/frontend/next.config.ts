import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Vercel は outputFileTracingRoot をリポジトリルートに設定する。
 * Next.js 16 では outputFileTracingRoot と turbopack.root が一致していないと
 * Vercel build で警告/失敗要因になるため、Turbopack もリポジトリルートへ合わせる。
 */
const appRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appRoot, "../..");

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
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
