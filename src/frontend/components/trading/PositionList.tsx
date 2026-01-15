/**
 * ポジション一覧表示コンポーネント
 * 
 * 目的: 保有ポジションを一覧表示（リアルタイム更新対応）
 * 
 * 表示項目:
 * - シンボル（通貨ペア）
 * - 売買方向（BUY/SELL）
 * - ロット数
 * - エントリー価格
 * - 現在価格
 * - 損益（P&L）
 * - TP/SL
 */

'use client';

import React from 'react';

interface Position {
  positionId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  entryPrice: number;
  currentPrice: number;
  profitLoss: number;
  profitLossPips: number;
  swap: number;
  commission: number;
  takeProfit?: number;
  stopLoss?: number;
  openTime: string;
  comment?: string;
}

interface PositionListProps {
  positions: Position[];
}

export function PositionList({ positions }: PositionListProps) {
  if (positions.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-8 border border-gray-700 text-center">
        <div className="text-gray-400 text-lg">保有ポジションはありません</div>
      </div>
    );
  }

  /**
   * 開設時刻をフォーマット
   */
  const formatOpenTime = (timeStr: string) => {
    const date = new Date(timeStr);
    return new Intl.DateTimeFormat('ja-JP', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <div className="px-4 py-3 bg-gray-900 border-b border-gray-700">
        <h3 className="text-xl font-semibold text-white">
          保有ポジション ({positions.length}件)
        </h3>
      </div>

      <div className="divide-y divide-gray-700">
        {positions.map((position) => (
          <div 
            key={position.positionId} 
            className="p-4 hover:bg-gray-700/50 transition"
          >
            {/* ヘッダー行: シンボル・方向・損益 */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="text-white font-semibold text-lg">{position.symbol}</span>
                <span
                  className={`px-2 py-1 rounded text-xs font-semibold ${
                    position.side === 'BUY'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {position.side}
                </span>
                <span className="text-gray-400 text-sm">{position.volume} Lot</span>
              </div>

              <div className="text-right">
                <div
                  className={`text-xl font-mono font-bold ${
                    position.profitLoss >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {position.profitLoss >= 0 ? '+' : ''}
                  {position.profitLoss.toFixed(2)}
                </div>
                <div className="text-gray-400 text-xs">
                  {position.profitLossPips >= 0 ? '+' : ''}
                  {position.profitLossPips.toFixed(1)} pips
                </div>
              </div>
            </div>

            {/* 詳細情報グリッド */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-gray-400">エントリー</div>
                <div className="text-white font-mono">{position.entryPrice.toFixed(5)}</div>
              </div>

              <div>
                <div className="text-gray-400">現在価格</div>
                <div className="text-white font-mono">{position.currentPrice.toFixed(5)}</div>
              </div>

              {position.takeProfit && (
                <div>
                  <div className="text-gray-400">TP</div>
                  <div className="text-green-400 font-mono">{position.takeProfit.toFixed(5)}</div>
                </div>
              )}

              {position.stopLoss && (
                <div>
                  <div className="text-gray-400">SL</div>
                  <div className="text-red-400 font-mono">{position.stopLoss.toFixed(5)}</div>
                </div>
              )}

              <div>
                <div className="text-gray-400">開設時刻</div>
                <div className="text-white text-xs">{formatOpenTime(position.openTime)}</div>
              </div>

              <div>
                <div className="text-gray-400">スワップ</div>
                <div className="text-white">{position.swap.toFixed(2)}</div>
              </div>

              <div>
                <div className="text-gray-400">手数料</div>
                <div className="text-white">{position.commission.toFixed(2)}</div>
              </div>
            </div>

            {/* コメント */}
            {position.comment && (
              <div className="mt-3 text-gray-400 text-sm italic">
                {position.comment}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
