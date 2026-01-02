/**
 * ユーザー設定サービス
 * 
 * 目的: ユーザーのアプリ設定をファイルベースで永続化
 * - 通知設定（閾値、最大数）
 * - 時間足設定
 * - 表示設定
 * 
 * 保存先: data/user-settings.json
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 通知設定
 */
export interface NotificationSettings {
  /** 通知有効化フラグ */
  enabled: boolean;
  /** 通知するスコア閾値（%） */
  scoreThreshold: number;
  /** 1日の最大通知数 */
  maxPerDay: number;
}

/**
 * 時間足タイプ
 */
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';

/**
 * 時間足設定
 */
export interface TimeframeSettings {
  /** メイン時間足 */
  primary: Timeframe;
  /** サブ時間足（複数） */
  secondary: Timeframe[];
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
  /** 最終更新日時 */
  updatedAt: string;
}

// 設定ファイルのパス
const SETTINGS_FILE = path.join(process.cwd(), 'data', 'user-settings.json');

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
    secondary: ['4h', '1d'],
  },
  display: {
    darkMode: true,
    compactView: false,
    showAiSuggestions: true,
  },
};

/**
 * ユーザー設定サービス
 */
export class UserSettingsService {
  /**
   * 設定を読み込む
   */
  async loadSettings(): Promise<UserSettings> {
    try {
      const content = await fs.readFile(SETTINGS_FILE, 'utf-8');
      const settings = JSON.parse(content) as UserSettings;
      // デフォルト値でマージ（新しいフィールドが追加された場合に対応）
      return {
        ...DEFAULT_SETTINGS,
        ...settings,
        notification: { ...DEFAULT_SETTINGS.notification, ...settings.notification },
        timeframes: { ...DEFAULT_SETTINGS.timeframes, ...settings.timeframes },
        display: { ...DEFAULT_SETTINGS.display, ...settings.display },
      };
    } catch (error) {
      // ファイルがない場合はデフォルト設定を返す
      console.log('[UserSettingsService] 設定ファイルが見つかりません。デフォルト設定を使用します。');
      return {
        ...DEFAULT_SETTINGS,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * 設定を保存する
   */
  async saveSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
    // 既存設定を読み込み
    const currentSettings = await this.loadSettings();
    
    // マージして更新
    const updatedSettings: UserSettings = {
      notification: settings.notification 
        ? { ...currentSettings.notification, ...settings.notification }
        : currentSettings.notification,
      timeframes: settings.timeframes 
        ? { ...currentSettings.timeframes, ...settings.timeframes }
        : currentSettings.timeframes,
      display: settings.display 
        ? { ...currentSettings.display, ...settings.display }
        : currentSettings.display,
      updatedAt: new Date().toISOString(),
    };

    // ファイルに保存
    const dir = path.dirname(SETTINGS_FILE);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(updatedSettings, null, 2), 'utf-8');
    
    console.log('[UserSettingsService] 設定を保存しました');
    return updatedSettings;
  }

  /**
   * 設定をデフォルトにリセット
   */
  async resetToDefault(): Promise<UserSettings> {
    const defaultWithTimestamp: UserSettings = {
      ...DEFAULT_SETTINGS,
      updatedAt: new Date().toISOString(),
    };
    
    const dir = path.dirname(SETTINGS_FILE);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(defaultWithTimestamp, null, 2), 'utf-8');
    
    console.log('[UserSettingsService] 設定をデフォルトにリセットしました');
    return defaultWithTimestamp;
  }
}

// シングルトンインスタンス
export const userSettingsService = new UserSettingsService();
