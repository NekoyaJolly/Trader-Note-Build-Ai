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
import type { CTraderProvider} from '../../../infrastructure/market/CTraderProvider';
import { 
  AccountInfoResponseSchema,
  PositionResponseSchema,
} from '../../../schemas/api/trading';
import type {
  AccountInfoResponse,
  PositionResponse,
} from '../../../schemas/api/trading';
import type { JsonValue } from '../../../utils/jsonValue';
import { config } from '../../../config';

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
 * cTrader ProtoOAReconcileRes スキーマ。
 * Reconcile は口座残高ではなく position[] / order[] を返す (残高は ProtoOATraderRes 側)。
 * ポジション 0 件のときは position 自体が省略されるため optional とする。
 */
const CTraderReconcileResponseSchema = z.object({
  ctidTraderAccountId: z.number(),
  position: z.array(CTraderPositionSchema).optional(),
});

/**
 * cTrader ProtoOATraderRes スキーマ (口座残高・レバレッジ等)。
 * 金額は moneyDigits 桁の整数 (例 moneyDigits=2 なら cent)。
 */
const CTraderTraderResponseSchema = z.object({
  ctidTraderAccountId: z.number(),
  trader: z.object({
    balance: z.number(),
    depositAssetId: z.number().optional(),
    leverageInCents: z.number().optional(),
    moneyDigits: z.number().optional(),
    accountType: z.number().optional(),
  }),
});

type CTraderPosition = z.infer<typeof CTraderPositionSchema>;

interface SubscribeToUpdatesOptions {
  intervalMs?: number;
}

interface CreateOrderInput {
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  takeProfit?: number;
  stopLoss?: number;
  comment?: string;
}

interface UpdateOrderInput {
  takeProfit?: number;
  stopLoss?: number;
  volume?: number;
  comment?: string;
}

export class CTraderAccountService extends EventEmitter {
  private provider: CTraderProvider;
  private accountId: string;
  private positions: Map<string, PositionResponse> = new Map();
  private pollingTimer: NodeJS.Timeout | null = null;
  private isPolling = false;

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
    // 残高・レバレッジは ProtoOATraderReq で取得する (ProtoOAReconcileReq は
    // position/order を返すだけで残高を含まないため、従来は誤った口座情報になっていた)。
    const rawResponse = await this.provider.sendCommand('ProtoOATraderReq', {
      ctidTraderAccountId: parseInt(this.accountId, 10),
    });

    // Zodバリデーション
    const result = CTraderTraderResponseSchema.safeParse(rawResponse);
    if (!result.success) {
      console.error('[CTraderAccountService] レスポンスバリデーションエラー:', result.error);
      throw new Error('cTrader API レスポンスの形式が不正です');
    }

    const trader = result.data.trader;
    // 金額は moneyDigits 桁の整数。レバレッジは cent 単位 (leverageInCents)。
    const divisor = Math.pow(10, trader.moneyDigits ?? 2);
    const balance = trader.balance / divisor;

    // ProtoOATrader は equity/margin/freeMargin を直接持たない。含み損益を加味した
    // 正確な equity 計算は別途必要なため、ここでは残高ベースの近似値を返す
    // (建玉なしのフラット時は balance と一致する)。
    const accountInfo: AccountInfoResponse = {
      accountId: this.accountId,
      ctidTraderAccountId: result.data.ctidTraderAccountId,
      balance,
      equity: balance,
      margin: 0,
      freeMargin: balance,
      marginLevel: 0,
      currency: 'USD',
      // 接続先 (config.ctrader.wsUrl) が live か demo かで判定する。固定 false だと
      // live 接続でも UI が常に DEMO 表示になるため (Copilot review PR #339)。
      isLive: config.ctrader.wsUrl.includes('live'),
      leverage: (trader.leverageInCents ?? 10000) / 100,
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
    this.startPollingUpdates({ intervalMs: 5000 });
  }

  /**
   * 購読解除
   */
  unsubscribeFromUpdates(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.isPolling = false;
    console.log('[CTraderAccountService] ポジション更新購読を解除');
  }

  /**
   * 新規注文を作成
   */
  async createOrder(input: CreateOrderInput): Promise<void> {
    const payload: Record<string, JsonValue | undefined> = {
      ctidTraderAccountId: parseInt(this.accountId, 10),
      symbolId: this.resolveSymbolId(input.symbol),
      orderType: 1, // 1: MARKET
      tradeSide: input.side === 'BUY' ? 1 : 2,
      volume: this.normalizeVolume(input.volume),
    };

    if (input.takeProfit !== undefined) {
      payload.takeProfit = input.takeProfit;
    }
    if (input.stopLoss !== undefined) {
      payload.stopLoss = input.stopLoss;
    }
    if (input.comment) {
      payload.comment = input.comment;
    }

    await this.provider.sendCommand('ProtoOANewOrderReq', payload);
  }

  /**
   * 既存注文を更新
   */
  async updateOrder(orderId: string, input: UpdateOrderInput): Promise<void> {
    const payload: Record<string, JsonValue | undefined> = {
      ctidTraderAccountId: parseInt(this.accountId, 10),
      orderId: parseInt(orderId, 10),
    };

    if (input.takeProfit !== undefined) {
      payload.takeProfit = input.takeProfit;
    }
    if (input.stopLoss !== undefined) {
      payload.stopLoss = input.stopLoss;
    }
    if (input.volume !== undefined) {
      payload.volume = this.normalizeVolume(input.volume);
    }
    if (input.comment !== undefined) {
      payload.comment = input.comment;
    }

    await this.provider.sendCommand('ProtoOAAmendOrderReq', payload);
  }

  /**
   * 注文をキャンセル
   */
  async cancelOrder(orderId: string): Promise<void> {
    await this.provider.sendCommand('ProtoOACancelOrderReq', {
      ctidTraderAccountId: parseInt(this.accountId, 10),
      orderId: parseInt(orderId, 10),
    });
  }

  /**
   * ポジションを決済
   */
  async closePosition(positionId: string, volume?: number): Promise<void> {
    const payload: Record<string, JsonValue | undefined> = {
      ctidTraderAccountId: parseInt(this.accountId, 10),
      positionId: parseInt(positionId, 10),
    };

    if (volume !== undefined) {
      payload.volume = this.normalizeVolume(volume);
    }

    await this.provider.sendCommand('ProtoOAClosePositionReq', payload);
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

  private startPollingUpdates(options: SubscribeToUpdatesOptions): void {
    const intervalMs = options.intervalMs ?? 5000;
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    // 初回スナップショットを作成してから定期監視を開始
    void this.getPositions()
      .then((initialPositions) => {
        this.positions = new Map(initialPositions.map((position) => [position.positionId, position]));
      })
      .catch((error) => {
        console.error('[CTraderAccountService] 初回ポジション取得に失敗:', error);
      });

    this.pollingTimer = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
  }

  private async pollOnce(): Promise<void> {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;
    try {
      const previous = new Map(this.positions);
      const latestPositions = await this.getPositions();
      const latest = new Map(latestPositions.map((position) => [position.positionId, position]));

      for (const [positionId, position] of latest.entries()) {
        const prev = previous.get(positionId);
        if (!prev) {
          this.emit('positionUpdate', {
            type: 'OPEN',
            position,
            timestamp: new Date().toISOString(),
          });
          continue;
        }

        if (!this.isSamePosition(prev, position)) {
          this.emit('positionUpdate', {
            type: 'MODIFY',
            position,
            timestamp: new Date().toISOString(),
          });
        }
      }

      for (const [positionId, position] of previous.entries()) {
        if (!latest.has(positionId)) {
          this.emit('positionUpdate', {
            type: 'CLOSE',
            position,
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch (error) {
      console.error('[CTraderAccountService] ポーリング更新エラー:', error);
      this.emit('error', error);
    } finally {
      this.isPolling = false;
    }
  }

  private isSamePosition(before: PositionResponse, after: PositionResponse): boolean {
    return (
      before.currentPrice === after.currentPrice &&
      before.profitLoss === after.profitLoss &&
      before.profitLossPips === after.profitLossPips &&
      before.takeProfit === after.takeProfit &&
      before.stopLoss === after.stopLoss &&
      before.volume === after.volume
    );
  }

  private normalizeVolume(volumeLot: number): number {
    return Math.round(volumeLot * 100);
  }

  private resolveSymbolId(symbol: string): number {
    const normalized = symbol.replace('/', '').toUpperCase();
    const symbolIdMap: Record<string, number> = {
      XAUUSD: 1,
      EURUSD: 2,
      USDJPY: 3,
      GBPUSD: 4,
    };

    const symbolId = symbolIdMap[normalized];
    if (!symbolId) {
      throw new Error(`未対応のシンボルです: ${symbol}`);
    }
    return symbolId;
  }
}
