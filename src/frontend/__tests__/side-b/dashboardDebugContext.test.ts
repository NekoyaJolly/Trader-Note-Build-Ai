/**
 * Dashboard AI Debug Context patch ビルダーのテスト (Phase 11 / Copilot レビュー #8 対応)。
 *
 * 3 分岐:
 * - loading=true → action.status='pending' (domain / target / runtime は patch しない)
 * - error !== null → action.status='failed' + domain にエラーサマリ + runtime.latestError 設定
 * - 正常系 → action.status='success' + target.relatedIds に latestDiscoveryHypothesisId
 *
 * 観点:
 * - AGENTS.md §5 で禁止された機密値 (token / accountId / 取引額) が patch に混入しないこと
 * - target.relatedIds は Discovery 由来 ID のみで、ない場合は空オブジェクト
 */

import { describe, it, expect } from "vitest";

import {
  buildDashboardDebugContextPatch,
  type DashboardDebugContextInput,
} from "@/app/side-b/dashboard/page";
import type {
  StatsOverviewResponse,
  SystemHealthResponse,
  DiscoveryLatestResponse,
} from "@/types/sideB";

const baseOverview: StatsOverviewResponse = {
  success: true,
  totalHypotheses: 42,
  byStatus: {
    unverified: 0,
    screening_passed: 0,
    testing: 0,
    confirmed: 10,
    stale: 0,
    rejected: 5,
    insufficient_data: 0,
    not_testable: 0,
  },
  confirmedCount: 10,
  newHypothesesThisWeek: 3,
  confirmedThisWeek: 2,
  confirmedPrevWeek: 1,
  confirmedGrowthRate: 1.0,
  lastValidationCompletedAt: "2026-05-17T10:00:00.000Z",
  recentValidationSuccessRate: 0.75,
};

const baseHealth: SystemHealthResponse = {
  success: true,
  database: "ok",
  pythonValidator: "ok",
  checkedAt: "2026-05-17T10:00:00.000Z",
};

const baseDiscovery: DiscoveryLatestResponse = {
  success: true,
  message: "直近 7 日の Discovery 成果",
  newHypothesesFromDiscovery7d: 4,
  hasWeeklyReport: true,
  sampleHypotheses: [
    {
      id: "hyp-discovery-001",
      statement: "trend up regime で RSI < 30 はリバウンド傾向",
      status: "testing",
      createdAt: "2026-05-15T00:00:00.000Z",
    },
  ],
};

function makeInput(overrides: Partial<DashboardDebugContextInput> = {}): DashboardDebugContextInput {
  return {
    loading: false,
    error: null,
    overview: baseOverview,
    health: baseHealth,
    discovery: baseDiscovery,
    recentConfirmedCount: 3,
    recentRejectedCount: 2,
    ...overrides,
  };
}

describe("buildDashboardDebugContextPatch", () => {
  it("loading=true のとき action.status='pending' のみを返し domain は触らない", () => {
    const patch = buildDashboardDebugContextPatch(makeInput({ loading: true }));

    expect(patch.action).toEqual({
      name: "load-dashboard",
      status: "pending",
      expected: "8 種の Dashboard API がすべて成功して画面に反映される",
      actual: "API 取得中",
    });
    expect(patch.domain).toBeUndefined();
    expect(patch.target).toBeUndefined();
    expect(patch.runtime).toBeUndefined();
  });

  it("error !== null のとき action.status='failed' + domain.loadError + runtime.latestError を埋める", () => {
    const patch = buildDashboardDebugContextPatch(
      makeInput({ error: "ネットワークエラー: timeout" }),
    );

    expect(patch.action?.status).toBe("failed");
    expect(patch.action?.actual).toBe("エラー: ネットワークエラー: timeout");
    expect(patch.domain).toMatchObject({
      hypothesisCount: 42,
      databaseHealth: "ok",
      pythonValidatorHealth: "ok",
      loadError: "ネットワークエラー: timeout",
    });
    expect(patch.runtime?.latestError?.message).toBe("ネットワークエラー: timeout");
    expect(patch.runtime?.latestApi).toEqual([]);
    expect(patch.runtime?.warnings).toEqual([]);
  });

  it("正常系で discovery sample がある場合 target.relatedIds.latestDiscoveryHypothesisId が入る", () => {
    const patch = buildDashboardDebugContextPatch(makeInput());

    expect(patch.action?.status).toBe("success");
    expect(patch.target).toEqual({
      type: "dashboard",
      id: "overview",
      relatedIds: { latestDiscoveryHypothesisId: "hyp-discovery-001" },
    });
    expect(patch.domain).toMatchObject({
      hypothesisCount: 42,
      confirmedCount: 10,
      newHypothesesThisWeek: 3,
      databaseHealth: "ok",
      pythonValidatorHealth: "ok",
      recentConfirmedCount: 3,
      recentRejectedCount: 2,
      hasLatestDiscoveryWeeklyReport: true,
    });
  });

  it("正常系で discovery sample が無い場合 target.relatedIds は空オブジェクト", () => {
    const patch = buildDashboardDebugContextPatch(
      makeInput({
        discovery: { ...baseDiscovery, sampleHypotheses: [] },
      }),
    );

    expect(patch.target?.relatedIds).toEqual({});
  });

  it("overview=null の正常系では actual に『overview なし』を含む", () => {
    const patch = buildDashboardDebugContextPatch(
      makeInput({ overview: null, discovery: null, health: null }),
    );

    expect(patch.action?.status).toBe("success");
    expect(patch.action?.actual).toBe("ロード完了だが overview なし");
    expect(patch.domain).toMatchObject({
      hypothesisCount: null,
      databaseHealth: null,
      pythonValidatorHealth: null,
    });
  });

  it("AGENTS.md §5 で禁止された機密キーが patch に含まれないこと (token / accountId / 取引額)", () => {
    const patch = buildDashboardDebugContextPatch(makeInput());
    const flat = JSON.stringify(patch);

    // ホワイトリスト的に、これらが含まれていないことを保証
    expect(flat).not.toMatch(/accountId/i);
    expect(flat).not.toMatch(/access_?token/i);
    expect(flat).not.toMatch(/refresh_?token/i);
    expect(flat).not.toMatch(/balance/i);
    expect(flat).not.toMatch(/equity/i);
  });
});
