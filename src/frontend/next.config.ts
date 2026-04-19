import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * このファイルがあるディレクトリ＝Next アプリのルート（src/frontend）
 * リポジトリ直下にも package-lock があると Turbopack が誤ったルートを推定し、
 * Vercel / CI でビルドが不安定になるため root を固定する。
 */
const turbopackRoot = path.dirname(fileURLToPath(import.meta.url));

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
    root: turbopackRoot,
  },
};

export default nextConfig;
