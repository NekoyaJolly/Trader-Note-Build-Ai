/**
 * Side-A 「前回の続き」パス記録
 */

import { describe, it, expect } from "vitest";
import { isKnownSideAContinueRoute, shouldRecordSideAPath } from "@/lib/lastSideAPath";

describe("shouldRecordSideAPath", () => {
  it("ホーム・認証・Side-B は記録しない", () => {
    expect(shouldRecordSideAPath("/")).toBe(false);
    expect(shouldRecordSideAPath("/login")).toBe(false);
    expect(shouldRecordSideAPath("/auth/ctrader/callback")).toBe(false);
    expect(shouldRecordSideAPath("/side-b/dashboard")).toBe(false);
  });

  it("Side-A の通常ページは記録する", () => {
    expect(shouldRecordSideAPath("/notes")).toBe(true);
    expect(shouldRecordSideAPath("/market-analysis")).toBe(true);
  });
});

describe("isKnownSideAContinueRoute", () => {
  it("許可プレフィックスのみ true", () => {
    expect(isKnownSideAContinueRoute("/notes")).toBe(true);
    expect(isKnownSideAContinueRoute("/notes/x")).toBe(true);
    expect(isKnownSideAContinueRoute("/strategies/comparison")).toBe(true);
    expect(isKnownSideAContinueRoute("/unknown")).toBe(false);
    expect(isKnownSideAContinueRoute("/admin")).toBe(false);
  });
});
