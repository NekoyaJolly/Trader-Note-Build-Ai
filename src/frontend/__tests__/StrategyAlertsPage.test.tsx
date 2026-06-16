/**
 * ストラテジーアラート設定画面の通知粒度 UI テスト
 *
 * 目的:
 * - strategy scope の NotificationPreference を読み込み、画面に反映する
 * - クールダウン / 24h 上限の上書き保存時に strategyId 付きで upsert API を呼ぶ
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Strategy } from "@/types/strategy";
import type { NotificationPreference, StrategyAlert } from "@/lib/api";

const STRATEGY_ID = "11111111-1111-4111-8111-111111111111";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: STRATEGY_ID }),
}));

vi.mock("@/lib/api", () => ({
  fetchStrategy: vi.fn(),
  fetchStrategyAlert: vi.fn(),
  createStrategyAlert: vi.fn(),
  updateStrategyAlert: vi.fn(),
  deleteStrategyAlert: vi.fn(),
  fetchAlertLogs: vi.fn(),
  pauseAlert: vi.fn(),
  resumeAlert: vi.fn(),
  fetchNotificationPreferences: vi.fn(),
  upsertNotificationPreference: vi.fn(),
  deleteNotificationPreference: vi.fn(),
}));

import StrategyAlertsPage from "@/app/strategies/[id]/alerts/page";
import {
  fetchStrategy,
  fetchStrategyAlert,
  fetchAlertLogs,
  fetchNotificationPreferences,
  upsertNotificationPreference,
  deleteNotificationPreference,
} from "@/lib/api";

const STRATEGY = {
  id: STRATEGY_ID,
  name: "押し目買い",
  symbol: "USDJPY",
  timeframe: "15m",
  side: "buy",
  status: "active",
  currentVersionId: "version-1",
  currentVersion: {
    id: "version-1",
    versionNumber: 1,
    entryConditions: {
      groupId: "group-1",
      operator: "AND",
      conditions: [],
    },
    exitSettings: {
      takeProfit: { value: 1, unit: "percent" },
      stopLoss: { value: 1, unit: "percent" },
    },
    entryTiming: "next_open",
    createdAt: "2026-06-11T00:00:00Z",
    changeNote: null,
  },
  versions: [],
  createdAt: "2026-06-11T00:00:00Z",
  updatedAt: "2026-06-11T00:00:00Z",
} as Strategy;

const ALERT: StrategyAlert = {
  id: "alert-1",
  strategyId: STRATEGY_ID,
  enabled: true,
  status: "enabled",
  cooldownMinutes: 60,
  channels: ["in_app"],
  minMatchScore: 0.7,
  lastTriggeredAt: null,
  createdAt: "2026-06-11T00:00:00Z",
  updatedAt: "2026-06-11T00:00:00Z",
};

const STRATEGY_PREF: NotificationPreference = {
  id: "pref-strategy-1",
  scope: "strategy",
  noteId: null,
  profileId: null,
  strategyId: STRATEGY_ID,
  threshold: null,
  minMatchLevel: null,
  weightPreset: null,
  cooldownMinutes: 45,
  maxPerDay: 8,
  createdAt: "2026-06-11T00:00:00Z",
  updatedAt: "2026-06-11T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchStrategy).mockResolvedValue(STRATEGY);
  vi.mocked(fetchStrategyAlert).mockResolvedValue(ALERT);
  vi.mocked(fetchAlertLogs).mockResolvedValue([]);
  vi.mocked(fetchNotificationPreferences).mockResolvedValue([STRATEGY_PREF]);
  vi.mocked(upsertNotificationPreference).mockResolvedValue({
    ...STRATEGY_PREF,
    cooldownMinutes: 30,
    maxPerDay: 6,
  });
  vi.mocked(deleteNotificationPreference).mockResolvedValue(undefined);
});

describe("ストラテジーアラート設定画面", () => {
  it("strategy scope のクールダウンと24h上限を表示し、保存できる", async () => {
    render(<StrategyAlertsPage />);

    const cooldownInput = await screen.findByLabelText("ストラテジー通知粒度クールダウン");
    const maxPerDayInput = screen.getByLabelText("ストラテジー24h通知上限");
    expect((cooldownInput as HTMLInputElement).value).toBe("45");
    expect((maxPerDayInput as HTMLInputElement).value).toBe("8");

    fireEvent.change(cooldownInput, { target: { value: "30" } });
    fireEvent.change(maxPerDayInput, { target: { value: "6" } });
    fireEvent.click(screen.getByText("通知粒度を保存"));

    await waitFor(() => expect(upsertNotificationPreference).toHaveBeenCalledTimes(1));
    expect(upsertNotificationPreference).toHaveBeenCalledWith({
      scope: "strategy",
      strategyId: STRATEGY_ID,
      cooldownMinutes: 30,
      maxPerDay: 6,
    });
  });

  it("バリデーションエラー時は古い成功メッセージを残さない", async () => {
    vi.mocked(fetchNotificationPreferences).mockResolvedValue([]);

    render(<StrategyAlertsPage />);

    const cooldownInput = await screen.findByLabelText("ストラテジー通知粒度クールダウン");
    fireEvent.click(screen.getByText("通知粒度を保存"));
    expect(screen.getByText("通知粒度はアラート設定値を使用します")).toBeDefined();

    fireEvent.change(cooldownInput, { target: { value: "0" } });
    fireEvent.click(screen.getByText("通知粒度を保存"));

    expect(screen.getByText("1分以上で指定してください")).toBeDefined();
    expect(screen.queryByText("通知粒度はアラート設定値を使用します")).toBeNull();
    expect(upsertNotificationPreference).not.toHaveBeenCalled();
  });

  it("24h上限のバリデーションエラー時は保存しない", async () => {
    render(<StrategyAlertsPage />);

    const maxPerDayInput = await screen.findByLabelText("ストラテジー24h通知上限");
    fireEvent.change(maxPerDayInput, { target: { value: "0" } });
    fireEvent.click(screen.getByText("通知粒度を保存"));

    expect(screen.getByText("1件以上で指定してください")).toBeDefined();
    expect(upsertNotificationPreference).not.toHaveBeenCalled();
  });

  it("strategy scope の上書きを解除できる", async () => {
    render(<StrategyAlertsPage />);

    await screen.findByLabelText("ストラテジー通知粒度クールダウン");
    fireEvent.click(screen.getByText("上書きを解除"));

    await waitFor(() => expect(deleteNotificationPreference).toHaveBeenCalledWith("pref-strategy-1"));
  });
});
