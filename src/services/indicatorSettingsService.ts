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
import {
  IndicatorConfig,
  IndicatorSet,
  IndicatorId,
  INDICATOR_METADATA,
  createDefaultIndicatorSet,
  validateIndicatorConfig,
} from '../models/indicatorConfig';

// 設定ファイルのパス
const SETTINGS_FILE = path.join(process.cwd(), 'data', 'indicator-settings.json');

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
  async loadSettings(): Promise<UserIndicatorSettings> {
    try {
      if (!fs.existsSync(SETTINGS_FILE)) {
        // ファイルが存在しない場合はデフォルト設定を返す
        return this.createDefaultSettings();
      }

      const content = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      const data = JSON.parse(content);

      // 日付の復元
      return {
        activeSet: {
          ...data.activeSet,
          createdAt: new Date(data.activeSet.createdAt),
          updatedAt: new Date(data.activeSet.updatedAt),
        },
        updatedAt: new Date(data.updatedAt),
        hasCompletedSetup: data.hasCompletedSetup ?? false,
      };
    } catch (error) {
      console.error('インジケーター設定の読み込みエラー:', error);
      return this.createDefaultSettings();
    }
  }

  /**
   * ユーザー設定を保存
   */
  async saveSettings(settings: UserIndicatorSettings): Promise<void> {
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
      throw new Error('インジケーター設定の保存に失敗しました');
    }
  }

  /**
   * 単一インジケーターの設定を追加または更新
   */
  async upsertIndicatorConfig(request: SaveIndicatorConfigRequest): Promise<IndicatorConfig> {
    const settings = await this.loadSettings();

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

    await this.saveSettings(settings);
    return newConfig;
  }

  /**
   * インジケーター設定を削除（無効化）
   */
  async removeIndicatorConfig(indicatorId: IndicatorId): Promise<void> {
    const settings = await this.loadSettings();

    // 該当インジケーターを削除
    settings.activeSet.configs = settings.activeSet.configs.filter(
      c => c.indicatorId !== indicatorId
    );

    await this.saveSettings(settings);
  }

  /**
   * インジケーター設定を有効/無効切り替え
   */
  async toggleIndicatorConfig(indicatorId: IndicatorId, enabled: boolean): Promise<void> {
    const settings = await this.loadSettings();

    const config = settings.activeSet.configs.find(c => c.indicatorId === indicatorId);
    if (config) {
      config.enabled = enabled;
      await this.saveSettings(settings);
    }
  }

  /**
   * アクティブな（有効化された）インジケーター設定のみ取得
   */
  async getActiveConfigs(): Promise<IndicatorConfig[]> {
    const settings = await this.loadSettings();
    return settings.activeSet.configs.filter(c => c.enabled);
  }

  /**
   * セットアップが完了しているかチェック
   */
  async hasCompletedSetup(): Promise<boolean> {
    const settings = await this.loadSettings();
    return settings.hasCompletedSetup;
  }

  /**
   * 設定をリセット（デフォルトに戻す）
   */
  async resetToDefault(): Promise<UserIndicatorSettings> {
    const defaultSettings = this.createDefaultSettings();
    await this.saveSettings(defaultSettings);
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
