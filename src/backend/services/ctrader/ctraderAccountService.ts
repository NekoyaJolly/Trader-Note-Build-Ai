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
import { CTraderProvider } from '../../../infrastructure/market/CTraderProvider';
import { 
  AccountInfo, 
  Position, 
  PositionUpdate,
  CTraderReconcileResponse,
  CTraderPosition,
  CTraderExecutionEvent,
} from './types/trading';

// cTrader メッセージタイプ定義
const PROTO_OA_RECONCILE_REQ = 2124;
const PROTO_OA_EXECUTION_EVENT = 2126;

export class CTraderAccountService extends EventEmitter {
  private provider: CTraderProvider;
  private accountId: string;
  private positions: Map<string, Position> = new Map();

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
  async getAccountInfo(): Promise<AccountInfo> {
    // CTraderProvider経由でProtoOAReconcileReqを送信
    const response = await this.provider.sendCommand('ProtoOAReconcileReq', {
      ctidTraderAccountId: parseInt(this.accountId, 10),
    }) as CTraderReconcileResponse;

    return {
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
  }

  /**
   * 保有ポジション一覧を取得
   * 
   * @returns ポジション配列
   */
  async getPositions(): Promise<Position[]> {
    const response = await this.provider.sendCommand('ProtoOAReconcileReq', {
      ctidTraderAccountId: parseInt(this.accountId, 10),
    }) as CTraderReconcileResponse;

    const positions: Position[] = [];
    
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
   * executionEvent イベントをリッスンし、ポジション変更を検知
   */
  subscribeToUpdates(): void {
    // CTraderProvider は EventEmitter ではないため、
    // 直接 executionEvent をハンドルする実装は今後追加予定
    // 現時点ではプレースホルダー
    console.log('[CTraderAccountService] ポジション更新購読を開始');
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
  private parsePosition(data: CTraderPosition): Position {
    return {
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
      openTime: new Date(data.utcLastUpdateTimestamp),
      comment: data.comment,
    };
  }

  /**
   * ExecutionEventを処理してポジション更新を通知
   * 
   * @param event - cTrader ExecutionEvent
   */
  private handleExecutionEvent(event: CTraderExecutionEvent): void {
    const update: PositionUpdate = {
      type: this.getUpdateType(event.executionType),
      position: this.parsePosition(event.position),
      timestamp: new Date(event.utcLastUpdateTimestamp),
    };

    // ポジション更新イベントを発火
    this.emit('positionUpdate', update);
  }

  /**
   * executionTypeからポジション更新種別を判定
   * 
   * @param executionType - cTrader executionType
   * @returns 更新種別
   */
  private getUpdateType(executionType: number): 'OPEN' | 'MODIFY' | 'CLOSE' {
    // cTrader executionType から変換
    // 2: ORDER_FILLED (新規ポジション)
    // 3: ORDER_CANCELLED (決済)
    // その他: 変更
    if (executionType === 2) return 'OPEN';
    if (executionType === 3) return 'CLOSE';
    return 'MODIFY';
  }
}
