/**
 * 通知粒度設定 UI (Phase β-2b) の操作テスト
 *
 * 確認事項:
 * - 全体設定フォームが既存値を初期表示し、保存で upsert API に正しい値が渡る
 * - 空欄は null (= 既定に戻す) として送信される
 * - 24h 通知上限を表示・保存できる
 * - レンズ層の重みプリセットを表示・保存できる
 * - ノート単位上書きの一覧表示と削除
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  fetchNotificationPreferences: vi.fn(),
  fetchProfiles: vi.fn(),
  upsertNotificationPreference: vi.fn(),
  deleteNotificationPreference: vi.fn(),
}));

import NotificationPreferencesPage from "@/app/settings/notifications/page";
import {
  fetchNotificationPreferences,
  fetchProfiles,
  upsertNotificationPreference,
  deleteNotificationPreference,
  type IndicatorProfile,
  type NotificationPreference,
} from "@/lib/api";

const USER_PREF: NotificationPreference = {
  id: "pref-user-1",
  scope: "user",
  noteId: null,
  profileId: null,
  strategyId: null,
  threshold: 0.85,
  minMatchLevel: "medium",
  weightPreset: "balanced",
  cooldownMinutes: 120,
  maxPerDay: 20,
  createdAt: "2026-06-11T00:00:00Z",
  updatedAt: "2026-06-11T00:00:00Z",
};

const NOTE_PREF: NotificationPreference = {
  id: "pref-note-1",
  scope: "note",
  noteId: "11111111-2222-4333-8444-555555555555",
  profileId: null,
  strategyId: null,
  threshold: 0.9,
  minMatchLevel: null,
  weightPreset: "state_focused",
  cooldownMinutes: null,
  maxPerDay: 5,
  createdAt: "2026-06-11T00:00:00Z",
  updatedAt: "2026-06-11T00:00:00Z",
};

const PROFILE: IndicatorProfile = {
  id: "99999999-9999-4999-8999-999999999999",
  name: "押し目プロファイル",
  description: "通知粒度テスト用",
  indicators: [],
  isDefault: false,
  createdAt: "2026-06-11T00:00:00Z",
  updatedAt: "2026-06-11T00:00:00Z",
};

const PROFILE_PREF: NotificationPreference = {
  id: "pref-profile-1",
  scope: "profile",
  noteId: null,
  profileId: PROFILE.id,
  strategyId: null,
  threshold: 0.82,
  minMatchLevel: "medium",
  weightPreset: "balanced",
  cooldownMinutes: 90,
  maxPerDay: 9,
  createdAt: "2026-06-11T00:00:00Z",
  updatedAt: "2026-06-11T00:00:00Z",
};

const STRATEGY_PREF: NotificationPreference = {
  id: "pref-strategy-1",
  scope: "strategy",
  noteId: null,
  profileId: null,
  strategyId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  threshold: null,
  minMatchLevel: null,
  weightPreset: null,
  cooldownMinutes: 45,
  maxPerDay: null,
  createdAt: "2026-06-11T00:00:00Z",
  updatedAt: "2026-06-11T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchNotificationPreferences).mockResolvedValue([USER_PREF, PROFILE_PREF, NOTE_PREF, STRATEGY_PREF]);
  vi.mocked(fetchProfiles).mockResolvedValue([PROFILE]);
  vi.mocked(upsertNotificationPreference).mockResolvedValue(USER_PREF);
  vi.mocked(deleteNotificationPreference).mockResolvedValue(undefined);
});

async function renderPage() {
  render(<NotificationPreferencesPage />);
  await waitFor(() => expect(screen.getByText("全体設定")).toBeDefined());
}

function inputById(id: string): HTMLInputElement {
  const element = document.getElementById(id);
  expect(element).not.toBeNull();
  return element as HTMLInputElement;
}

function selectById(id: string): HTMLSelectElement {
  const element = document.getElementById(id);
  expect(element).not.toBeNull();
  return element as HTMLSelectElement;
}

describe("通知粒度設定ページ (Phase β-2b)", () => {
  it("全体設定が既存値を初期表示する", async () => {
    await renderPage();

    const threshold = inputById("pref-threshold");
    const level = selectById("pref-level");
    const weightPreset = selectById("pref-weight-preset");
    const cooldown = inputById("pref-cooldown");
    const maxPerDay = inputById("pref-max-per-day");

    expect(threshold.value).toBe("0.85");
    expect(level.value).toBe("medium");
    expect(weightPreset.value).toBe("balanced");
    expect(cooldown.value).toBe("120");
    expect(maxPerDay.value).toBe("20");
  });

  it("値を変更して保存すると upsert API に scope=user で渡る", async () => {
    await renderPage();

    fireEvent.change(inputById("pref-threshold"), {
      target: { value: "0.9" },
    });
    fireEvent.change(selectById("pref-level"), {
      target: { value: "strong" },
    });
    fireEvent.change(selectById("pref-weight-preset"), {
      target: { value: "state_focused" },
    });
    fireEvent.change(inputById("pref-max-per-day"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(upsertNotificationPreference).toHaveBeenCalledTimes(1));
    expect(upsertNotificationPreference).toHaveBeenCalledWith({
      scope: "user",
      threshold: 0.9,
      minMatchLevel: "strong",
      weightPreset: "state_focused",
      cooldownMinutes: 120,
      maxPerDay: 10,
    });
  });

  it("空欄は null (既定に戻す) として送信される", async () => {
    await renderPage();

    fireEvent.change(inputById("pref-threshold"), {
      target: { value: "" },
    });
    fireEvent.change(inputById("pref-cooldown"), {
      target: { value: "" },
    });
    fireEvent.change(selectById("pref-level"), {
      target: { value: "" },
    });
    fireEvent.change(selectById("pref-weight-preset"), {
      target: { value: "" },
    });
    fireEvent.change(inputById("pref-max-per-day"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(upsertNotificationPreference).toHaveBeenCalledTimes(1));
    expect(upsertNotificationPreference).toHaveBeenCalledWith({
      scope: "user",
      threshold: null,
      minMatchLevel: null,
      weightPreset: null,
      cooldownMinutes: null,
      maxPerDay: null,
    });
  });

  it("しきい値の範囲外入力はバリデーションエラーで送信しない (境界値)", async () => {
    await renderPage();

    fireEvent.change(inputById("pref-threshold"), {
      target: { value: "1.5" },
    });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() =>
      expect(screen.getByText("しきい値は 0〜1 の数値で指定してください")).toBeDefined()
    );
    expect(upsertNotificationPreference).not.toHaveBeenCalled();
  });

  it("ノート単位上書きが一覧され、削除で API が呼ばれる", async () => {
    await renderPage();

    // ノート ID 先頭 8 文字のリンクが出る
    expect(screen.getByText(/11111111…/)).toBeDefined();
    expect(screen.getByText(/しきい値 0\.9/)).toBeDefined();
    expect(screen.getByText(/\/ 状態重視/)).toBeDefined();
    expect(screen.getByText(/24h上限 5件/)).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: "ノート 11111111 の通知粒度上書きを削除" })
    );

    await waitFor(() => expect(deleteNotificationPreference).toHaveBeenCalledWith("pref-note-1"));
  });

  it("プロファイル単位上書きを表示・保存できる", async () => {
    await renderPage();

    expect(screen.getAllByText("押し目プロファイル").length).toBeGreaterThan(0);
    expect(screen.getByText(/しきい値 0\.82/)).toBeDefined();
    expect(screen.getByText(/24h上限 9件/)).toBeDefined();

    fireEvent.change(inputById("profile-pref-threshold"), {
      target: { value: "0.88" },
    });
    fireEvent.change(selectById("profile-pref-level"), {
      target: { value: "strong" },
    });
    fireEvent.change(selectById("profile-pref-weight"), {
      target: { value: "state_focused" },
    });
    fireEvent.change(inputById("profile-pref-cooldown"), {
      target: { value: "45" },
    });
    fireEvent.change(inputById("profile-pref-max-per-day"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByText("プロファイル上書きを保存"));

    await waitFor(() => expect(upsertNotificationPreference).toHaveBeenCalledTimes(1));
    expect(upsertNotificationPreference).toHaveBeenCalledWith({
      scope: "profile",
      profileId: PROFILE.id,
      threshold: 0.88,
      minMatchLevel: "strong",
      weightPreset: "state_focused",
      cooldownMinutes: 45,
      maxPerDay: 4,
    });
  });

  it("プロファイル単位上書きが削除できる", async () => {
    await renderPage();

    fireEvent.click(
      screen.getByRole("button", { name: "押し目プロファイル の通知粒度上書きを削除" })
    );

    await waitFor(() => expect(deleteNotificationPreference).toHaveBeenCalledWith("pref-profile-1"));
  });

  it("ストラテジー単位上書きが一覧され、削除で API が呼ばれる", async () => {
    await renderPage();

    expect(screen.getByText(/aaaaaaaa…/)).toBeDefined();
    expect(screen.getByText("クールダウン 45分")).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: "ストラテジー aaaaaaaa の通知粒度上書きを削除" })
    );

    await waitFor(() => expect(deleteNotificationPreference).toHaveBeenCalledWith("pref-strategy-1"));
  });
});
