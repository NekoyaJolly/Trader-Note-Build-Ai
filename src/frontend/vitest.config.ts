/**
 * Vitest 設定 (Phase 4d Step 2)
 *
 * スコープ:
 *   - src/frontend/**\/*.test.ts{,x} のみを対象
 *   - ルートの Jest（backend / side-b 用）とは完全に分離
 *   - @vitejs/plugin-react で Next.js の jsx:"react-jsx" と整合
 *
 * path alias `@/*` は tsconfig.json と合わせて `src/frontend/*` に解決させる。
 */

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", ".next", "dist"],
    css: false,
  },
});
