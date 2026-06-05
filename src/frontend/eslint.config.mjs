import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // 未使用引数 / 未使用変数は `_` プレフィックスで明示的に無視できるようにする
  // (バックエンド /eslint.config.mjs と同じ運用に合わせる)。
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // ハードコード再発防止 (2026-06-06):
  // チャート / マーケットデータ系のシンボル名を文字列リテラルで直書きすると、
  // 複数コンポーネントに重複して片方しか修正されないバグが繰り返し発生した
  // (RealtimeChart と app/market-analysis/page.tsx の SYMBOL_OPTIONS 二重定義等)。
  // 機械的に warning を出して、リテラル増殖を抑止する。
  // - 例外: lib/marketConstants.ts (生成側) と __tests__ 以下
  {
    files: ["components/**/*.{ts,tsx}", "app/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          // 主要 FX/ゴールド系シンボル名のリテラル直書きを禁止。SYMBOL_OPTIONS 経由のみ。
          selector:
            "Literal[value=/^(XAUUSD|EURUSD|USDJPY|GBPUSD|AUDUSD|USDCAD|USDCHF|NZDUSD)$/]",
          message:
            "シンボル名はリテラル直書き禁止。@/lib/marketConstants の SYMBOL_OPTIONS / DEFAULT_SYMBOL / SymbolValue を import すること (ハードコード重複の再発防止)。",
        },
      ],
    },
  },
]);

export default eslintConfig;
