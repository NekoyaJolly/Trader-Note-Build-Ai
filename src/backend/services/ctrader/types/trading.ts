/**
 * cTrader トレード関連の型定義
 * 
 * 目的: 口座情報・ポジション情報の型安全な管理
 * 
 * 機能:
 * - AccountInfo: 口座残高・証拠金情報
 * - Position: 保有ポジション情報
 * - PositionUpdate: リアルタイムポジション更新イベント
 */

import { z } from 'zod';

// ========================================
// Zodスキーマ定義
// ========================================

/**
 * 口座情報スキーマ
 */
export const AccountInfoSchema = z.object({
  accountId: z.string(),
  ctidTraderAccountId: z.number(),
  balance: z.number(),           // 残高
  equity: z.number(),            // 有効証拠金
  margin: z.number(),            // 使用証拠金
  freeMargin: z.number(),        // 余剰証拠金
  marginLevel: z.number(),       // 証拠金維持率 (%)
  currency: z.string(),          // 口座通貨
  isLive: z.boolean(),           // Live/Demo
  leverage: z.number(),          // レバレッジ
});

export type AccountInfo = z.infer<typeof AccountInfoSchema>;

/**
 * ポジション情報スキーマ
 */
export const PositionSchema = z.object({
  positionId: z.string(),
  symbol: z.string(),
  side: z.enum(['BUY', 'SELL']),
  volume: z.number(),            // ロット数
  entryPrice: z.number(),
  currentPrice: z.number(),
  profitLoss: z.number(),        // 損益
  profitLossPips: z.number(),    // pips
  swap: z.number(),              // スワップ
  commission: z.number(),        // 手数料
  takeProfit: z.number().optional(),
  stopLoss: z.number().optional(),
  openTime: z.date(),
  comment: z.string().optional(),
});

export type Position = z.infer<typeof PositionSchema>;

/**
 * ポジション更新イベントスキーマ
 */
export const PositionUpdateSchema = z.object({
  type: z.enum(['OPEN', 'MODIFY', 'CLOSE']),
  position: PositionSchema,
  timestamp: z.date(),
});

export type PositionUpdate = z.infer<typeof PositionUpdateSchema>;

// ========================================
// cTrader API レスポンス型（参考）
// ========================================

/**
 * cTrader ProtoOAReconcileRes の簡易型定義
 * 実際のレスポンスはこれより詳細な情報を含む
 */
export interface CTraderReconcileResponse {
  ctidTraderAccountId: number;
  balance: number;        // cent単位 (要: /100 変換)
  equity?: number;        // cent単位
  margin?: number;        // cent単位
  freeMargin?: number;    // cent単位
  marginLevel?: number;   // パーセント
  currency?: string;
  isLive?: boolean;
  leverage?: number;
  position?: CTraderPosition[];
}

/**
 * cTrader ポジション情報
 */
export interface CTraderPosition {
  positionId: number;
  symbolName?: string;
  tradeData?: {
    tradeSide: number;  // 1: BUY, 2: SELL
    volume: number;     // cent単位 (要: /100 変換)
  };
  price: number;
  currentPrice?: number;
  swap: number;         // cent単位
  commission: number;   // cent単位
  grossProfit: number;  // cent単位
  pips?: number;
  takeProfit?: number;
  stopLoss?: number;
  utcLastUpdateTimestamp: number;
  comment?: string;
}

/**
 * cTrader ExecutionEvent
 */
export interface CTraderExecutionEvent {
  executionType: number;  // 2: OPEN, 3: CLOSE, その他: MODIFY
  position: CTraderPosition;
  utcLastUpdateTimestamp: number;
}
