/**
 * プロファイル編集モーダルのパラメータ編集テスト (Phase α-4b)
 *
 * 確認事項:
 *   - 編集モーダルに選択中インジケーターのパラメータ入力欄が表示される
 *   - パラメータを変更して保存すると、updateProfile にプロファイル固有の params が渡る
 *   - パラメータなしインジケーター (OBV 等) は入力行を出さない
 *   - パラメータ編集はプロファイルの保存値のみを変える (元のインジケーター設定 API は呼ばない)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// next/navigation はテスト環境にルーターが無いためモックする
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// API 層をモックし、ページの読み込み + 保存経路だけを検証する
vi.mock("@/lib/api", () => ({
  fetchProfiles: vi.fn(),
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  deleteProfile: vi.fn(),
  setDefaultProfile: vi.fn(),
  fetchIndicatorSettings: vi.fn(),
}));

import ProfilesPage from "@/app/settings/profiles/page";
import {
  fetchProfiles,
  updateProfile,
  fetchIndicatorSettings,
} from "@/lib/api";

/** RSI (period パラメータあり) + OBV (パラメータなし) を持つテスト用プロファイル */
const PROFILE = {
  id: "profile-1",
  name: "スイング用",
  description: "",
  indicators: [
    {
      configId: "cfg-rsi",
      indicatorId: "rsi",
      label: "RSI(14)",
      params: { period: 14 },
      enabled: true,
    },
    {
      configId: "cfg-obv",
      indicatorId: "obv",
      label: "OBV",
      params: {},
      enabled: true,
    },
  ],
  isDefault: true,
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchProfiles).mockResolvedValue([PROFILE]);
  vi.mocked(fetchIndicatorSettings).mockResolvedValue({
    activeSet: {
      configs: PROFILE.indicators.map((i) => ({
        configId: i.configId,
        indicatorId: i.indicatorId,
        label: i.label,
        params: { ...i.params },
        enabled: i.enabled,
      })),
    },
    // ページが参照しない残りのフィールドはテストでは省略する
  } as Awaited<ReturnType<typeof fetchIndicatorSettings>>);
  vi.mocked(updateProfile).mockResolvedValue(PROFILE);
});

/** プロファイル一覧をロードして編集モーダルを開くまでの共通操作 */
async function openEditModal() {
  render(<ProfilesPage />);
  // 一覧ロード完了を待つ
  await waitFor(() => expect(screen.getByText("スイング用")).toBeDefined());
  fireEvent.click(screen.getByText("編集"));
  // モーダルが開いたことをパラメータセクションの出現で確認
  await waitFor(() => expect(screen.getByText("パラメータ")).toBeDefined());
}

describe("ProfileEditModal パラメータ編集 (Phase α-4b)", () => {
  it("選択中インジケーターのパラメータ入力欄が初期値付きで表示される", async () => {
    await openEditModal();

    const input = screen.getByLabelText("RSI(14) 期間") as HTMLInputElement;
    expect(input.value).toBe("14");
  });

  it("パラメータなしインジケーター (OBV) は入力行を出さない", async () => {
    await openEditModal();

    // OBV の行 (パラメータ入力) は存在しない。選択グリッドのボタンのみ
    expect(screen.queryByLabelText(/^OBV /)).toBeNull();
  });

  it("パラメータを変更して保存すると updateProfile にプロファイル固有の params が渡る", async () => {
    await openEditModal();

    const input = screen.getByLabelText("RSI(14) 期間") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "21" } });
    expect(input.value).toBe("21");

    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(1));
    const [profileId, payload] = vi.mocked(updateProfile).mock.calls[0];
    expect(profileId).toBe("profile-1");
    const rsi = payload.indicators?.find(
      (i: { configId: string }) => i.configId === "cfg-rsi"
    );
    expect(rsi?.params?.period).toBe(21);
    // OBV の params は空のまま保持される
    const obv = payload.indicators?.find(
      (i: { configId: string }) => i.configId === "cfg-obv"
    );
    expect(obv?.params).toEqual({});
  });
});
