/**
 * Side-B ワークスペース内ナビの単一ソース（P4）
 *
 * サイドバー・運転席ページ上部タブ・将来のパンくずはこの定義を参照する。
 *
 * @see docs/design/tradeassist_uiux_redesign_plan.md §4-5
 */

import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ClipboardList,
  FlaskConical,
  Bot,
  Brain,
  TrendingUp,
  GitCompare,
  CalendarClock,
  Dna,
} from "lucide-react";

/** ナビ項目の安定 ID（キー・分析用） */
export type SideBNavId =
  | "dashboard"
  | "hypotheses"
  | "validation"
  | "agent"
  | "evolution"
  | "ai-notes"
  | "trades"
  | "comparison"
  | "settings";

export type SideBNavEntry = {
  id: SideBNavId;
  href: string;
  /** サイドバー・一覧用の正式ラベル */
  labelSidebar: string;
  /** 運転席ページ上部の横ナビ用（短く） */
  labelTab: string;
  icon: LucideIcon;
  order: number;
  /**
   * 運転席ページ上部タブに載せるか。
   * 将来 `placements: ("sidebar"|"agent-tab")[]` 等へ分割する余地あり（現状は boolean で十分）。
   */
  showInAgentTabStrip: boolean;
};

/**
 * Side-B「AI・台帳」カテゴリの並び（order 昇順で表示）
 */
export const SIDE_B_WORKSPACE_ITEMS: readonly SideBNavEntry[] = [
  {
    id: "dashboard",
    href: "/side-b/dashboard",
    labelSidebar: "統計",
    labelTab: "統計",
    icon: LayoutDashboard,
    order: 10,
    showInAgentTabStrip: true,
  },
  {
    id: "hypotheses",
    href: "/side-b/hypotheses",
    labelSidebar: "仮説",
    labelTab: "仮説",
    icon: ClipboardList,
    order: 20,
    showInAgentTabStrip: true,
  },
  {
    id: "validation",
    href: "/side-b/validation",
    labelSidebar: "検証",
    labelTab: "検証",
    icon: FlaskConical,
    order: 30,
    showInAgentTabStrip: true,
  },
  {
    id: "agent",
    href: "/side-b",
    labelSidebar: "プラン",
    labelTab: "プラン",
    icon: Bot,
    order: 40,
    showInAgentTabStrip: true,
  },
  {
    id: "evolution",
    href: "/side-b/evolution",
    labelSidebar: "進化",
    labelTab: "進化",
    icon: Dna,
    order: 45,
    showInAgentTabStrip: true,
  },
  {
    id: "ai-notes",
    href: "/side-b/ai-notes",
    labelSidebar: "ノート",
    labelTab: "ノート",
    icon: Brain,
    order: 50,
    showInAgentTabStrip: false,
  },
  {
    id: "trades",
    href: "/side-b/trades",
    labelSidebar: "トレード",
    labelTab: "トレード",
    icon: TrendingUp,
    order: 60,
    showInAgentTabStrip: false,
  },
  {
    id: "comparison",
    href: "/side-b/comparison",
    labelSidebar: "比較",
    labelTab: "比較",
    icon: GitCompare,
    order: 70,
    showInAgentTabStrip: true,
  },
  {
    id: "settings",
    href: "/side-b/settings",
    labelSidebar: "設定",
    labelTab: "設定",
    icon: CalendarClock,
    order: 80,
    showInAgentTabStrip: false,
  },
];

/** order 昇順のコピー */
export function getSideBWorkspaceItemsSorted(): SideBNavEntry[] {
  return [...SIDE_B_WORKSPACE_ITEMS].sort((a, b) => a.order - b.order);
}

/** 運転席ページ上部タブ用（5本＋比較で design どおり） */
export function getSideBAgentTabStripItems(): SideBNavEntry[] {
  return getSideBWorkspaceItemsSorted().filter((e) => e.showInAgentTabStrip);
}
