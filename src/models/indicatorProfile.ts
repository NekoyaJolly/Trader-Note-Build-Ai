/**
 * インジケータープロファイル型定義
 * 
 * 目的:
 * - ユーザーが複数のインジケーター設定パターンを作成・管理
 * - CSVインポート時にプロファイルを選択してノートに適用
 * - 特殊オプション（AIに任せる、プロファイルなし）をサポート
 * 
 * 設計方針:
 * - 各プロファイルは固有のIDと名前を持つ
 * - ノートはprofileIdで紐付け、後から変更可能
 * - 特殊プロファイル（AI_AUTO, NONE）は予約ID
 */

import { IndicatorConfig } from './indicatorConfig';

// ============================================================================
// 特殊プロファイルID（予約済み）
// ============================================================================

/**
 * 特殊プロファイルの予約ID
 * 
 * - AI_AUTO: AIに任せる（12次元固定特徴量）
 * - NONE: プロファイルなし（OHLCVのみ、特徴量なし）
 */
export const RESERVED_PROFILE_IDS = {
  /** AIに任せる: Side-Bと同じ12次元特徴量を使用 */
  AI_AUTO: '__AI_AUTO__',
  /** プロファイルなし: OHLCVのみ保存、特徴量は計算しない */
  NONE: '__NONE__',
} as const;

export type ReservedProfileId = typeof RESERVED_PROFILE_IDS[keyof typeof RESERVED_PROFILE_IDS];

/**
 * 予約IDかどうかを判定
 */
export function isReservedProfileId(id: string): id is ReservedProfileId {
  return Object.values(RESERVED_PROFILE_IDS).includes(id as ReservedProfileId);
}

// ============================================================================
// プロファイル型定義
// ============================================================================

/**
 * インジケータープロファイル
 * 
 * ユーザーが作成するインジケーター設定のセット。
 * 複数作成可能で、ノート作成時に選択して適用する。
 */
export interface IndicatorProfile {
  /** プロファイルID（UUID） */
  id: string;
  /** プロファイル名（例: 'スキャル用', 'デイトレ用'） */
  name: string;
  /** 説明（任意） */
  description?: string;
  /** インジケーター設定の配列 */
  indicators: IndicatorConfig[];
  /** デフォルトプロファイルフラグ（CSVインポート時の初期選択） */
  isDefault: boolean;
  /** 作成日時 */
  createdAt: Date;
  /** 更新日時 */
  updatedAt: Date;
}

/**
 * プロファイル作成リクエスト
 */
export interface CreateProfileRequest {
  /** プロファイル名 */
  name: string;
  /** 説明（任意） */
  description?: string;
  /** インジケーター設定の配列 */
  indicators: IndicatorConfig[];
  /** デフォルトプロファイルに設定するか */
  isDefault?: boolean;
}

/**
 * プロファイル更新リクエスト
 */
export interface UpdateProfileRequest {
  /** プロファイル名（任意） */
  name?: string;
  /** 説明（任意） */
  description?: string;
  /** インジケーター設定の配列（任意） */
  indicators?: IndicatorConfig[];
  /** デフォルトプロファイルに設定するか（任意） */
  isDefault?: boolean;
}

// ============================================================================
// プロファイルストレージ型
// ============================================================================

/**
 * プロファイルストレージの構造
 * 
 * data/indicator-profiles.json に保存される形式
 */
export interface ProfileStorage {
  /** プロファイル配列 */
  profiles: IndicatorProfile[];
  /** ストレージバージョン（マイグレーション用） */
  version: number;
  /** 最終更新日時 */
  updatedAt: Date;
}

/**
 * デフォルトのストレージを作成
 */
export function createDefaultProfileStorage(): ProfileStorage {
  return {
    profiles: [],
    version: 1,
    updatedAt: new Date(),
  };
}

// ============================================================================
// プロファイル選択オプション（UI用）
// ============================================================================

/**
 * プロファイル選択オプション
 * 
 * CSVインポートUI等で表示するドロップダウン用のオプション。
 * 特殊オプション（AI, なし）とユーザー定義プロファイルを含む。
 */
export interface ProfileOption {
  /** プロファイルIDまたは予約ID */
  id: string;
  /** 表示名 */
  label: string;
  /** 説明 */
  description: string;
  /** 特殊オプションかどうか */
  isSpecial: boolean;
  /** アイコン（emoji） */
  icon: string;
}

/**
 * 特殊オプションを含むプロファイル選択リストを生成
 */
export function buildProfileOptions(profiles: IndicatorProfile[]): ProfileOption[] {
  const options: ProfileOption[] = [
    // 特殊オプション
    {
      id: RESERVED_PROFILE_IDS.AI_AUTO,
      label: 'AIに任せる',
      description: 'Side-Bと同じ12次元特徴量を自動計算',
      isSpecial: true,
      icon: '🤖',
    },
    {
      id: RESERVED_PROFILE_IDS.NONE,
      label: 'プロファイルなし',
      description: 'OHLCVのみ保存（特徴量は計算しない）',
      isSpecial: true,
      icon: '⚪',
    },
  ];

  // ユーザー定義プロファイル
  for (const profile of profiles) {
    options.push({
      id: profile.id,
      label: profile.name,
      description: profile.description || `インジケーター ${profile.indicators.length}個`,
      isSpecial: false,
      icon: '📁',
    });
  }

  return options;
}

// ============================================================================
// ノートへの紐付け型
// ============================================================================

/**
 * ノートに保存するプロファイル情報
 * 
 * TradeNote.indicatorConfig に保存される構造。
 * プロファイルIDと、適用時点のインジケーター設定をスナップショットとして保存。
 */
export interface NoteProfileConfig {
  /** 適用したプロファイルID（または予約ID） */
  profileId: string;
  /** プロファイル名（表示用、プロファイル削除後も参照可能に） */
  profileName: string;
  /** 適用時点のインジケーター設定（スナップショット） */
  indicators: IndicatorConfig[];
  /** 発火閾値（0.0〜1.0） */
  threshold: number;
  /** 類似度計算方式 */
  similarityMethod: 'cosine' | 'euclidean' | 'manhattan';
  /** ユーザーコメント */
  userComment?: string;
  /** 設定バージョン */
  version: number;
  /** 作成日時 */
  createdAt: Date;
  /** 更新日時 */
  updatedAt: Date;
}

/**
 * プロファイルからノート設定を生成
 */
export function createNoteProfileConfig(
  profile: IndicatorProfile | null,
  profileId: string,
  threshold = 0.75
): NoteProfileConfig {
  // 特殊プロファイルの処理
  if (profileId === RESERVED_PROFILE_IDS.AI_AUTO) {
    return {
      profileId: RESERVED_PROFILE_IDS.AI_AUTO,
      profileName: 'AIに任せる',
      indicators: [], // AI_AUTOでは空（12次元は別途計算）
      threshold,
      similarityMethod: 'cosine',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  if (profileId === RESERVED_PROFILE_IDS.NONE) {
    return {
      profileId: RESERVED_PROFILE_IDS.NONE,
      profileName: 'プロファイルなし',
      indicators: [],
      threshold: 0, // マッチング対象外
      similarityMethod: 'cosine',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  // ユーザー定義プロファイル
  if (!profile) {
    throw new Error(`プロファイルが見つかりません: ${profileId}`);
  }

  return {
    profileId: profile.id,
    profileName: profile.name,
    indicators: profile.indicators.filter(i => i.enabled),
    threshold,
    similarityMethod: 'cosine',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
