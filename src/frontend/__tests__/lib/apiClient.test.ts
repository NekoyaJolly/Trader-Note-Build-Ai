/**
 * apiClient の認証ヘッダー付与境界テスト
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/apiClient";

describe("apiFetch", () => {
  const originalApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

  afterEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = originalApiBaseUrl;
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("APIベースURL配下にはBearer tokenを付与する", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
    localStorage.setItem("auth_token", "test-token");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/settings");

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("https://api.example.test/api/settings");
    const init = call[1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-token");
  });

  it("外部absolute URLにはBearer tokenを付与しない", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
    localStorage.setItem("auth_token", "test-token");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("https://external.example.test/collect");

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("https://external.example.test/collect");
    const init = call[1] as RequestInit;
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });
});
