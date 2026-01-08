'use client';

/**
 * リアルタイムチャートコンポーネント
 * 
 * 目的: cTrader WebSocket から受信したリアルタイム Tick/OHLCV データを
 *       ローソク足チャートで表示
 * 
 * 機能:
 * - リアルタイム更新（10秒足）
 * - 進行中バーの表示
 * - 最新価格・Tick 情報表示
 * - 接続状態インジケーター
 */

import React, { useMemo } from 'react';
import { useRealtimeChart, OHLCVBar, PendingBar, ConnectionStatus } from '@/hooks/useRealtimeChart';
import { CandlestickChart, OHLCVDataPoint } from './CandlestickChart';

// ========================================
// 型定義
// ========================================

interface RealtimeChartProps {
  /** シンボル（例: XAUUSD） */
  symbol: string;
  /** チャートの高さ */
  height?: number;
  /** 自動接続するか */
  autoConnect?: boolean;
}

// ========================================
// サブコンポーネント
// ========================================

/**
 * 接続状態バッジ
 */
function StatusBadge({ status }: { status: ConnectionStatus }) {
  const config: Record<ConnectionStatus, { color: string; label: string; icon: string }> = {
    disconnected: { color: 'bg-gray-500', label: '未接続', icon: '⚫' },
    connecting: { color: 'bg-yellow-500', label: '接続中...', icon: '🔄' },
    authenticating: { color: 'bg-blue-500', label: '認証中...', icon: '🔐' },
    connected: { color: 'bg-green-500', label: '接続済み', icon: '🟢' },
    error: { color: 'bg-red-500', label: 'エラー', icon: '🔴' },
  };

  const { color, label, icon } = config[status];

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${color} text-white`}>
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  );
}

/**
 * 価格表示パネル
 */
function PricePanel({ 
  bar, 
  isPending 
}: { 
  bar: OHLCVBar | PendingBar | null; 
  isPending?: boolean;
}) {
  if (!bar) return null;

  const priceChange = bar.close - bar.open;
  const priceChangePercent = bar.open > 0 ? (priceChange / bar.open) * 100 : 0;
  const isPositive = priceChange >= 0;

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-400 text-sm">
          {isPending ? '進行中バー' : '最新確定バー'}
        </span>
        {isPending && (
          <span className="text-xs text-yellow-400 animate-pulse">● LIVE</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-gray-400 text-xs">現在価格</div>
          <div className={`text-2xl font-mono font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
            {bar.close.toFixed(2)}
          </div>
          <div className={`text-sm ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
            {isPositive ? '+' : ''}{priceChange.toFixed(2)} ({isPositive ? '+' : ''}{priceChangePercent.toFixed(2)}%)
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <div className="text-gray-400 text-xs">始値</div>
            <div className="font-mono">{bar.open.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-gray-400 text-xs">高値</div>
            <div className="font-mono text-green-400">{bar.high.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-gray-400 text-xs">安値</div>
            <div className="font-mono text-red-400">{bar.low.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-gray-400 text-xs">Tick数</div>
            <div className="font-mono">{bar.tickCount}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ========================================
// メインコンポーネント
// ========================================

export function RealtimeChart({ 
  symbol, 
  height = 400,
}: RealtimeChartProps) {
  const {
    bars,
    pendingBar,
    latestTick,
    status,
    error,
    isConnected,
    isLoading,
    connect,
    disconnect,
  } = useRealtimeChart(symbol);

  // チャートデータを変換（確定バー + 進行中バー）
  const chartData: OHLCVDataPoint[] = useMemo(() => {
    const data: OHLCVDataPoint[] = bars.map(bar => ({
      timestamp: new Date(bar.timestamp).getTime(),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }));

    // 進行中バーを追加（点滅効果用にフラグを追加）
    if (pendingBar) {
      data.push({
        timestamp: new Date(pendingBar.startTime).getTime(),
        open: pendingBar.open,
        high: pendingBar.high,
        low: pendingBar.low,
        close: pendingBar.close,
        volume: pendingBar.volume,
        // isPending: true // CandlestickChart が対応していれば
      });
    }

    return data;
  }, [bars, pendingBar]);

  // 最新の確定バーを取得
  const latestBar = bars.length > 0 ? bars[bars.length - 1] : null;

  return (
    <div className="bg-gray-900 rounded-lg overflow-hidden">
      {/* ヘッダー */}
      <div className="bg-gray-800 px-4 py-3 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-white">{symbol}</h3>
          <span className="text-gray-400 text-sm">10秒足 リアルタイム</span>
          <StatusBadge status={status} />
        </div>

        <div className="flex items-center gap-2">
          {isConnected ? (
            <button
              onClick={disconnect}
              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition"
            >
              切断
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={isLoading}
              className={`px-3 py-1 text-white text-sm rounded transition ${
                isLoading
                  ? 'bg-gray-600 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {isLoading ? '接続中...' : '接続'}
            </button>
          )}
        </div>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="bg-red-900/50 border-b border-red-500 px-4 py-2">
          <p className="text-red-300 text-sm">⚠️ {error}</p>
        </div>
      )}

      {/* メインコンテンツ */}
      <div className="p-4">
        {isConnected || bars.length > 0 ? (
          <div className="space-y-4">
            {/* チャート */}
            <div style={{ height }}>
              <CandlestickChart
                ohlcvData={chartData}
                height={height - 20}
              />
            </div>

            {/* 価格パネル */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <PricePanel bar={pendingBar} isPending />
              <PricePanel bar={latestBar} />
            </div>

            {/* Tick 情報 */}
            {latestTick && (
              <div className="bg-gray-800 rounded-lg p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">最新 Tick</span>
                  <span className="text-gray-400 text-xs">
                    {new Date(latestTick.timestamp).toLocaleTimeString('ja-JP')}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-4 mt-2">
                  <div>
                    <span className="text-gray-400 text-xs">Bid</span>
                    <div className="font-mono text-red-400">{latestTick.bid.toFixed(5)}</div>
                  </div>
                  <div>
                    <span className="text-gray-400 text-xs">Ask</span>
                    <div className="font-mono text-green-400">{latestTick.ask.toFixed(5)}</div>
                  </div>
                  <div>
                    <span className="text-gray-400 text-xs">Mid</span>
                    <div className="font-mono">{latestTick.mid.toFixed(5)}</div>
                  </div>
                  <div>
                    <span className="text-gray-400 text-xs">Spread</span>
                    <div className="font-mono text-yellow-400">{(latestTick.spread * 10000).toFixed(1)} pips</div>
                  </div>
                </div>
              </div>
            )}

            {/* 統計情報 */}
            <div className="text-xs text-gray-500 flex justify-between">
              <span>確定バー: {bars.length}本</span>
              <span>データソース: cTrader WebSocket</span>
            </div>
          </div>
        ) : (
          // 未接続時の表示
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <div className="text-6xl mb-4">📡</div>
            <p className="text-lg mb-2">リアルタイムデータ未接続</p>
            <p className="text-sm mb-4">
              「接続」ボタンをクリックして cTrader WebSocket に接続してください
            </p>
            <button
              onClick={connect}
              disabled={isLoading}
              className={`px-6 py-2 rounded-lg font-semibold transition ${
                isLoading
                  ? 'bg-gray-600 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {isLoading ? '接続中...' : '🔌 接続開始'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default RealtimeChart;

