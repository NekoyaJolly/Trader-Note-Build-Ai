/**
 * MatchResultDTO: Prisma 非依存のマッチ結果 DTO
 * 
 * 責務:
 * - Service / Controller 層で使用するマッチ結果の型定義
 * - Prisma 型への依存を Repository 層に閉じ込める
 * - Layer1/2 のファイル保存・通知判定・UI 表示で利用する
 */
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
  /** 評価実行時刻 */
  evaluatedAt: Date;
  /** 作成時刻 */
  createdAt?: Date;
}

/**
 * DB から取得した MatchResult を DTO に変換するヘルパー関数
 * Repository 層で使用する
 */
export function toMatchResultDTO(dbRecord: any): MatchResultDTO {
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
    reasons: Array.isArray(dbRecord.reasons) ? dbRecord.reasons : [],
    evaluatedAt: dbRecord.evaluatedAt,
    createdAt: dbRecord.createdAt,
  };
}
