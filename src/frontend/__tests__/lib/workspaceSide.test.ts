/**
 * ワークスペース Side 判定
 */

import { describe, it, expect } from "vitest";
import {
  getWorkspaceSideFromPathname,
  SIDE_A_HOME,
  SIDE_B_HOME,
} from "@/lib/workspaceSide";

describe("getWorkspaceSideFromPathname", () => {
  it("Side-B は /side-b 配下", () => {
    expect(getWorkspaceSideFromPathname("/side-b/dashboard")).toBe("side-b");
    expect(getWorkspaceSideFromPathname("/side-b/validation")).toBe("side-b");
  });

  it("それ以外は Side-A", () => {
    expect(getWorkspaceSideFromPathname("/")).toBe("side-a");
    expect(getWorkspaceSideFromPathname("/notes")).toBe("side-a");
    expect(getWorkspaceSideFromPathname("/market-analysis")).toBe("side-a");
  });

  it("null / undefined は Side-A", () => {
    expect(getWorkspaceSideFromPathname(null)).toBe("side-a");
    expect(getWorkspaceSideFromPathname(undefined)).toBe("side-a");
  });
});

describe("定数", () => {
  it("ホームパスは設計どおり", () => {
    expect(SIDE_A_HOME).toBe("/");
    expect(SIDE_B_HOME).toBe("/side-b");
  });
});
