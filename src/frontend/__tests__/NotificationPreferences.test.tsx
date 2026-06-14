/**
 * 通知粒度設定 UI (Phase β-2b) の操作テスト
 *
 * 確認事項:
 * - 全体設定フォームが既存値を初期表示し、保存で upsert API に正しい値が渡る
 * - 空欄は null (= 既定に戻す) として送信される
 * - 24h 通知上限を表示・保存できる
 * - ノート単位上書きの一覧表示と削除
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  fetchNotificationPreferences: vi.fn(),
  upsertNotificationPreference: vi.fn(),
  deleteNotificationPreference: vi.fn(),
}));

import NotificationPreferencesPage from "@/app/settings/notifications/page";
import {
  fetchNotificationPreferences,
  upsertNotificationPreference,
  deleteNotificationPreference,
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
  cooldownMinutes: null,
  maxPerDay: 5,
  createdAt: "2026-06-11T00:00:00Z",
  updatedAt: "2026-06-11T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchNotificationPreferences).mockResolvedValue([USER_PREF, NOTE_PREF]);
  vi.mocked(upsertNotificationPreference).mockResolvedValue(USER_PREF);
  vi.mocked(deleteNotificationPreference).mockResolvedValue(undefined);
});

async function renderPage() {
  render(<NotificationPreferencesPage />);
  await waitFor(() => expect(screen.getByText("全体設定")).toBeDefined());
}

describe("通知粒度設定ページ (Phase β-2b)", () => {
  it("全体設定が既存値を初期表示する", async () => {
    await renderPage();

    const threshold = screen.getByLabelText("類似度しきい値 (0〜1)") as HTMLInputElement;
    const level = screen.getByLabelText("通知する一致レベル") as HTMLSelectElement;
    const cooldown = screen.getByLabelText("再通知クールダウン (分)") as HTMLInputElement;
    const maxPerDay = screen.getByLabelText("24h 通知上限 (件)") as HTMLInputElement;

    expect(threshold.value).toBe("0.85");
    expect(level.value).toBe("medium");
    expect(cooldown.value).toBe("120");
    expect(maxPerDay.value).toBe("20");
  });

  it("値を変更して保存すると upsert API に scope=user で渡る", async () => {
    await renderPage();

    fireEvent.change(screen.getByLabelText("類似度しきい値 (0〜1)"), {
      target: { value: "0.9" },
    });
    fireEvent.change(screen.getByLabelText("通知する一致レベル"), {
      target: { value: "strong" },
    });
    fireEvent.change(screen.getByLabelText("24h 通知上限 (件)"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(upsertNotificationPreference).toHaveBeenCalledTimes(1));
    expect(upsertNotificationPreference).toHaveBeenCalledWith({
      scope: "user",
      threshold: 0.9,
      minMatchLevel: "strong",
      cooldownMinutes: 120,
      maxPerDay: 10,
    });
  });

  it("空欄は null (既定に戻す) として送信される", async () => {
    await renderPage();

    fireEvent.change(screen.getByLabelText("類似度しきい値 (0〜1)"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("再通知クールダウン (分)"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("通知する一致レベル"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("24h 通知上限 (件)"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(upsertNotificationPreference).toHaveBeenCalledTimes(1));
    expect(upsertNotificationPreference).toHaveBeenCalledWith({
      scope: "user",
      threshold: null,
      minMatchLevel: null,
      cooldownMinutes: null,
      maxPerDay: null,
    });
  });

  it("しきい値の範囲外入力はバリデーションエラーで送信しない (境界値)", async () => {
    await renderPage();

    fireEvent.change(screen.getByLabelText("類似度しきい値 (0〜1)"), {
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
    expect(screen.getByText(/24h上限 5件/)).toBeDefined();

    fireEvent.click(screen.getByText("削除"));

    await waitFor(() => expect(deleteNotificationPreference).toHaveBeenCalledWith("pref-note-1"));
  });
});
