/**
 * 設定画面の操作テスト
 *
 * 確認事項:
 * - Web Push 購読状態が設定画面で確認できる
 * - 未購読時に購読開始操作が hook に渡る
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", () => ({
  fetchUserSettings: vi.fn(),
  saveUserSettings: vi.fn(),
  resetUserSettings: vi.fn(),
}));

vi.mock("@/lib/usePushNotification", () => ({
  usePushNotification: vi.fn(),
}));

import SettingsPage from "@/app/settings/page";
import {
  fetchUserSettings,
  saveUserSettings,
  resetUserSettings,
  type UserSettings,
} from "@/lib/api";
import {
  usePushNotification,
  type UsePushNotificationResult,
} from "@/lib/usePushNotification";

const DEFAULT_SETTINGS: UserSettings = {
  notification: {
    enabled: true,
    scoreThreshold: 70,
    maxPerDay: 10,
  },
  timeframes: {
    primary: "1h",
    secondary: "4h",
  },
  display: {
    darkMode: true,
    compactView: false,
    showAiSuggestions: true,
  },
  updatedAt: "2026-06-15T00:00:00Z",
};

function createPushState(
  overrides: Partial<UsePushNotificationResult> = {}
): UsePushNotificationResult {
  return {
    permission: "granted",
    isSubscribed: true,
    isLoading: false,
    error: null,
    serverStatus: {
      enabled: true,
      hasVapidKey: true,
    },
    serverStatusError: null,
    isCheckingStatus: false,
    testMessage: null,
    subscribe: vi.fn(async () => true),
    unsubscribe: vi.fn(async () => true),
    sendTestNotification: vi.fn(async () => true),
    refreshStatus: vi.fn(async () => undefined),
    requestPermission: vi.fn(async (): Promise<NotificationPermission> => "granted"),
    isSupported: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchUserSettings).mockResolvedValue(DEFAULT_SETTINGS);
  vi.mocked(saveUserSettings).mockResolvedValue(DEFAULT_SETTINGS);
  vi.mocked(resetUserSettings).mockResolvedValue(DEFAULT_SETTINGS);
  vi.mocked(usePushNotification).mockReturnValue(createPushState());
});

async function renderPage() {
  render(<SettingsPage />);
  await waitFor(() => expect(screen.getByText("Web Push 購読状態")).toBeDefined());
}

describe("設定画面", () => {
  it("Web Push 購読状態を表示する", async () => {
    await renderPage();

    expect(screen.getByText("ブラウザ")).toBeDefined();
    expect(screen.getByText("許可済み")).toBeDefined();
    expect(screen.getByText("サーバー")).toBeDefined();
    expect(screen.getByText("有効")).toBeDefined();
    expect(screen.getByText("購読中")).toBeDefined();
  });

  it("未購読時に購読開始操作を呼び出す", async () => {
    const subscribe = vi.fn(async () => true);
    vi.mocked(usePushNotification).mockReturnValue(
      createPushState({
        isSubscribed: false,
        subscribe,
      })
    );

    await renderPage();

    fireEvent.click(screen.getByText("購読する"));

    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});
