/**
 * getPublicApiBaseUrl の挙動テスト
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { getPublicApiBaseUrl } from "@/lib/publicApiBaseUrl";

describe("getPublicApiBaseUrl", () => {
  const orig = process.env.NEXT_PUBLIC_API_BASE_URL;

  afterEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = orig;
    vi.unstubAllGlobals();
  });

  it("NEXT_PUBLIC_API_BASE_URL があればそれを使う（末尾スラッシュ除去）", () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://api.example:3100/";
    expect(getPublicApiBaseUrl()).toBe("http://api.example:3100");
  });

  it("未設定かつ localhost では Express 既定ポートを返す", () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    vi.stubGlobal("window", {
      location: { hostname: "localhost" },
    });
    expect(getPublicApiBaseUrl()).toBe("http://localhost:3100");
  });

  it("未設定かつ本番ホストでは空（相対パスに任せる）", () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    vi.stubGlobal("window", {
      location: { hostname: "trader-note-build-ai.vercel.app" },
    });
    expect(getPublicApiBaseUrl()).toBe("");
  });
});
