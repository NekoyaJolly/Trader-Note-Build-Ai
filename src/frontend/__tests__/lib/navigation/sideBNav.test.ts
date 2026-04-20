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

  it("エージェント横ナビは 5 件（設計どおり）", () => {
    expect(getSideBAgentTabStripItems()).toHaveLength(5);
  });

  it("全項目が SIDE_B_WORKSPACE_ITEMS と整合", () => {
    expect(getSideBWorkspaceItemsSorted().length).toBe(SIDE_B_WORKSPACE_ITEMS.length);
  });
});
