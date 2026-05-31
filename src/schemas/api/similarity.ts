/**
 * 類似ノート検索 API スキーマ
 * 
 * Side-A/Side-B 横断検索エンドポイント用のZodスキーマ定義
 */

import { z } from 'zod';

/**
 * OHLCV データスキーマ
 */
export const OHLCVDataSchema = z.object({
  timestamp: z.union([z.string().datetime(), z.date()]).transform((val) => 
    typeof val === 'string' ? new Date(val) : val
  ),
  open: z.number().positive(),
  high: z.number().positive(),
  low: z.number().positive(),
  close: z.number().positive(),
  volume: z.number().nonnegative(),
});

/**
 * 類似検索リクエストスキーマ
 * 
 * OHLCVデータまたは特徴ベクトルのいずれかで検索可能
 */
export const CrossSimilaritySearchRequestSchema = z.object({
  // OHLCV データ（特徴量自動抽出）
  ohlcvData: z.array(OHLCVDataSchema).optional(),
  
  // または直接特徴ベクトルを指定（12次元配列）
  featureVector: z.array(z.number()).length(12).optional(),
  
  // フィルタオプション
  symbol: z.string().optional(),
  
  // 検索パラメータ
  topK: z.number().int().min(1).max(100).default(10),
  minSimilarity: z.number().min(0).max(1).default(0.5),
  
  // 検索対象の指定
  searchTradeNotes: z.boolean().default(true),    // Side-A TradeNote を検索
  searchAITradeNotes: z.boolean().default(true),  // Side-B AITradeNote を検索

  // AITradeNote を「本番運用」選別済みのみに限定（実行時のライブ照合用）。
  // 既定 false で従来どおり全 AITradeNote を対象にするため後方互換。
  aiNotesUsedForMatchingOnly: z.boolean().default(false),
}).refine(
  (data) => data.ohlcvData !== undefined || data.featureVector !== undefined,
  {
    message: 'ohlcvData または featureVector のいずれかを指定してください',
  }
);

/**
 * ノートタイプ（由来区別用）
 */
export const NoteTypeSchema = z.enum(['tradeNote', 'aiTradeNote']);

/**
 * 類似ノート検索結果（個別アイテム）
 */
export const SimilarNoteItemSchema = z.object({
  // 共通フィールド
  noteId: z.string(),
  noteType: NoteTypeSchema,
  similarity: z.number().min(0).max(1),
  distance: z.number().nonnegative(),
  
  // TradeNote / AITradeNote 共通の基本情報
  symbol: z.string(),
  date: z.string(),  // ISO日付文字列
  direction: z.enum(['long', 'short']).optional(),
  
  // 成績情報
  outcome: z.string().optional(),
  pnl: z.number().optional(),
  
  // 追加メタデータ
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * 類似検索レスポンススキーマ
 */
export const CrossSimilaritySearchResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    results: z.array(SimilarNoteItemSchema),
    totalCount: z.number().int().nonnegative(),
    searchStats: z.object({
      tradeNotesSearched: z.number().int().nonnegative(),
      aiTradeNotesSearched: z.number().int().nonnegative(),
      tradeNotesMatched: z.number().int().nonnegative(),
      aiTradeNotesMatched: z.number().int().nonnegative(),
    }),
  }),
});

/**
 * エラーレスポンススキーマ
 */
export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  details: z.unknown().optional(),
});

// 型推論
export type OHLCVData = z.infer<typeof OHLCVDataSchema>;
export type CrossSimilaritySearchRequest = z.infer<typeof CrossSimilaritySearchRequestSchema>;
export type NoteType = z.infer<typeof NoteTypeSchema>;
export type SimilarNoteItem = z.infer<typeof SimilarNoteItemSchema>;
export type CrossSimilaritySearchResponse = z.infer<typeof CrossSimilaritySearchResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
