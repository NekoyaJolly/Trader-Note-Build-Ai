/**
 * MatchResultDTO: Prisma 非依存のマッチ結果 DTO
 * 
 * 責務:
 * - Service / Controller 層で使用するマッチ結果の型定義
 * - Prisma 型への依存を Repository 層に閉じ込める
 * - Layer1/2 のファイル保存・通知判定・UI 表示で利用する
 */

import { MatchResult, MarketSnapshot, Prisma } from '@prisma/client';

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
  /** 市場スナップショット（Layer1 データ） */
  marketSnapshot: unknown;
  /** 市場スナップショット ID（DB 永続化用） */
  marketSnapshotId?: string;
  /** 銘柄シンボル */
  symbol?: string;
  /** 判定に使用した閾値 */
  threshold?: number;
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
  const obj = reasonsJson as Record<string, unknown>;
  if (Array.isArray(obj.explanations)) {
    return obj.explanations.filter((r): r is string => typeof r === 'string');
  }
  if (Array.isArray(obj.messages)) {
    return obj.messages.filter((r): r is string => typeof r === 'string');
  }
  
  return [];
}
