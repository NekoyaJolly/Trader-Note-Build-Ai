/**
 * トレードAPI Zodスキーマ
 * 
 * 目的: トレード・ノート関連のAPI操作で使用するスキーマ
 */

import { z } from 'zod';
import { 
  UUIDSchema, 
  DateSchema, 
  SymbolSchema, 
  TimeframeSchema,
  DirectionSchema,
  PriceSchema,
  LotSizeSchema,
  ScoreSchema,
  NonEmptyStringSchema,
  PaginationSchema,
} from '../common';

// ========================================
// トレードスキーマ
// ========================================

/**
 * トレード方向（正規化済み）
 */
export const NormalizedDirectionSchema = z.enum(['BUY', 'SELL']);

export type NormalizedDirection = z.infer<typeof NormalizedDirectionSchema>;

/**
 * トレードデータ
 */
export const TradeSchema = z.object({
  id: UUIDSchema,
  symbol: SymbolSchema,
  direction: NormalizedDirectionSchema,
  entryPrice: PriceSchema,
  exitPrice: PriceSchema.optional(),
  lotSize: LotSizeSchema,
  entryTime: DateSchema,
  exitTime: DateSchema.optional(),
  profitLoss: z.number().optional(),
  profitLossPips: z.number().optional(),
  commission: z.number().optional(),
  swap: z.number().optional(),
  comment: z.string().optional(),
  magicNumber: z.number().optional(),
  ticketNumber: z.string().optional(),
});

export type Trade = z.infer<typeof TradeSchema>;

/**
 * CSVインポートリクエスト（基本）
 */
export const ImportCSVRequestSchema = z.object({
  filename: z.string().min(1, 'ファイル名は必須です'),
  csvText: z.string().min(1, 'CSVデータは必須です'),
});

export type ImportCSVRequest = z.infer<typeof ImportCSVRequestSchema>;

// ========================================
// ノートスキーマ
// ========================================

/**
 * ノートステータス
 */
export const NoteStatusSchema = z.enum([
  'draft',      // 下書き
  'active',     // アクティブ（監視中）
  'matched',    // マッチ済み
  'expired',    // 期限切れ
  'archived',   // アーカイブ
]);

export type NoteStatus = z.infer<typeof NoteStatusSchema>;

/**
 * ノート基本情報
 */
export const NoteSchema = z.object({
  id: UUIDSchema,
  tradeId: UUIDSchema,
  symbol: SymbolSchema,
  direction: NormalizedDirectionSchema,
  timeframe: TimeframeSchema,
  status: NoteStatusSchema,
  entryTime: DateSchema,
  entryPrice: PriceSchema,
  exitTime: DateSchema.optional(),
  exitPrice: PriceSchema.optional(),
  profitLoss: z.number().optional(),
  profitLossPips: z.number().optional(),
  matchScore: ScoreSchema.optional(),
  lastMatchedAt: DateSchema.optional(),
  aiSummary: z.string().optional(),
  userNotes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  createdAt: DateSchema,
  updatedAt: DateSchema,
});

export type Note = z.infer<typeof NoteSchema>;

/**
 * ノート更新リクエスト
 */
export const UpdateNoteRequestSchema = z.object({
  aiSummary: z.string().optional(),
  userNotes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: NoteStatusSchema.optional(),
});

export type UpdateNoteRequest = z.infer<typeof UpdateNoteRequestSchema>;

/**
 * ノート一覧クエリパラメータ
 */
export const GetNotesQuerySchema = PaginationSchema.extend({
  status: NoteStatusSchema.optional(),
  symbol: SymbolSchema.optional(),
  direction: NormalizedDirectionSchema.optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export type GetNotesQuery = z.infer<typeof GetNotesQuerySchema>;

// ========================================
// マッチング結果スキーマ
// ========================================

/**
 * マッチング理由
 */
export const MatchReasonsSchema = z.object({
  messages: z.array(z.string()),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type MatchReasons = z.infer<typeof MatchReasonsSchema>;

/**
 * マッチング結果
 */
export const MatchResultSchema = z.object({
  noteId: UUIDSchema,
  score: ScoreSchema,
  matchedAt: DateSchema,
  reasons: MatchReasonsSchema,
  featureVector: z.array(z.number()).optional(),
  marketSnapshot: z.record(z.string(), z.unknown()).optional(),
});

export type MatchResult = z.infer<typeof MatchResultSchema>;

// ========================================
// OHLCV スキーマ
// ========================================

/**
 * OHLCVデータポイント
 */
export const OHLCVSchema = z.object({
  timestamp: DateSchema,
  open: PriceSchema,
  high: PriceSchema,
  low: PriceSchema,
  close: PriceSchema,
  volume: z.number().min(0),
});

export type OHLCV = z.infer<typeof OHLCVSchema>;

/**
 * OHLCVデータ取得リクエスト
 */
export const GetOHLCVRequestSchema = z.object({
  symbol: SymbolSchema,
  timeframe: TimeframeSchema,
  startDate: z.string(),
  endDate: z.string(),
});

export type GetOHLCVRequest = z.infer<typeof GetOHLCVRequestSchema>;

// ========================================
// トレードルート用リクエストスキーマ
// ========================================

/**
 * CSVアップロードリクエスト
 */
export const UploadCSVTextRequestSchema = z.object({
  csvText: z.string().min(1, 'CSVデータは必須です'),
  profileId: z.string().optional().default('__AI_AUTO__'),
});

export type UploadCSVTextRequest = z.infer<typeof UploadCSVTextRequestSchema>;

/**
 * ノートID URLパラメータ
 */
export const NoteIdParamSchema = z.object({
  id: UUIDSchema,
});

export type NoteIdParam = z.infer<typeof NoteIdParamSchema>;

/**
 * 優先度更新リクエスト
 */
export const UpdatePriorityRequestSchema = z.object({
  priority: z.number().int().min(1).max(10),
});

export type UpdatePriorityRequest = z.infer<typeof UpdatePriorityRequestSchema>;

/**
 * 有効/無効切り替えリクエスト
 */
export const SetEnabledRequestSchema = z.object({
  enabled: z.boolean(),
});

export type SetEnabledRequest = z.infer<typeof SetEnabledRequestSchema>;

/**
 * 一時停止リクエスト
 */
export const SetPausedUntilRequestSchema = z.object({
  pausedUntil: z.string().nullable(),  // ISO 8601 形式、または null で解除
});

export type SetPausedUntilRequest = z.infer<typeof SetPausedUntilRequestSchema>;

/**
 * パフォーマンスランキングクエリ
 */
export const PerformanceRankingQuerySchema = z.object({
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  timeframe: TimeframeSchema.optional(),
});

export type PerformanceRankingQuery = z.infer<typeof PerformanceRankingQuerySchema>;

/**
 * 一括パフォーマンス取得リクエスト
 */
export const BulkPerformanceRequestSchema = z.object({
  noteIds: z.array(UUIDSchema).min(1, '少なくとも1つのノートIDが必要です'),
  from: z.string().optional(),
  to: z.string().optional(),
});

export type BulkPerformanceRequest = z.infer<typeof BulkPerformanceRequestSchema>;

/**
 * パフォーマンスレポートクエリ
 */
export const PerformanceReportQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  timeframe: TimeframeSchema.optional(),
  weakThreshold: z.string().transform(Number).pipe(z.number().min(0).max(1)).optional(),
});

export type PerformanceReportQuery = z.infer<typeof PerformanceReportQuerySchema>;
