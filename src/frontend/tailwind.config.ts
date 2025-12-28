import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * shadcn/ui 用の最小 Tailwind 設定
 * Tailwind v4 でも互換のある設定に留める。
 */
export default {
  darkMode: ["class", "dark"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [animate],
} satisfies Config;
