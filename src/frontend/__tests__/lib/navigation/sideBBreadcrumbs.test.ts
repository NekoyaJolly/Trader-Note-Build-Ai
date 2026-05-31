import { describe, it, expect } from "vitest";
import { getSideBBreadcrumbSegments } from "@/lib/navigation/sideBBreadcrumbs";

describe("getSideBBreadcrumbSegments", () => {
  it("Side-A などでは空", () => {
    expect(getSideBBreadcrumbSegments("/notes")).toEqual([]);
    expect(getSideBBreadcrumbSegments("/")).toEqual([]);
  });

  it("/side-b はプランが末端", () => {
    const s = getSideBBreadcrumbSegments("/side-b");
    expect(s.map((x) => x.label)).toEqual(["Side-B", "プラン"]);
    expect(s[0].href).toBe("/side-b");
    expect(s[1].href).toBeUndefined();
  });

  it("/side-b/dashboard は統計が末端", () => {
    const s = getSideBBreadcrumbSegments("/side-b/dashboard");
    expect(s.map((x) => x.label)).toEqual(["Side-B", "統計"]);
  });

  it("/side-b/dashboard では子として /side-b にマッチしない", () => {
    const s = getSideBBreadcrumbSegments("/side-b/dashboard");
    expect(s).toHaveLength(2);
  });

  it("仮説詳細は 詳細 セグメント付き", () => {
    const s = getSideBBreadcrumbSegments("/side-b/hypotheses/abc-123");
    expect(s.map((x) => x.label)).toEqual(["Side-B", "仮説", "詳細"]);
    expect(s[1].href).toBe("/side-b/hypotheses");
  });
});
