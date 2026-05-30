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

  it("エージェント横ナビは 6 件（5本＋比較、設計どおり）", () => {
    // 実装コメント「5本＋比較で design どおり」と整合。旧 expect(5) は比較タブ追加前の stale 値だった。
    expect(getSideBAgentTabStripItems()).toHaveLength(6);
  });

  it("全項目が SIDE_B_WORKSPACE_ITEMS と整合", () => {
    expect(getSideBWorkspaceItemsSorted().length).toBe(SIDE_B_WORKSPACE_ITEMS.length);
  });
});
