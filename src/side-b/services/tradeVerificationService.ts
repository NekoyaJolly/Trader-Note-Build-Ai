/**
 * トレード検証サービス
 * 
 * 目的: 高安値ベースでの正確なエントリー・決済判定
 * 
 * 設計思想:
 * - 1分足OHLCVデータを使用して正確なタイミングを特定
 * - エントリー判定: 高値/安値が予定価格を貫通したか
 * - 決済判定: 高値/安値がSL/TPに到達したか
 * - SL/TPが同一バーで両方ヒットした場合はSL優先（保守的判定）
 * 
 * @see docs/side-b/phase-b-virtual-trading.md
 */

import type { TradeDirection, ExitReason } from '../models/virtualTrade';

// ===========================================
// 型定義
// ===========================================

/**
 * 1分足OHLCVデータ
 */
export interface MinuteOHLCV {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/**
 * エントリー検証結果
 */
export interface EntryVerificationResult {
  /** エントリー条件を満たしたか */
  triggered: boolean;
  /** エントリーが発生したバーのタイムスタンプ */
  entryTime?: Date;
  /** 実際のエントリー価格（予定価格 or バーの始値/高値/安値） */
  entryPrice?: number;
  /** 判定理由 */
  reason: string;
}

/**
 * 決済検証結果
 */
export interface ExitVerificationResult {
  /** 決済条件を満たしたか */
  triggered: boolean;
  /** 決済理由（SL/TP） */
  exitReason?: ExitReason;
  /** 決済が発生したバーのタイムスタンプ */
  exitTime?: Date;
  /** 実際の決済価格 */
  exitPrice?: number;
  /** 判定理由 */
  reason: string;
}

/**
 * 包括的な検証結果（エントリー + 決済を一括判定）
 */
export interface TradeVerificationResult {
  /** トレードの状態が変化したか */
  stateChanged: boolean;
  /** エントリー検証結果（pending → open） */
  entry?: EntryVerificationResult;
  /** 決済検証結果（open → closed） */
  exit?: ExitVerificationResult;
  /** 処理したバー数 */
  processedBars: number;
  /** 最後に処理したバーのタイムスタンプ */
  lastProcessedTime?: Date;
}

// ===========================================
// エントリー検証
// ===========================================

/**
 * 高安値ベースでエントリー条件を検証
 * 
 * ロジック:
 * - Long: 安値が予定価格以下になったらエントリー（指値買い想定）
 * - Short: 高値が予定価格以上になったらエントリー（指値売り想定）
 * 
 * @param ohlcvData 1分足OHLCVデータ（時系列順）
 * @param direction トレード方向
 * @param plannedEntry 予定エントリー価格
 * @returns エントリー検証結果
 */
export function verifyEntryCondition(
  ohlcvData: MinuteOHLCV[],
  direction: TradeDirection,
  plannedEntry: number,
): EntryVerificationResult {
  // データがない場合
  if (!ohlcvData || ohlcvData.length === 0) {
    return {
      triggered: false,
      reason: 'OHLCVデータがありません',
    };
  }

  for (const bar of ohlcvData) {
    if (direction === 'long') {
      // Long: 安値が予定価格以下でエントリー（より有利な価格で約定）
      if (bar.low <= plannedEntry) {
        // エントリー価格の決定
        // - 始値が予定価格以下: 始値で約定（ギャップダウン）
        // - そうでなければ: 予定価格で約定
        const actualEntry = bar.open <= plannedEntry ? bar.open : plannedEntry;
        
        return {
          triggered: true,
          entryTime: bar.timestamp,
          entryPrice: actualEntry,
          reason: `安値(${bar.low.toFixed(4)})が予定価格(${plannedEntry.toFixed(4)})以下に到達`,
        };
      }
    } else {
      // Short: 高値が予定価格以上でエントリー（より有利な価格で約定）
      if (bar.high >= plannedEntry) {
        // エントリー価格の決定
        // - 始値が予定価格以上: 始値で約定（ギャップアップ）
        // - そうでなければ: 予定価格で約定
        const actualEntry = bar.open >= plannedEntry ? bar.open : plannedEntry;
        
        return {
          triggered: true,
          entryTime: bar.timestamp,
          entryPrice: actualEntry,
          reason: `高値(${bar.high.toFixed(4)})が予定価格(${plannedEntry.toFixed(4)})以上に到達`,
        };
      }
    }
  }

  // どのバーでも条件を満たさなかった
  return {
    triggered: false,
    reason: `${ohlcvData.length}本のバーでエントリー条件未達成`,
  };
}

// ===========================================
// 決済検証
// ===========================================

/**
 * 高安値ベースでSL/TP到達を検証
 * 
 * ロジック:
 * - Long SL: 安値がSL以下
 * - Long TP: 高値がTP以上
 * - Short SL: 高値がSL以上
 * - Short TP: 安値がTP以下
 * 
 * 重要: SLとTPが同一バーで両方ヒットした場合はSL優先（保守的判定）
 * 
 * @param ohlcvData 1分足OHLCVデータ（時系列順）
 * @param direction トレード方向
 * @param stopLoss ストップロス価格
 * @param takeProfit テイクプロフィット価格
 * @returns 決済検証結果
 */
export function verifyExitCondition(
  ohlcvData: MinuteOHLCV[],
  direction: TradeDirection,
  stopLoss: number,
  takeProfit: number,
): ExitVerificationResult {
  // データがない場合
  if (!ohlcvData || ohlcvData.length === 0) {
    return {
      triggered: false,
      reason: 'OHLCVデータがありません',
    };
  }

  for (const bar of ohlcvData) {
    // SLとTPの両方を同じバーでチェック
    const slHit = checkStopLossHit(direction, bar, stopLoss);
    const tpHit = checkTakeProfitHit(direction, bar, takeProfit);

    // 両方ヒットした場合はSL優先（保守的判定）
    if (slHit.hit && tpHit.hit) {
      return {
        triggered: true,
        exitReason: 'stop_loss',
        exitTime: bar.timestamp,
        exitPrice: slHit.price,
        reason: `SL/TP同時ヒット（SL優先）: SL=${stopLoss.toFixed(4)}, TP=${takeProfit.toFixed(4)}`,
      };
    }

    // SLのみヒット
    if (slHit.hit) {
      return {
        triggered: true,
        exitReason: 'stop_loss',
        exitTime: bar.timestamp,
        exitPrice: slHit.price,
        reason: slHit.reason,
      };
    }

    // TPのみヒット
    if (tpHit.hit) {
      return {
        triggered: true,
        exitReason: 'take_profit',
        exitTime: bar.timestamp,
        exitPrice: tpHit.price,
        reason: tpHit.reason,
      };
    }
  }

  // どのバーでも条件を満たさなかった
  return {
    triggered: false,
    reason: `${ohlcvData.length}本のバーでSL/TP未到達`,
  };
}

/**
 * ストップロスヒットチェック
 */
function checkStopLossHit(
  direction: TradeDirection,
  bar: MinuteOHLCV,
  stopLoss: number,
): { hit: boolean; price: number; reason: string } {
  if (direction === 'long') {
    // Long: 安値がSL以下でストップ
    if (bar.low <= stopLoss) {
      // 実際の決済価格の決定
      // - 始値がSL以下: 始値で決済（ギャップダウン）
      // - そうでなければ: SL価格で決済
      const price = bar.open <= stopLoss ? bar.open : stopLoss;
      return {
        hit: true,
        price,
        reason: `Long SL到達: 安値(${bar.low.toFixed(4)}) <= SL(${stopLoss.toFixed(4)})`,
      };
    }
  } else {
    // Short: 高値がSL以上でストップ
    if (bar.high >= stopLoss) {
      const price = bar.open >= stopLoss ? bar.open : stopLoss;
      return {
        hit: true,
        price,
        reason: `Short SL到達: 高値(${bar.high.toFixed(4)}) >= SL(${stopLoss.toFixed(4)})`,
      };
    }
  }

  return { hit: false, price: 0, reason: '' };
}

/**
 * テイクプロフィットヒットチェック
 */
function checkTakeProfitHit(
  direction: TradeDirection,
  bar: MinuteOHLCV,
  takeProfit: number,
): { hit: boolean; price: number; reason: string } {
  if (direction === 'long') {
    // Long: 高値がTP以上で利確
    if (bar.high >= takeProfit) {
      // 始値がTP以上: 始値で決済（ギャップアップ）
      const price = bar.open >= takeProfit ? bar.open : takeProfit;
      return {
        hit: true,
        price,
        reason: `Long TP到達: 高値(${bar.high.toFixed(4)}) >= TP(${takeProfit.toFixed(4)})`,
      };
    }
  } else {
    // Short: 安値がTP以下で利確
    if (bar.low <= takeProfit) {
      const price = bar.open <= takeProfit ? bar.open : takeProfit;
      return {
        hit: true,
        price,
        reason: `Short TP到達: 安値(${bar.low.toFixed(4)}) <= TP(${takeProfit.toFixed(4)})`,
      };
    }
  }

  return { hit: false, price: 0, reason: '' };
}

// ===========================================
// 包括的な検証
// ===========================================

/**
 * トレードの状態を包括的に検証
 * 
 * - pending状態: エントリー条件をチェック
 * - open状態: 決済条件をチェック
 * 
 * @param ohlcvData 1分足OHLCVデータ（時系列順）
 * @param status 現在のトレード状態
 * @param direction トレード方向
 * @param plannedEntry 予定エントリー価格（pending時のみ使用）
 * @param stopLoss ストップロス価格
 * @param takeProfit テイクプロフィット価格
 * @returns 包括的な検証結果
 */
export function verifyTradeState(
  ohlcvData: MinuteOHLCV[],
  status: 'pending' | 'open',
  direction: TradeDirection,
  plannedEntry: number,
  stopLoss: number,
  takeProfit: number,
): TradeVerificationResult {
  const result: TradeVerificationResult = {
    stateChanged: false,
    processedBars: ohlcvData.length,
    lastProcessedTime: ohlcvData.length > 0 
      ? ohlcvData[ohlcvData.length - 1].timestamp 
      : undefined,
  };

  if (status === 'pending') {
    // pending状態: エントリー条件をチェック
    const entryResult = verifyEntryCondition(ohlcvData, direction, plannedEntry);
    result.entry = entryResult;
    
    if (entryResult.triggered) {
      result.stateChanged = true;
      
      // エントリー後のバーで即座にSL/TPチェック
      // エントリーバー以降のデータを使用
      if (entryResult.entryTime) {
        const postEntryBars = ohlcvData.filter(
          bar => bar.timestamp >= entryResult.entryTime!
        );
        
        if (postEntryBars.length > 0) {
          const exitResult = verifyExitCondition(
            postEntryBars,
            direction,
            stopLoss,
            takeProfit,
          );
          
          if (exitResult.triggered) {
            result.exit = exitResult;
          }
        }
      }
    }
  } else {
    // open状態: 決済条件をチェック
    const exitResult = verifyExitCondition(
      ohlcvData,
      direction,
      stopLoss,
      takeProfit,
    );
    result.exit = exitResult;
    
    if (exitResult.triggered) {
      result.stateChanged = true;
    }
  }

  return result;
}

// ===========================================
// ユーティリティ
// ===========================================

/**
 * OHLCVデータを時系列順（古い順）にソート
 */
export function sortOHLCVChronological(data: MinuteOHLCV[]): MinuteOHLCV[] {
  return [...data].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

/**
 * 検証結果のサマリーを生成（ログ用）
 */
export function summarizeVerificationResult(result: TradeVerificationResult): string {
  const lines: string[] = [];
  
  lines.push(`処理バー数: ${result.processedBars}`);
  
  if (result.lastProcessedTime) {
    lines.push(`最終バー: ${result.lastProcessedTime.toISOString()}`);
  }
  
  if (result.entry) {
    if (result.entry.triggered) {
      lines.push(`エントリー: ✅ ${result.entry.entryPrice?.toFixed(4)} @ ${result.entry.entryTime?.toISOString()}`);
    } else {
      lines.push(`エントリー: ❌ ${result.entry.reason}`);
    }
  }
  
  if (result.exit) {
    if (result.exit.triggered) {
      const emoji = result.exit.exitReason === 'take_profit' ? '🎯' : '🛑';
      lines.push(`決済: ${emoji} ${result.exit.exitReason} @ ${result.exit.exitPrice?.toFixed(4)}`);
    } else {
      lines.push(`決済: ❌ ${result.exit.reason}`);
    }
  }
  
  return lines.join(' | ');
}
