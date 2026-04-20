import { describe, it, expect } from "vitest";
import { isNavHrefActive } from "@/lib/navigation/navActive";

describe("isNavHrefActive", () => {
  it("ホームは / のみ", () => {
    expect(isNavHrefActive("/", "/")).toBe(true);
    expect(isNavHrefActive("/notes", "/")).toBe(false);
  });

  it("運転席 /side-b は厳密一致のみアクティブ", () => {
    expect(isNavHrefActive("/side-b", "/side-b")).toBe(true);
    expect(isNavHrefActive("/side-b/dashboard", "/side-b")).toBe(false);
    expect(isNavHrefActive("/side-b/hypotheses", "/side-b")).toBe(false);
  });

  it("子パス付き href はプレフィックス一致", () => {
    expect(isNavHrefActive("/side-b/hypotheses", "/side-b/hypotheses")).toBe(true);
    expect(isNavHrefActive("/side-b/hypotheses/abc", "/side-b/hypotheses")).toBe(true);
  });

  it("ハッシュリンクは pathname ではアクティブにしない", () => {
    expect(isNavHrefActive("/", "#foo")).toBe(false);
  });
});
