/**
 * ストラテジーアラート設定画面の通知粒度 UI テスト
 *
 * 目的:
 * - strategy scope の NotificationPreference を読み込み、画面に反映する
 * - クールダウン上書き保存時に strategyId 付きで upsert API を呼ぶ
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Strategy } from "@/types/strategy";
import type { NotificationPreference, StrategyAlert } from "@/lib/api";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "strategy-1" }),
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
}));

import StrategyAlertsPage from "@/app/strategies/[id]/alerts/page";
import {
  fetchStrategy,
  fetchStrategyAlert,
  fetchAlertLogs,
  fetchNotificationPreferences,
  upsertNotificationPreference,
} from "@/lib/api";

const STRATEGY = {
  id: "strategy-1",
  name: "押し目買い",
  symbol: "USDJPY",
  timeframe: "15m",
  side: "buy",
  status: "active",
  currentVersionId: "version-1",
  currentVersion: {},
  versions: [],
  createdAt: "2026-06-11T00:00:00Z",
  updatedAt: "2026-06-11T00:00:00Z",
} as Strategy;

const ALERT: StrategyAlert = {
  id: "alert-1",
  strategyId: "strategy-1",
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
  strategyId: "strategy-1",
  threshold: null,
  minMatchLevel: null,
  cooldownMinutes: 45,
  maxPerDay: null,
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
  });
});

describe("ストラテジーアラート設定画面", () => {
  it("strategy scope のクールダウン上書きを表示し、保存できる", async () => {
    render(<StrategyAlertsPage />);

    const cooldownInput = await screen.findByLabelText("ストラテジー通知粒度クールダウン");
    expect((cooldownInput as HTMLInputElement).value).toBe("45");

    fireEvent.change(cooldownInput, { target: { value: "30" } });
    fireEvent.click(screen.getByText("通知粒度を保存"));

    await waitFor(() => expect(upsertNotificationPreference).toHaveBeenCalledTimes(1));
    expect(upsertNotificationPreference).toHaveBeenCalledWith({
      scope: "strategy",
      strategyId: "strategy-1",
      cooldownMinutes: 30,
    });
  });
});
