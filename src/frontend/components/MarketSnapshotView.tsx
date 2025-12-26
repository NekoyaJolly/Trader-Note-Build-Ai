/**
 * MarketSnapshot 表示コンポーネント
 * 市場スナップショットの数値データを表形式で表示
 */

import type { MarketSnapshot } from "@/types/notification";

interface MarketSnapshotViewProps {
  /**
   * 市場スナップショットデータ
   */
  snapshot: MarketSnapshot;
}

/**
 * MarketSnapshot を表形式で表示するコンポーネント
 */
export default function MarketSnapshotView({
  snapshot,
}: MarketSnapshotViewProps) {
  /**
   * 数値をフォーマット（null の場合は "N/A"）
   */
  const formatValue = (value: number | null, decimals: number = 4): string => {
    if (value === null) return "N/A";
    return value.toFixed(decimals);
  };

  return (
    <div className="bg-gray-50 p-4 rounded-lg">
      {/* ヘッダー情報 */}
      <div className="mb-4 pb-3 border-b border-gray-300">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-800">
            {snapshot.timeframe} 市場スナップショット
          </h3>
          <span className="text-sm text-gray-600">
            {new Date(snapshot.timestamp).toLocaleString("ja-JP")}
          </span>
        </div>
      </div>

      {/* 価格情報 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div>
          <div className="text-xs text-gray-500 mb-1">始値</div>
          <div className="text-sm font-mono font-semibold text-gray-800">
            {formatValue(snapshot.open, 5)}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">高値</div>
          <div className="text-sm font-mono font-semibold text-green-600">
            {formatValue(snapshot.high, 5)}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">安値</div>
          <div className="text-sm font-mono font-semibold text-red-600">
            {formatValue(snapshot.low, 5)}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">終値</div>
          <div className="text-sm font-mono font-semibold text-gray-800">
            {formatValue(snapshot.close, 5)}
          </div>
        </div>
      </div>

      {/* 出来高 */}
      <div className="mb-4">
        <div className="text-xs text-gray-500 mb-1">出来高</div>
        <div className="text-sm font-mono font-semibold text-gray-800">
          {formatValue(snapshot.volume, 2)}
        </div>
      </div>

      {/* テクニカル指標 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {/* RSI */}
        <div>
          <div className="text-xs text-gray-500 mb-1">RSI</div>
          <div className="text-sm font-mono text-gray-700">
            {formatValue(snapshot.rsi, 2)}
          </div>
        </div>

        {/* MACD */}
        <div>
          <div className="text-xs text-gray-500 mb-1">MACD</div>
          <div className="text-sm font-mono text-gray-700">
            {formatValue(snapshot.macd, 4)}
          </div>
        </div>

        {/* MACD Signal */}
        <div>
          <div className="text-xs text-gray-500 mb-1">MACD Signal</div>
          <div className="text-sm font-mono text-gray-700">
            {formatValue(snapshot.macdSignal, 4)}
          </div>
        </div>

        {/* MACD Histogram */}
        <div>
          <div className="text-xs text-gray-500 mb-1">MACD Histogram</div>
          <div className="text-sm font-mono text-gray-700">
            {formatValue(snapshot.macdHistogram, 4)}
          </div>
        </div>

        {/* ATR */}
        <div>
          <div className="text-xs text-gray-500 mb-1">ATR</div>
          <div className="text-sm font-mono text-gray-700">
            {formatValue(snapshot.atr, 5)}
          </div>
        </div>

        {/* EMA 20 */}
        <div>
          <div className="text-xs text-gray-500 mb-1">EMA 20</div>
          <div className="text-sm font-mono text-gray-700">
            {formatValue(snapshot.ema20, 5)}
          </div>
        </div>

        {/* EMA 50 */}
        <div>
          <div className="text-xs text-gray-500 mb-1">EMA 50</div>
          <div className="text-sm font-mono text-gray-700">
            {formatValue(snapshot.ema50, 5)}
          </div>
        </div>

        {/* Bollinger Upper */}
        <div>
          <div className="text-xs text-gray-500 mb-1">BB Upper</div>
          <div className="text-sm font-mono text-gray-700">
            {formatValue(snapshot.bollingerUpper, 5)}
          </div>
        </div>

        {/* Bollinger Middle */}
        <div>
          <div className="text-xs text-gray-500 mb-1">BB Middle</div>
          <div className="text-sm font-mono text-gray-700">
            {formatValue(snapshot.bollingerMiddle, 5)}
          </div>
        </div>

        {/* Bollinger Lower */}
        <div>
          <div className="text-xs text-gray-500 mb-1">BB Lower</div>
          <div className="text-sm font-mono text-gray-700">
            {formatValue(snapshot.bollingerLower, 5)}
          </div>
        </div>
      </div>
    </div>
  );
}
