/**
 * インジケーター設定サービス
 * 
 * 目的:
 * - ユーザーのインジケーター設定をファイルベースで永続化
 * - 設定の取得・保存・削除を提供
 * - ノート生成時に使用するインジケーターセットを管理
 * 
 * ストレージ:
 * - data/indicator-settings.json にJSON形式で保存
 * - MVPでは単一ユーザー前提
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type {
  IndicatorConfig,
  IndicatorSet,
  IndicatorId} from '../models/indicatorConfig';
import {
  INDICATOR_METADATA,
  createDefaultIndicatorSet,
  validateIndicatorConfig,
} from '../models/indicatorConfig';

// 設定ファイルのパス
const SETTINGS_FILE = path.join(process.cwd(), 'data', 'indicator-settings.json');

const IndicatorIdSchema = z.string().refine(
  (s): s is IndicatorId => INDICATOR_METADATA.some((m) => m.id === s),
  { message: '不正な indicatorId です' },
);

const IndicatorConfigJsonSchema = z.object({
  configId: z.string(),
  indicatorId: IndicatorIdSchema,
  label: z.string().optional(),
  params: z.record(z.string(), z.union([z.number(), z.undefined()])).default({}),
  enabled: z.boolean(),
});

const IndicatorSetJsonSchema = z.object({
  name: z.string(),
  configs: z.array(IndicatorConfigJsonSchema),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const UserIndicatorSettingsJsonSchema = z.object({
  activeSet: IndicatorSetJsonSchema,
  updatedAt: z.string().min(1),
  hasCompletedSetup: z.boolean().optional(),
});

/** 保存失敗時に元エラーを cause へ載せる（ES2020 未満のためプロパティで付与） */
function saveErrorWithCause(message: string, error: Error): Error {
  const e = new Error(message);
  (e as Error & { cause?: Error }).cause = error;
  return e;
}

/**
 * ユーザーインジケーター設定の型
 */
export interface UserIndicatorSettings {
  // アクティブなインジケーターセット
  activeSet: IndicatorSet;
  // 更新日時
  updatedAt: Date;
  // 初回セットアップ完了フラグ
  hasCompletedSetup: boolean;
}

/**
 * 設定保存用のリクエスト型
 */
export interface SaveIndicatorConfigRequest {
  indicatorId: IndicatorId;
  params: Record<string, number | undefined>;
  enabled?: boolean;
  label?: string;
}

/**
 * インジケーター設定サービスクラス
 */
export class IndicatorSettingsService {
  /**
   * ユーザー設定を読み込む
   * ファイルが存在しない場合はデフォルト設定を返す
   */
  loadSettings(): UserIndicatorSettings {
    try {
      if (!fs.existsSync(SETTINGS_FILE)) {
        // ファイルが存在しない場合はデフォルト設定を返す
        return this.createDefaultSettings();
      }

      const content = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      const parsed = UserIndicatorSettingsJsonSchema.safeParse(JSON.parse(content));
      if (!parsed.success) {
        console.error('インジケーター設定の形式エラー:', parsed.error.format());
        return this.createDefaultSettings();
      }

      return {
        activeSet: {
          ...parsed.data.activeSet,
          createdAt: new Date(parsed.data.activeSet.createdAt),
          updatedAt: new Date(parsed.data.activeSet.updatedAt),
          configs: parsed.data.activeSet.configs.map(
            (c): IndicatorConfig => ({
              ...c,
              params: c.params,
            }),
          ),
        },
        updatedAt: new Date(parsed.data.updatedAt),
        hasCompletedSetup: parsed.data.hasCompletedSetup ?? false,
      };
    } catch (error) {
      console.error('インジケーター設定の読み込みエラー:', error);
      return this.createDefaultSettings();
    }
  }

  /**
   * ユーザー設定を保存
   */
  saveSettings(settings: UserIndicatorSettings): void {
    try {
      // data ディレクトリがなければ作成
      const dataDir = path.dirname(SETTINGS_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // 更新日時を記録
      settings.updatedAt = new Date();
      settings.activeSet.updatedAt = new Date();

      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (error) {
      console.error('インジケーター設定の保存エラー:', error);
      const cause = error instanceof Error ? error : new Error(String(error));
      throw saveErrorWithCause('インジケーター設定の保存に失敗しました', cause);
    }
  }

  /**
   * 単一インジケーターの設定を追加または更新
   */
  upsertIndicatorConfig(request: SaveIndicatorConfigRequest): IndicatorConfig {
    const settings = this.loadSettings();

    // メタデータを取得
    const metadata = INDICATOR_METADATA.find(m => m.id === request.indicatorId);
    if (!metadata) {
      throw new Error(`不明なインジケーター: ${request.indicatorId}`);
    }

    // configId を生成（indicatorId + params のハッシュ）
    const configId = this.generateConfigId(request.indicatorId, request.params);

    // 既存の設定を探す
    const existingIndex = settings.activeSet.configs.findIndex(
      c => c.indicatorId === request.indicatorId
    );

    const newConfig: IndicatorConfig = {
      configId,
      indicatorId: request.indicatorId,
      label: request.label || this.generateLabel(request.indicatorId, request.params),
      params: request.params,
      enabled: request.enabled ?? true,
    };

    // バリデーション
    const errors = validateIndicatorConfig(newConfig);
    if (errors.length > 0) {
      throw new Error(`設定が無効です: ${errors.join(', ')}`);
    }

    // 既存の設定を更新または新規追加
    if (existingIndex >= 0) {
      settings.activeSet.configs[existingIndex] = newConfig;
    } else {
      settings.activeSet.configs.push(newConfig);
    }

    // セットアップ完了フラグを更新
    settings.hasCompletedSetup = true;

    this.saveSettings(settings);
    return newConfig;
  }

  /**
   * インジケーター設定を削除（無効化）
   */
  removeIndicatorConfig(indicatorId: IndicatorId): void {
    const settings = this.loadSettings();

    // 該当インジケーターを削除
    settings.activeSet.configs = settings.activeSet.configs.filter(
      c => c.indicatorId !== indicatorId
    );

    this.saveSettings(settings);
  }

  /**
   * インジケーター設定を有効/無効切り替え
   */
  toggleIndicatorConfig(indicatorId: IndicatorId, enabled: boolean): void {
    const settings = this.loadSettings();

    const config = settings.activeSet.configs.find(c => c.indicatorId === indicatorId);
    if (config) {
      config.enabled = enabled;
      this.saveSettings(settings);
    }
  }

  /**
   * アクティブな（有効化された）インジケーター設定のみ取得
   */
  getActiveConfigs(): IndicatorConfig[] {
    const settings = this.loadSettings();
    return settings.activeSet.configs.filter(c => c.enabled);
  }

  /**
   * セットアップが完了しているかチェック
   */
  hasCompletedSetup(): boolean {
    const settings = this.loadSettings();
    return settings.hasCompletedSetup;
  }

  /**
   * 設定をリセット（デフォルトに戻す）
   */
  resetToDefault(): UserIndicatorSettings {
    const defaultSettings = this.createDefaultSettings();
    this.saveSettings(defaultSettings);
    return defaultSettings;
  }

  /**
   * デフォルト設定を作成
   */
  private createDefaultSettings(): UserIndicatorSettings {
    return {
      activeSet: createDefaultIndicatorSet(),
      updatedAt: new Date(),
      hasCompletedSetup: false,
    };
  }

  /**
   * 設定IDを生成
   */
  private generateConfigId(indicatorId: IndicatorId, params: Record<string, number | undefined>): string {
    const paramStr = Object.entries(params)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => `${k}${v}`)
      .join('-');
    return paramStr ? `${indicatorId}-${paramStr}` : indicatorId;
  }

  /**
   * ラベルを生成
   */
  private generateLabel(indicatorId: IndicatorId, params: Record<string, number | undefined>): string {
    const metadata = INDICATOR_METADATA.find(m => m.id === indicatorId);
    const displayName = metadata?.displayName || indicatorId.toUpperCase();

    // パラメータから短いラベルを生成
    const paramValues = Object.values(params).filter(v => v !== undefined);
    if (paramValues.length === 0) {
      return displayName;
    }
    if (paramValues.length === 1) {
      return `${indicatorId.toUpperCase()}(${paramValues[0]})`;
    }
    return `${indicatorId.toUpperCase()}(${paramValues.join(',')})`;
  }
}

// シングルトンインスタンス
export const indicatorSettingsService = new IndicatorSettingsService();
