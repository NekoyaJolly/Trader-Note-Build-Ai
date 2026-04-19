/**
 * ログイン成功直後の遷移先
 *
 * デスクトップ（Tailwind md 以上）: Side-A ホーム
 * モバイル: チャート（MT 系アプリに近い体験）
 *
 * @see docs/design/tradeassist_uiux_redesign_plan.md §3-4
 */
export function getPostLoginPath(): string {
  if (typeof window === "undefined") {
    return "/";
  }
  return window.matchMedia("(min-width: 768px)").matches ? "/" : "/market-analysis";
}
