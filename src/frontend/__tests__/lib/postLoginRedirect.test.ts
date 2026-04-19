/**
 * ログイン後遷移先（ビューポート別）
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { getPostLoginPath } from "@/lib/postLoginRedirect";

describe("getPostLoginPath", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("md 未満（モバイル）では /market-analysis", () => {
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        matchMedia: vi.fn().mockReturnValue({ matches: false }),
      }),
    );
    expect(getPostLoginPath()).toBe("/market-analysis");
  });

  it("md 以上（デスクトップ）では /", () => {
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        matchMedia: vi.fn().mockReturnValue({ matches: true }),
      }),
    );
    expect(getPostLoginPath()).toBe("/");
  });
});
