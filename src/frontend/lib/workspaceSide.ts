/**
 * Side-A / Side-B ワークスペース判定（ヘッダー・サイドバーで共通利用）
 *
 * 判定ロジックはここに集約し、各所で `pathname.startsWith` を重複させない。
 * 将来「共通設定」「shared」等が増える場合は `WorkspaceSide` を拡張し、
 * ここで分岐を追加する（今は二分で十分）。
 *
 * @see docs/design/tradeassist_uiux_redesign_plan.md §4-1（P3）
 */

export type WorkspaceSide = "side-a" | "side-b";

/** Side-A のホーム（ワークスペース切替の着地点） */
export const SIDE_A_HOME = "/";

/** Side-B のホーム（ワークスペース切替の着地点）。
 *  Side-B のメインハブは「プラン」(/side-b) のため、切替時はダッシュボードではなくプランに着地させる。 */
export const SIDE_B_HOME = "/side-b";

/**
 * 現在の pathname がどちらのワークスペースか。
 * `/side-b` 配下を Side-B とみなす。
 */
export function getWorkspaceSideFromPathname(
  pathname: string | null | undefined,
): WorkspaceSide {
  if (!pathname) return "side-a";
  return pathname.startsWith("/side-b") ? "side-b" : "side-a";
}
