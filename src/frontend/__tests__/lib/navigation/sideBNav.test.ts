import { describe, it, expect } from "vitest";
import {
  getSideBAgentTabStripItems,
  getSideBWorkspaceItemsSorted,
  SIDE_B_WORKSPACE_ITEMS,
} from "@/lib/navigation/sideBNav";

describe("sideBNav", () => {
  it("href が重複しない", () => {
    const hrefs = getSideBWorkspaceItemsSorted().map((e) => e.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("エージェント横ナビは 7 件（5本＋比較＋フロー、設計どおり）", () => {
    // dashboard/hypotheses/validation/agent/evolution/comparison + flow(オーケストレーション可視化, PR #431)。
    expect(getSideBAgentTabStripItems()).toHaveLength(7);
  });

  it("全項目が SIDE_B_WORKSPACE_ITEMS と整合", () => {
    expect(getSideBWorkspaceItemsSorted().length).toBe(SIDE_B_WORKSPACE_ITEMS.length);
  });
});
