/**
 * MatchResultDTO: Prisma 非依存のマッチ結果 DTO
 * 
 * 責務:
 * - Service / Controller 層で使用するマッチ結果の型定義
 * - Prisma 型への依存を Repository 層に閉じ込める
 * - Layer1/2 のファイル保存・通知判定・UI 表示で利用する
 */

import type { MatchResult, MarketSnapshot, Prisma } from '@prisma/client';
import type { NotificationPreferenceLimitSource } from '../../services/notification/notificationPreferenceService';

/**
 * DB から取得した MatchResult の型（関連テーブル含む）
 */
type MatchResultWithSnapshot = MatchResult & {
  marketSnapshot?: MarketSnapshot | null;
};

export interface MatchResultDTO {
  /** マッチ結果 ID (UUID) */
  id: string;
  /** 一致スコア (0.0 - 1.0) */
  matchScore: number;
  /** 過去トレードノート ID */
  historicalNoteId: string;
  /** 由来ノートの所有ユーザー ID。通知上限を user 単位で判定するために使う */
  userId?: string | null;
  /**
   * 市場スナップショット（Layer1 データ）。
   * - Prisma の MarketSnapshot リレーション (取得済みの場合)
   * - アプリ内の MarketData 構造 (リアルタイム/直近相場)
   * - 空オブジェクト (取得失敗時のフォールバック)
   * のいずれかが入る。広い具体型として object で受ける。
   */
  marketSnapshot: object;
  /** 市場スナップショット ID（DB 永続化用） */
  marketSnapshotId?: string;
  /** 銘柄シンボル */
  symbol?: string;
  /** 判定に使用した閾値 */
  threshold?: number;
  /**
   * ユーザー設定による再通知クールダウン (ミリ秒、Phase β-2a)。
   * 未設定時はトリガ判定側の既定 (NOTIFICATION_COOLDOWN_MS) を使う
   */
  cooldownMsOverride?: number;
  /** ユーザー設定による 24h 通知上限。未設定時はトリガ判定側の既定を使う */
  maxPerDayOverride?: number;
  /** maxPerDayOverride を採用した scope。skip reason の監査情報に使う */
  maxPerDaySource?: NotificationPreferenceLimitSource;
  /** トレンド一致の有無 */
  trendMatched?: boolean;
  /** 価格レンジ一致の有無 */
  priceRangeMatched?: boolean;
  /** 判定理由（人間可読な日本語） */
  reasons?: string[];
  /** 
   * 警告メッセージ（異常値検出時など）
   * 
   * 無界インジケーター（OBV, VWAP, ATR, MACD等）が
   * 過去の平均から±3σ以上乖離している場合に警告を出す
   */
  warnings?: string[];
  /** 評価実行時刻 */
  evaluatedAt: Date;
  /** 作成時刻 */
  createdAt?: Date;
}

/**
 * DB から取得した MatchResult を DTO に変換するヘルパー関数
 * Repository 層で使用する
 * 
 * @param dbRecord - Prisma から取得した MatchResult（関連テーブル含む可能性あり）
 * @returns MatchResultDTO
 */
export function toMatchResultDTO(dbRecord: MatchResultWithSnapshot): MatchResultDTO {
  // reasons を安全に配列として抽出
  const reasons = extractReasons(dbRecord.reasons);
  
  return {
    id: dbRecord.id,
    matchScore: dbRecord.score,
    historicalNoteId: dbRecord.noteId,
    userId: dbRecord.userId,
    marketSnapshot: dbRecord.marketSnapshot || {},
    marketSnapshotId: dbRecord.marketSnapshotId,
    symbol: dbRecord.symbol,
    threshold: dbRecord.threshold,
    trendMatched: dbRecord.trendMatched,
    priceRangeMatched: dbRecord.priceRangeMatched,
    reasons,
    warnings: [],  // DB スキーマには warnings フィールドがないため空配列
    evaluatedAt: dbRecord.evaluatedAt,
    createdAt: dbRecord.createdAt,
  };
}

/**
 * JSON 形式の reasons から文字列配列を抽出する
 * 
 * @param reasonsJson - DB から取得した reasons フィールド（Prisma.JsonValue）
 * @returns 人間可読な理由の配列
 */
function extractReasons(reasonsJson: Prisma.JsonValue): string[] {
  if (!reasonsJson || typeof reasonsJson !== 'object') {
    return [];
  }
  
  // 配列形式の場合
  if (Array.isArray(reasonsJson)) {
    return reasonsJson.filter((r): r is string => typeof r === 'string');
  }
  
  // オブジェクト形式の場合（新形式: { explanations: string[] }）
  // この時点で reasonsJson は object (Array でなく null でない) と確定しており、
  // Prisma.JsonValue のうち JsonObject に narrow 済みのためアサーション不要。
  const obj = reasonsJson;
  if (Array.isArray(obj.explanations)) {
    return obj.explanations.filter((r): r is string => typeof r === 'string');
  }
  if (Array.isArray(obj.messages)) {
    return obj.messages.filter((r): r is string => typeof r === 'string');
  }
  
  return [];
}
