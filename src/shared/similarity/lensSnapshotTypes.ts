/**
 * ノート類似度基盤 — LensSnapshot 正準型定義
 *
 * 正本設計: docs/architecture/NOTE_SIMILARITY_FOUNDATION.md §3
 *
 * 責務:
 * - ノート特徴表現の正準形 `NoteLensSnapshot` を一意に定義する
 * - 作成時(ノート生成)と照合時(マッチング)が**同一の型・同一のスキーマ**で
 *   特徴を持つことを型レベルで保証する
 * - DB(JSONB) との境界で Zod によるランタイム検証を提供する
 *
 * 設計原則(同設計書 §2):
 * - 特徴は「次元位置」ではなく「lensId + featureKey」で対応づける
 * - 拡張は加算的(キー追加・レンズ追加)に行い、既存キーの意味・値域は変えない
 * - 破壊的変更時のみ snapshotSchemaVersion を上げる
 */

import { z } from 'zod';

/** LensSnapshot スキーマの現行バージョン(破壊的変更時のみ上げる) */
export const LENS_SNAPSHOT_SCHEMA_VERSION = '1.0.0';

/**
 * JSONB との境界で使う JSON 値型。
 * 外部入力(Prisma Json 等)を `unknown` を使わずに受けるための再帰型。
 */
export type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike };

/** レンズが出力する特徴値(スカラーのみ。null/配列は不可、欠損はキー自体を出さない) */
export const LensFeatureValueSchema = z.union([z.number(), z.string(), z.boolean()]);
export type LensFeatureValue = z.infer<typeof LensFeatureValueSchema>;

/**
 * スナップショット内の 1 レンズ分のエントリ。
 * confidence はレンズ自身が申告する確度(0〜1)で、類似度集計時の重みに連動する。
 */
export const LensSnapshotEntrySchema = z.object({
  /** レンズ実装のバージョン(互換性チェック用) */
  lensVersion: z.string().min(1),
  /** レンズ自身が申告する確度(0=計算不能、1=十分なデータで計算済み) */
  confidence: z.number().min(0).max(1),
  /** featureKey → 値 のマップ。値域は各レンズのカタログ定義に従う */
  features: z.record(z.string(), LensFeatureValueSchema),
});
export type LensSnapshotEntry = z.infer<typeof LensSnapshotEntrySchema>;

/**
 * ノート特徴表現の正準形。
 * ノート作成時(eventTime=トレード時刻)も市場照合時(eventTime=評価時刻)も
 * 同じ生成コードでこの形を作る(設計書 §2-① 単一特徴定義)。
 */
export const NoteLensSnapshotSchema = z.object({
  /** 本スキーマの版。破壊的変更時のみ上げる */
  snapshotSchemaVersion: z.string().min(1),
  /** 銘柄シンボル(例: USDJPY) */
  symbol: z.string().min(1),
  /** 主時間足(例: 15m) */
  timeframe: z.string().min(1),
  /** 上位足(任意、MTF 文脈) */
  higherTimeframe: z.string().min(1).optional(),
  /** ノート=トレード時刻 / 市場側=評価時刻 (ISO 8601) */
  eventTime: z.string().datetime({ offset: true }),
  /** lensId → レンズ出力。次元位置に依存しないマップ形式 */
  lenses: z.record(z.string(), LensSnapshotEntrySchema),
});
export type NoteLensSnapshot = z.infer<typeof NoteLensSnapshotSchema>;

/**
 * DB(JSONB) から読んだ値を NoteLensSnapshot に検証付きで変換する。
 * 検証失敗(旧形式・破損)は null を返し、呼び出し側が「特徴なし」として
 * 比較対象外に倒す(設計書 §2-⑤ 欠損に強い)。
 *
 * バージョン互換(設計書 §8): スキーマ版はメジャー一致のみ受理する。
 * マイナー/パッチ差(加算的拡張)は解釈可能なので通し、メジャー差(破壊的変更)は
 * null = 比較対象外に落とす。
 */
export function parseNoteLensSnapshot(value: JsonLike | undefined): NoteLensSnapshot | null {
  if (value === null || value === undefined) {
    return null;
  }
  const result = NoteLensSnapshotSchema.safeParse(value);
  if (!result.success) {
    return null;
  }
  if (majorVersionOf(result.data.snapshotSchemaVersion) !== majorVersionOf(LENS_SNAPSHOT_SCHEMA_VERSION)) {
    return null;
  }
  return result.data;
}

/** semver 文字列のメジャー番号を取り出す(不正形式は -1 = 不一致扱い) */
function majorVersionOf(version: string): number {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isFinite(major) ? major : -1;
}

/** createNoteLensSnapshot に渡す組み立てパラメータ */
export interface CreateNoteLensSnapshotParams {
  readonly symbol: string;
  readonly timeframe: string;
  readonly higherTimeframe?: string;
  /** ノート=トレード時刻 / 市場側=評価時刻 */
  readonly eventTime: Date;
  /** lensId → エントリ。状態レンズ・インジケーターレンズの両系統を混在させる */
  readonly lenses: Readonly<Record<string, LensSnapshotEntry>>;
}

/**
 * NoteLensSnapshot を組み立てる(版の付与を一元化するための唯一の生成口)。
 */
export function createNoteLensSnapshot(params: CreateNoteLensSnapshotParams): NoteLensSnapshot {
  const snapshot: NoteLensSnapshot = {
    snapshotSchemaVersion: LENS_SNAPSHOT_SCHEMA_VERSION,
    symbol: params.symbol,
    timeframe: params.timeframe,
    eventTime: params.eventTime.toISOString(),
    lenses: { ...params.lenses },
  };
  if (params.higherTimeframe !== undefined) {
    snapshot.higherTimeframe = params.higherTimeframe;
  }
  return snapshot;
}

/**
 * Side-B 既存レンズ(LensFeature 互換オブジェクト)からスナップショットエントリを作る。
 * Side-B の型(src/side-b/lenses/types.ts LensFeature)に構造的に一致させており、
 * shared → side-b の依存を作らないため structural typing で受ける。
 */
export interface LensFeatureLike {
  readonly lensVersion: string;
  readonly features: Readonly<Record<string, number | string | boolean>>;
  readonly confidence?: number;
}

/** LensFeature 互換オブジェクト → LensSnapshotEntry 変換 */
export function lensEntryFromLensFeature(feature: LensFeatureLike): LensSnapshotEntry {
  return {
    lensVersion: feature.lensVersion,
    // confidence 未申告のレンズは「計算には成功している」前提で 1.0 と解釈する
    // (Side-B 既存レンズの慣行に合わせる。計算不能時は各レンズが 0 を明示する)
    confidence: clampConfidence(feature.confidence ?? 1),
    features: { ...feature.features },
  };
}

/** confidence を [0,1] に丸める(レンズ実装の軽微な逸脱から集計を守る) */
function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
