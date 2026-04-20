/**
 * Side-B パンくず（ラベル・href は sideBNav と同一ソース）
 *
 * @see docs/design/tradeassist_uiux_redesign_plan.md §4-5
 */

import {
  getSideBWorkspaceItemsSorted,
  type SideBNavEntry,
} from "@/lib/navigation/sideBNav";
import { SIDE_B_HOME } from "@/lib/workspaceSide";

export type SideBBreadcrumbSegment = {
  /** 表示ラベル（sideBNav の labelSidebar と整合） */
  label: string;
  /** 省略時は現在地（リンクにしない） */
  href?: string;
};

/** ワークスペース名（台帳と紛らわしいので「Side-B」固定） */
export const SIDE_B_WORKSPACE_LABEL = "Side-B";

/**
 * pathname に対応するパンくず。Side-A や /login は空配列。
 */
export function getSideBBreadcrumbSegments(
  pathname: string | null | undefined,
): SideBBreadcrumbSegment[] {
  if (!pathname || !pathname.startsWith("/side-b")) {
    return [];
  }

  const match = findLongestSideBNavMatch(pathname);
  const base: SideBBreadcrumbSegment[] = [
    { label: SIDE_B_WORKSPACE_LABEL, href: SIDE_B_HOME },
  ];

  if (!match) {
    base.push({ label: "ページ" });
    return base;
  }

  if (pathname === match.href || pathname === `${match.href}/`) {
    base.push({ label: match.labelSidebar });
    return base;
  }

  base.push({ label: match.labelSidebar, href: match.href });
  base.push({ label: "詳細" });
  return base;
}

/**
 * `/side-b`（運転席）は完全一致のみ。それ以外は href 長い順で最長一致。
 */
function findLongestSideBNavMatch(pathname: string): SideBNavEntry | null {
  const items = getSideBWorkspaceItemsSorted();
  const sorted = [...items].sort((a, b) => b.href.length - a.href.length);
  for (const e of sorted) {
    if (e.href === "/side-b") {
      if (pathname === "/side-b" || pathname === "/side-b/") {
        return e;
      }
      continue;
    }
    if (pathname === e.href || pathname.startsWith(`${e.href}/`)) {
      return e;
    }
  }
  return null;
}
