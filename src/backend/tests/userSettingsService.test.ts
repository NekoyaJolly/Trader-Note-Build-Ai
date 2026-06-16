/**
 * UserSettingsService テスト
 *
 * Prisma を jest.mock で差し替え、DB 永続化 (per-user) の
 * - 未保存ユーザーはデフォルトを返す
 * - 部分更新が既存値とマージされる
 * - secondary が単一文字列で round-trip する
 * - 保存 JSON の Zod パースとデフォルト補完
 * を純粋に検証する。
 */

const mockFindUnique = jest.fn();
const mockUpsert = jest.fn();

jest.mock('../db/client', () => ({
  prisma: {
    userSettings: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
    },
  },
}));

import { userSettingsService } from '../../services/userSettingsService';

const USER = '00000000-0000-0000-0000-000000000001';

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpsert.mockReset();
});

describe('UserSettingsService', () => {
  it('未保存ユーザーはデフォルト設定を返す', async () => {
    mockFindUnique.mockResolvedValue(null);
    const settings = await userSettingsService.loadSettings(USER);
    expect(settings.notification).toEqual({ enabled: true, scoreThreshold: 70, maxPerDay: 10 });
    expect(settings.timeframes).toEqual({ primary: '1h', secondary: '4h' });
    expect(settings.display).toEqual({ darkMode: true, compactView: false, showAiSuggestions: true });
  });

  it('保存済みの JSON を Zod でパースして返す', async () => {
    mockFindUnique.mockResolvedValue({
      userId: USER,
      notification: { enabled: false, scoreThreshold: 90, maxPerDay: 3 },
      timeframes: { primary: '15m', secondary: '1d' },
      display: { darkMode: false, compactView: true, showAiSuggestions: false },
      updatedAt: new Date('2026-06-04T00:00:00.000Z'),
    });
    const settings = await userSettingsService.loadSettings(USER);
    expect(settings.timeframes).toEqual({ primary: '15m', secondary: '1d' });
    expect(settings.notification.scoreThreshold).toBe(90);
    expect(settings.updatedAt).toBe('2026-06-04T00:00:00.000Z');
  });

  it('旧UI由来の低い通知閾値は実効下限 70 に補正する', async () => {
    mockFindUnique.mockResolvedValue({
      userId: USER,
      notification: { enabled: true, scoreThreshold: 50, maxPerDay: 3 },
      timeframes: { primary: '15m', secondary: '1d' },
      display: { darkMode: false, compactView: true, showAiSuggestions: false },
      updatedAt: new Date('2026-06-04T00:00:00.000Z'),
    });

    const settings = await userSettingsService.loadSettings(USER);

    expect(settings.notification).toEqual({ enabled: true, scoreThreshold: 70, maxPerDay: 3 });
  });

  it('部分更新は既存値とマージして upsert される', async () => {
    // 既存値（loadSettings 経由で読まれる）
    mockFindUnique.mockResolvedValue({
      userId: USER,
      notification: { enabled: true, scoreThreshold: 70, maxPerDay: 10 },
      timeframes: { primary: '1h', secondary: '4h' },
      display: { darkMode: true, compactView: false, showAiSuggestions: true },
      updatedAt: new Date('2026-06-04T00:00:00.000Z'),
    });
    // upsert は受け取った create 値をそのまま行として返す体で実装
    mockUpsert.mockImplementation(({ create }: { create: Record<string, unknown> }) => ({
      ...create,
      updatedAt: new Date('2026-06-04T01:00:00.000Z'),
    }));

    const saved = await userSettingsService.saveSettings(USER, {
      timeframes: { primary: '15m', secondary: '1d' },
    });

    // timeframes だけ更新、その他は既存維持
    expect(saved.timeframes).toEqual({ primary: '15m', secondary: '1d' });
    expect(saved.notification).toEqual({ enabled: true, scoreThreshold: 70, maxPerDay: 10 });
    expect(saved.display.darkMode).toBe(true);

    // upsert に渡された JSON も検証
    const callArg = mockUpsert.mock.calls[0][0];
    expect(callArg.where).toEqual({ userId: USER });
    expect(callArg.update.timeframes).toEqual({ primary: '15m', secondary: '1d' });
  });
});
