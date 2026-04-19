/**
 * ログイン後遷移先（ビューポート別・明示パス優先・正規化）
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fullyDecodeRedirectInput,
  getPostLoginPath,
  isRedirectLoopPath,
  isSafeInternalRedirectPath,
  resolvePostLoginRedirect,
} from "@/lib/postLoginRedirect";

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

describe("isRedirectLoopPath", () => {
  it("ログイン・コールバックはループ扱い", () => {
    expect(isRedirectLoopPath("/login")).toBe(true);
    expect(isRedirectLoopPath("/login?next=/notes")).toBe(true);
    expect(isRedirectLoopPath("/auth/ctrader/callback")).toBe(true);
    expect(isRedirectLoopPath("/auth/ctrader/callback?code=x")).toBe(true);
  });

  it("通常の業務パスはループではない", () => {
    expect(isRedirectLoopPath("/notes")).toBe(false);
    expect(isRedirectLoopPath("/side-b/validation")).toBe(false);
  });
});

describe("fullyDecodeRedirectInput", () => {
  it("多重エンコードを段階的に戻す", () => {
    expect(fullyDecodeRedirectInput("%2F%2Fevil.com")).toBe("//evil.com");
    expect(fullyDecodeRedirectInput("%252F%252Fevil.com")).toBe("//evil.com");
  });
});

describe("isSafeInternalRedirectPath", () => {
  it("同一オリジンの相対パスは許可", () => {
    expect(isSafeInternalRedirectPath("/notes/abc")).toBe(true);
    expect(isSafeInternalRedirectPath("/side-b/dashboard?x=1")).toBe(true);
  });

  it("プロトコル相対・絶対URLは拒否", () => {
    expect(isSafeInternalRedirectPath("//evil.example/path")).toBe(false);
    expect(isSafeInternalRedirectPath("http://evil.example")).toBe(false);
    expect(isSafeInternalRedirectPath("https://evil.example")).toBe(false);
  });

  it("デコード後に // になるパスは拒否", () => {
    expect(isSafeInternalRedirectPath("//evil.com")).toBe(false);
  });

  it("javascript: スキームは拒否", () => {
    expect(isSafeInternalRedirectPath("/x?y=javascript:alert(1)")).toBe(false);
  });

  it("制御文字は拒否（先頭末尾 trim で消えない位置）", () => {
    expect(
      isSafeInternalRedirectPath(`/notes/x${String.fromCharCode(10)}y`),
    ).toBe(false);
  });

  it("ログイン・OAuth コールバックへの遷移は拒否", () => {
    expect(isSafeInternalRedirectPath("/login")).toBe(false);
    expect(isSafeInternalRedirectPath("/auth/ctrader/callback")).toBe(false);
  });
});

describe("resolvePostLoginRedirect", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("明示なしは getPostLoginPath と同じ（デスクトップ）", () => {
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        matchMedia: vi.fn().mockReturnValue({ matches: true }),
      }),
    );
    expect(resolvePostLoginRedirect(null)).toBe("/");
    expect(resolvePostLoginRedirect(undefined)).toBe("/");
    expect(resolvePostLoginRedirect("")).toBe("/");
  });

  it("安全な明示パスはそれを優先（デフォルトがモバイルでも）", () => {
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        matchMedia: vi.fn().mockReturnValue({ matches: false }),
      }),
    );
    expect(resolvePostLoginRedirect("/notifications/1")).toBe("/notifications/1");
  });

  it("危険な明示パスはフォールバック", () => {
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        matchMedia: vi.fn().mockReturnValue({ matches: true }),
      }),
    );
    expect(resolvePostLoginRedirect("//evil.com")).toBe("/");
    expect(resolvePostLoginRedirect("https://evil.com")).toBe("/");
    expect(resolvePostLoginRedirect("%2F%2Fevil.com")).toBe("/");
    expect(resolvePostLoginRedirect("%252F%252Fevil.com")).toBe("/");
  });

  it("ログインループ候補はフォールバック", () => {
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        matchMedia: vi.fn().mockReturnValue({ matches: true }),
      }),
    );
    expect(resolvePostLoginRedirect("/login")).toBe("/");
    expect(resolvePostLoginRedirect("/login?next=/notes")).toBe("/");
    expect(resolvePostLoginRedirect("/auth/ctrader/callback")).toBe("/");
  });
});
