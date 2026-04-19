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
} from "lucide-react";

/** ナビ項目の安定 ID（キー・分析用） */
export type SideBNavId =
  | "dashboard"
  | "hypotheses"
  | "validation"
  | "agent"
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
  /** 運転席（/side-b）ページ上部の横並びナビに載せるか（5本程度） */
  showInAgentTabStrip: boolean;
};

/**
 * Side-B「AI・台帳」カテゴリの並び（order 昇順で表示）
 */
export const SIDE_B_WORKSPACE_ITEMS: readonly SideBNavEntry[] = [
  {
    id: "dashboard",
    href: "/side-b/dashboard",
    labelSidebar: "台帳ダッシュボード",
    labelTab: "台帳",
    icon: LayoutDashboard,
    order: 10,
    showInAgentTabStrip: true,
  },
  {
    id: "hypotheses",
    href: "/side-b/hypotheses",
    labelSidebar: "仮説一覧",
    labelTab: "仮説",
    icon: ClipboardList,
    order: 20,
    showInAgentTabStrip: true,
  },
  {
    id: "validation",
    href: "/side-b/validation",
    labelSidebar: "検証キュー",
    labelTab: "検証",
    icon: FlaskConical,
    order: 30,
    showInAgentTabStrip: true,
  },
  {
    id: "agent",
    href: "/side-b",
    labelSidebar: "エージェント（運転席）",
    labelTab: "運転席",
    icon: Bot,
    order: 40,
    showInAgentTabStrip: true,
  },
  {
    id: "ai-notes",
    href: "/side-b/ai-notes",
    labelSidebar: "AIノート",
    labelTab: "AIノート",
    icon: Brain,
    order: 50,
    showInAgentTabStrip: false,
  },
  {
    id: "trades",
    href: "/side-b/trades",
    labelSidebar: "仮想トレード",
    labelTab: "仮想",
    icon: TrendingUp,
    order: 60,
    showInAgentTabStrip: false,
  },
  {
    id: "comparison",
    href: "/side-b/comparison",
    labelSidebar: "比較ダッシュボード",
    labelTab: "比較",
    icon: GitCompare,
    order: 70,
    showInAgentTabStrip: true,
  },
  {
    id: "settings",
    href: "/side-b/settings",
    labelSidebar: "AI 自動実行設定",
    labelTab: "自動実行",
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
