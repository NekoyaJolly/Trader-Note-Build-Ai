/**
 * ユーザー設定サービス
 *
 * 目的:
 * - 通知 / 時間足 / 表示 の各設定をユーザー別に永続化する。
 *
 * ストレージ:
 * - DB `UserSettings` テーブル (userId 一意)。
 * - 旧実装は data/user-settings.json にファイル保存していたが、Cloud Run の揮発FSで
 *   永続しない・インスタンス間不整合・ユーザー別でない問題があったため DB へ移行した。
 *
 * 設計:
 * - JSON カラム (notification/timeframes/display) は DB 由来の外部入力として扱い、
 *   読み出し時に必ず Zod でデフォルト値マージ込みのバリデーションを行う (any/unknown 不使用)。
 */

import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../backend/db/client';

/** 時間足の許容値 */
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';

/**
 * 通知設定
 */
export interface NotificationSettings {
  /** 通知の有効化 */
  enabled: boolean;
  /** 一致スコア閾値 (70-100)。通知粒度基盤の weak 下限に合わせる */
  scoreThreshold: number;
  /** 1日の最大通知数 */
  maxPerDay: number;
}

/**
 * 時間足設定
 */
export interface TimeframeSettings {
  /** メイン時間足 */
  primary: Timeframe;
  /** サブ時間足 */
  secondary: Timeframe;
}

/**
 * 表示設定
 */
export interface DisplaySettings {
  /** ダークモード */
  darkMode: boolean;
  /** コンパクト表示 */
  compactView: boolean;
  /** AI提案表示 */
  showAiSuggestions: boolean;
}

/**
 * ユーザー設定全体
 */
export interface UserSettings {
  /** 通知設定 */
  notification: NotificationSettings;
  /** 時間足設定 */
  timeframes: TimeframeSettings;
  /** 表示設定 */
  display: DisplaySettings;
  /** 最終更新日時 (ISO文字列) */
  updatedAt: string;
}

/**
 * 設定更新入力。
 * API はセクション単位の部分更新を受けるため、ネストした項目も optional にする。
 */
export interface UserSettingsUpdate {
  /** 通知設定の部分更新 */
  notification?: Partial<NotificationSettings>;
  /** 時間足設定の部分更新 */
  timeframes?: Partial<TimeframeSettings>;
  /** 表示設定の部分更新 */
  display?: Partial<DisplaySettings>;
}

type UserSettingsPrismaClient = Pick<PrismaClient, 'userSettings'>;

/**
 * デフォルト設定
 */
const DEFAULT_SETTINGS: Omit<UserSettings, 'updatedAt'> = {
  notification: {
    enabled: true,
    scoreThreshold: 70,
    maxPerDay: 10,
  },
  timeframes: {
    primary: '1h',
    secondary: '4h',
  },
  display: {
    darkMode: true,
    compactView: false,
    showAiSuggestions: true,
  },
};

const TimeframeSchema = z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']);

// DB の JSON カラムは欠損フィールドをデフォルトで補完しつつ検証する (catch で堅牢化)。
// 読み出し側も通知粒度基盤と同じ範囲制約 (scoreThreshold 70-100 / maxPerDay 1-100) で
// パースする。DB に異常値や旧UI由来の低い閾値が入ってもデフォルトへ補正する。
const NotificationSchema = z.object({
  enabled: z.boolean().catch(DEFAULT_SETTINGS.notification.enabled),
  scoreThreshold: z.number().min(70).max(100).catch(DEFAULT_SETTINGS.notification.scoreThreshold),
  maxPerDay: z.number().min(1).max(100).catch(DEFAULT_SETTINGS.notification.maxPerDay),
}).catch(DEFAULT_SETTINGS.notification);

const TimeframesSchema = z.object({
  primary: TimeframeSchema.catch(DEFAULT_SETTINGS.timeframes.primary),
  secondary: TimeframeSchema.catch(DEFAULT_SETTINGS.timeframes.secondary),
}).catch(DEFAULT_SETTINGS.timeframes);

const DisplaySchema = z.object({
  darkMode: z.boolean().catch(DEFAULT_SETTINGS.display.darkMode),
  compactView: z.boolean().catch(DEFAULT_SETTINGS.display.compactView),
  showAiSuggestions: z.boolean().catch(DEFAULT_SETTINGS.display.showAiSuggestions),
}).catch(DEFAULT_SETTINGS.display);

/**
 * 設定を Prisma の JSON カラム入力 (InputJsonObject) へ変換する。
 * プリミティブのみのリテラルを構築することで any/unknown キャストを避ける。
 */
function toSettingsData(s: Omit<UserSettings, 'updatedAt'>): {
  notification: Prisma.InputJsonObject;
  timeframes: Prisma.InputJsonObject;
  display: Prisma.InputJsonObject;
} {
  return {
    notification: {
      enabled: s.notification.enabled,
      scoreThreshold: s.notification.scoreThreshold,
      maxPerDay: s.notification.maxPerDay,
    },
    timeframes: {
      primary: s.timeframes.primary,
      secondary: s.timeframes.secondary,
    },
    display: {
      darkMode: s.display.darkMode,
      compactView: s.display.compactView,
      showAiSuggestions: s.display.showAiSuggestions,
    },
  };
}

/**
 * ユーザー設定サービス
 */
export class UserSettingsService {
  constructor(private readonly db: UserSettingsPrismaClient = prisma) {}

  /**
   * 設定を読み込む。未保存ユーザーはデフォルトを返す。
   */
  async loadSettings(userId: string): Promise<UserSettings> {
    const row = await this.db.userSettings.findUnique({ where: { userId } });
    if (!row) {
      return { ...DEFAULT_SETTINGS, updatedAt: new Date().toISOString() };
    }
    return {
      notification: NotificationSchema.parse(row.notification),
      timeframes: TimeframesSchema.parse(row.timeframes),
      display: DisplaySchema.parse(row.display),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * 設定を保存する (部分更新)。既存値とマージして upsert する。
   */
  async saveSettings(userId: string, settings: UserSettingsUpdate): Promise<UserSettings> {
    const current = await this.loadSettings(userId);
    const merged: Omit<UserSettings, 'updatedAt'> = {
      notification: settings.notification
        ? { ...current.notification, ...settings.notification }
        : current.notification,
      timeframes: settings.timeframes
        ? { ...current.timeframes, ...settings.timeframes }
        : current.timeframes,
      display: settings.display
        ? { ...current.display, ...settings.display }
        : current.display,
    };

    const data = toSettingsData(merged);
    const row = await this.db.userSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: { ...data },
    });

    return {
      notification: NotificationSchema.parse(row.notification),
      timeframes: TimeframesSchema.parse(row.timeframes),
      display: DisplaySchema.parse(row.display),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * 設定をデフォルトにリセットする。
   */
  async resetToDefault(userId: string): Promise<UserSettings> {
    const data = toSettingsData({ ...DEFAULT_SETTINGS });
    const row = await this.db.userSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: { ...data },
    });
    return {
      notification: NotificationSchema.parse(row.notification),
      timeframes: TimeframesSchema.parse(row.timeframes),
      display: DisplaySchema.parse(row.display),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

// シングルトンインスタンス
export const userSettingsService = new UserSettingsService();
