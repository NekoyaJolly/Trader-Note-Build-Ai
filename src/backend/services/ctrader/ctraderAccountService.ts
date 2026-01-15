/**
 * cTrader 口座情報取得サービス
 * 
 * 目的: cTrader口座の残高・ポジション情報を取得し、リアルタイム更新を配信
 * 
 * 責務:
 * - 口座残高・証拠金情報の取得
 * - 保有ポジションの取得
 * - ポジション更新イベントの購読
 * 
 * 注意:
 * - リアル口座・デモ口座の両方に対応
 * - WebSocket接続が必要（CTraderProvider経由）
 */

import { EventEmitter } from 'events';
import { z } from 'zod';
import { CTraderProvider, CTraderMessageType } from '../../../infrastructure/market/CTraderProvider';
import { 
  AccountInfoResponseSchema,
  PositionResponseSchema,
} from '../../../schemas/api/trading';
import type {
  AccountInfoResponse,
  PositionResponse,
} from '../../../schemas/api/trading';

// ========================================
// cTrader API レスポンス用Zodスキーマ
// ========================================

/**
 * cTrader TradeData スキーマ
 */
const CTraderTradeDataSchema = z.object({
  tradeSide: z.number(),  // 1: BUY, 2: SELL
  volume: z.number(),     // cent単位
});

/**
 * cTrader ポジション情報スキーマ
 */
const CTraderPositionSchema = z.object({
  positionId: z.number(),
  symbolName: z.string().optional(),
  tradeData: CTraderTradeDataSchema.optional(),
  price: z.number(),
  currentPrice: z.number().optional(),
  swap: z.number(),         // cent単位
  commission: z.number(),   // cent単位
  grossProfit: z.number(),  // cent単位
  pips: z.number().optional(),
  takeProfit: z.number().optional(),
  stopLoss: z.number().optional(),
  utcLastUpdateTimestamp: z.number(),
  comment: z.string().optional(),
});

/**
 * cTrader ProtoOAReconcileRes スキーマ
 */
const CTraderReconcileResponseSchema = z.object({
  ctidTraderAccountId: z.number(),
  balance: z.number(),        // cent単位
  equity: z.number().optional(),        // cent単位
  margin: z.number().optional(),        // cent単位
  freeMargin: z.number().optional(),    // cent単位
  marginLevel: z.number().optional(),   // パーセント
  currency: z.string().optional(),
  isLive: z.boolean().optional(),
  leverage: z.number().optional(),
  position: z.array(CTraderPositionSchema).optional(),
});

type CTraderPosition = z.infer<typeof CTraderPositionSchema>;
type CTraderReconcileResponse = z.infer<typeof CTraderReconcileResponseSchema>;

export class CTraderAccountService extends EventEmitter {
  private provider: CTraderProvider;
  private accountId: string;
  private positions: Map<string, PositionResponse> = new Map();

  constructor(provider: CTraderProvider, accountId: string) {
    super();
    this.provider = provider;
    this.accountId = accountId;
  }

  /**
   * 口座情報を取得
   * 
   * @returns 口座残高・証拠金情報
   */
  async getAccountInfo(): Promise<AccountInfoResponse> {
    // CTraderProvider経由でProtoOAReconcileReqを送信
    const rawResponse = await this.provider.sendCommand('ProtoOAReconcileReq', {
      ctidTraderAccountId: parseInt(this.accountId, 10),
    });

    // Zodバリデーション
    const result = CTraderReconcileResponseSchema.safeParse(rawResponse);
    if (!result.success) {
      console.error('[CTraderAccountService] レスポンスバリデーションエラー:', result.error);
      throw new Error('cTrader API レスポンスの形式が不正です');
    }

    const response = result.data;

    const accountInfo: AccountInfoResponse = {
      accountId: this.accountId,
      ctidTraderAccountId: response.ctidTraderAccountId,
      balance: response.balance / 100, // centから変換
      equity: (response.equity || response.balance) / 100,
      margin: (response.margin || 0) / 100,
      freeMargin: (response.freeMargin || response.balance) / 100,
      marginLevel: response.marginLevel || 0,
      currency: response.currency || 'USD',
      isLive: response.isLive ?? false,
      leverage: response.leverage ?? 100,
    };

    // レスポンススキーマでバリデーション
    return AccountInfoResponseSchema.parse(accountInfo);
  }

  /**
   * 保有ポジション一覧を取得
   * 
   * @returns ポジション配列
   */
  async getPositions(): Promise<PositionResponse[]> {
    const rawResponse = await this.provider.sendCommand('ProtoOAReconcileReq', {
      ctidTraderAccountId: parseInt(this.accountId, 10),
    });

    // Zodバリデーション
    const result = CTraderReconcileResponseSchema.safeParse(rawResponse);
    if (!result.success) {
      console.error('[CTraderAccountService] レスポンスバリデーションエラー:', result.error);
      throw new Error('cTrader API レスポンスの形式が不正です');
    }

    const response = result.data;
    const positions: PositionResponse[] = [];
    
    for (const pos of response.position || []) {
      const position = this.parsePosition(pos);
      this.positions.set(position.positionId, position);
      positions.push(position);
    }

    return positions;
  }

  /**
   * ポジション更新イベントを購読
   * 
   * 注意: CTraderProvider が EventEmitter ではないため、
   * executionEvent のハンドリングは今後の拡張課題。
   * 現時点ではポーリングによる定期更新を推奨。
   */
  subscribeToUpdates(): void {
    // プレースホルダー実装
    // 今後、CTraderProviderをEventEmitterに拡張するか、
    // ポーリングによる定期更新で対応
    console.log('[CTraderAccountService] ポジション更新購読を開始（プレースホルダー）');
  }

  /**
   * 購読解除
   */
  unsubscribeFromUpdates(): void {
    console.log('[CTraderAccountService] ポジション更新購読を解除');
  }

  // ========================================
  // プライベートメソッド
  // ========================================

  /**
   * cTraderポジション情報をパース
   * 
   * @param data - cTrader API レスポンス
   * @returns パース済みポジション情報
   */
  private parsePosition(data: CTraderPosition): PositionResponse {
    const position: PositionResponse = {
      positionId: data.positionId.toString(),
      symbol: data.symbolName || 'UNKNOWN',
      side: data.tradeData?.tradeSide === 1 ? 'BUY' : 'SELL',
      volume: (data.tradeData?.volume || 0) / 100,
      entryPrice: data.price,
      currentPrice: data.currentPrice || data.price,
      profitLoss: (data.swap + data.commission + data.grossProfit) / 100,
      profitLossPips: data.pips || 0,
      swap: data.swap / 100,
      commission: data.commission / 100,
      takeProfit: data.takeProfit,
      stopLoss: data.stopLoss,
      openTime: new Date(data.utcLastUpdateTimestamp).toISOString(),
      comment: data.comment,
    };

    // レスポンススキーマでバリデーション
    return PositionResponseSchema.parse(position);
  }
}
