"use client";

/**
 * リアルタイムチャートコンポーネント
 *
 * 目的: cTrader WebSocket から受信したリアルタイム Tick/OHLCV データをローソク足チャートで表示
 *
 * 機能:
 * - リアルタイム更新（10秒足）
 * - 進行中バーの表示
 * - 最新価格・Tick 情報表示
 * - 接続状態インジケーター
 */

import React, { ReactNode, useEffect, useMemo, useState } from "react";
import { useRealtimeChart, OHLCVBar, PendingBar, ConnectionStatus } from "@/hooks/useRealtimeChart";
import { CandlestickChart, DrawnLine, OHLCVDataPoint } from "./CandlestickChart";

interface RealtimeChartProps {
	symbol: string;
	height?: number;
	autoConnect?: boolean;
	initialTimeframe?: number;
	onTimeframeChange?: (timeframe: number) => void;
	onSymbolChange?: (symbol: string) => void;
	onLinesChange?: (lines: DrawnLine[]) => void;
	rightAction?: ReactNode;
}

const SYMBOL_OPTIONS = [
	{ value: "XAUUSD", label: "XAU/USD" },
	{ value: "EURUSD", label: "EUR/USD" },
	{ value: "USDJPY", label: "USD/JPY" },
	{ value: "GBPUSD", label: "GBP/USD" },
];

const TIMEFRAME_OPTIONS = [
	{ value: 60, label: "1分" },
	{ value: 300, label: "5分" },
	{ value: 900, label: "15分" },
	{ value: 1800, label: "30分" },
	{ value: 3600, label: "1時間" },
	{ value: 14400, label: "4時間" },
];

const DEFAULT_LINE_COLOR = "#fbbf24";
const DEFAULT_LINE_WIDTH = 2;
const LINE_WIDTH_OPTIONS = [1, 2, 3, 4];

interface PricePanelProps {
	bar: PendingBar | OHLCVBar | null;
	dailyHigh: number | null;
	dailyLow: number | null;
	previousClose: number | null;
}

const StatusBadge = ({ status }: { status: ConnectionStatus }) => {
	const colorClass = {
		disconnected: "bg-gray-700 text-gray-200",
		connecting: "bg-blue-700 text-white",
		authenticating: "bg-blue-700 text-white",
		connected: "bg-green-700 text-white",
		error: "bg-red-700 text-white",
	}[status];

	const label = {
		disconnected: "未接続",
		connecting: "接続中",
		authenticating: "認証中",
		connected: "接続済",
		error: "エラー",
	}[status];

	return <span className={`text-xs px-2 py-1 rounded ${colorClass}`}>{label}</span>;
};

const PricePanel = ({ bar, dailyHigh, dailyLow, previousClose }: PricePanelProps) => {
	if (!bar) {
		return <div className="bg-gray-800 rounded-lg p-3 text-sm text-gray-500 border border-gray-700">データ未取得</div>;
	}

	const timestamp = "startTime" in bar ? bar.startTime : bar.timestamp;
	const timeLabel = new Date(timestamp).toLocaleTimeString("ja-JP", { hour12: false });
	const dayChange = previousClose != null ? bar.close - previousClose : null;
	const dayChangePercent = previousClose != null && previousClose !== 0 && dayChange != null ? (dayChange / previousClose) * 100 : null;
	const changeColor = dayChange != null ? (dayChange >= 0 ? "text-green-400" : "text-red-400") : "text-gray-400";
	const formatNullable = (val: number | null) => (val == null ? "-" : val.toFixed(2));
	const dayChangePercentLabel = dayChangePercent == null ? "--%" : `${dayChangePercent >= 0 ? "+" : ""}${dayChangePercent.toFixed(2)}%`;

	return (
		<div className="bg-gray-800 rounded-lg p-2">
			<div className="flex flex-nowrap items-center gap-1.5 text-sm overflow-x-auto">
				<div className="flex-none w-[90px] bg-gray-900/60 rounded px-2 py-1">
					<div className="text-[10px] text-gray-400 whitespace-nowrap">現在価格</div>
					<div className="text-base font-mono font-bold text-green-400 leading-tight whitespace-nowrap">{bar.close.toFixed(2)}</div>
				</div>

				<div className="flex-none w-[90px] bg-gray-900/60 rounded px-2 py-1">
					<div className="text-[10px] text-gray-400 whitespace-nowrap">時刻</div>
					<div className="font-mono text-xs text-gray-200 leading-tight whitespace-nowrap">{timeLabel}</div>
				</div>

				<div className="flex-none w-[90px] bg-gray-900/60 rounded px-2 py-1">
					<div className="text-[10px] text-gray-400 whitespace-nowrap">前日比（{dayChangePercentLabel}）</div>
					<div className={`font-mono text-xs ${changeColor} leading-tight whitespace-nowrap`}>
						{dayChange == null ? "-" : `${dayChange >= 0 ? "+" : ""}${dayChange.toFixed(2)}`}
					</div>
				</div>

				<div className="flex-none w-[90px] bg-gray-900/60 rounded px-2 py-1">
					<div className="text-[10px] text-gray-400 whitespace-nowrap">高値</div>
					<div className="font-mono text-xs text-green-400 leading-tight whitespace-nowrap">{bar.high.toFixed(2)}</div>
				</div>

				<div className="flex-none w-[90px] bg-gray-900/60 rounded px-2 py-1">
					<div className="text-[10px] text-gray-400 whitespace-nowrap">安値</div>
					<div className="font-mono text-xs text-red-400 leading-tight whitespace-nowrap">{bar.low.toFixed(2)}</div>
				</div>

				<div className="flex-none w-[90px] bg-gray-900/60 rounded px-2 py-1">
					<div className="text-[10px] text-gray-400 whitespace-nowrap">当日高値</div>
					<div className="font-mono text-xs text-green-300 leading-tight whitespace-nowrap">{formatNullable(dailyHigh)}</div>
				</div>

				<div className="flex-none w-[90px] bg-gray-900/60 rounded px-2 py-1">
					<div className="text-[10px] text-gray-400 whitespace-nowrap">当日安値</div>
					<div className="font-mono text-xs text-red-300 leading-tight whitespace-nowrap">{formatNullable(dailyLow)}</div>
				</div>
			</div>
		</div>
	);
};

export function RealtimeChart({
	symbol,
	height = 400,
	initialTimeframe = 60,
	onTimeframeChange,
	onSymbolChange,
	onLinesChange,
	rightAction,
}: RealtimeChartProps) {
	const [timeframe, setTimeframe] = useState(initialTimeframe);
	const [drawingMode, setDrawingMode] = useState<"none" | "horizontal" | "trend">("none");
	const [drawnLines, setDrawnLines] = useState<DrawnLine[]>([]);
	const [hasEverConnected, setHasEverConnected] = useState(false);

	const storageKey = useMemo(() => `chart-lines-${symbol}-${timeframe}`, [symbol, timeframe]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const raw = window.localStorage.getItem(storageKey);
		if (!raw) {
			setDrawnLines([]);
			onLinesChange?.([]);
			return;
		}
		try {
			const parsed = JSON.parse(raw) as DrawnLine[];
			setDrawnLines(parsed);
			onLinesChange?.(parsed);
		} catch (e) {
			console.error("手動ラインの読み込みに失敗しました", e);
			setDrawnLines([]);
			onLinesChange?.([]);
		}
	}, [onLinesChange, storageKey]);

	const { bars, pendingBar, latestTick, status, error, isConnected, isLoading, isMarketClosed, connect, disconnect } = useRealtimeChart(symbol, { timeframe, persistConnection: true });

	useEffect(() => {
		if (isConnected) {
			setHasEverConnected(true);
		}
	}, [isConnected]);

	const handleTimeframeChange = (newTimeframe: number) => {
		if (isConnected) {
			disconnect();
		}
		setTimeframe(newTimeframe);
		setDrawingMode("none");
		onTimeframeChange?.(newTimeframe);
	};

	const handleSymbolChange = (newSymbol: string) => {
		if (isConnected) {
			disconnect();
		}
		setDrawingMode("none");
		onSymbolChange?.(newSymbol);
	};

	const persistLines = (lines: DrawnLine[]) => {
		setDrawnLines(lines);
		onLinesChange?.(lines);
		if (typeof window === "undefined") return;
		if (lines.length === 0) {
			window.localStorage.removeItem(storageKey);
			return;
		}
		window.localStorage.setItem(storageKey, JSON.stringify(lines));
	};

	const handleCompleteLine = (line: DrawnLine) => {
		const updated = [...drawnLines, line];
		persistLines(updated);
	};

	const handleUpdateLine = (id: string, payload: Partial<DrawnLine>) => {
		const updated = drawnLines.map((line) => {
			if (line.id !== id) return line;
			const baseUpdate = {
				color: payload.color ?? line.color ?? DEFAULT_LINE_COLOR,
				lineWidth: payload.lineWidth ?? line.lineWidth ?? DEFAULT_LINE_WIDTH,
			};
			if (line.type === "horizontal" && "price" in payload) {
				return { ...line, ...payload, ...baseUpdate } as typeof line;
			}
			if (line.type === "trend" && ("startPrice" in payload || "endPrice" in payload)) {
				return { ...line, ...payload, ...baseUpdate } as typeof line;
			}
			return { ...line, ...baseUpdate };
		});
		persistLines(updated as DrawnLine[]);
	};

	const handleDeleteLine = (id: string) => {
		const updated = drawnLines.filter((line) => line.id !== id);
		persistLines(updated);
	};

	const handleClearLines = () => {
		persistLines([]);
		setDrawingMode("none");
	};

	const handleExitDrawing = () => {
		setDrawingMode("none");
	};

	const chartData: OHLCVDataPoint[] = useMemo(() => {
		const dataMap = new Map<number, OHLCVDataPoint>();

		for (const bar of bars) {
			const timestamp = new Date(bar.timestamp).getTime();
			dataMap.set(timestamp, { timestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume });
		}

		if (pendingBar) {
			const timestamp = new Date(pendingBar.startTime).getTime();
			dataMap.set(timestamp, { timestamp, open: pendingBar.open, high: pendingBar.high, low: pendingBar.low, close: pendingBar.close, volume: pendingBar.volume });
		}

		return Array.from(dataMap.values()).sort((a, b) => a.timestamp - b.timestamp);
	}, [bars, pendingBar]);

	const latestBar = bars.length > 0 ? bars[bars.length - 1] : null;

	const { dailyHigh, dailyLow, previousClose } = useMemo(() => {
		if (!latestBar) return { dailyHigh: null, dailyLow: null, previousClose: null };
		const latestTs = new Date(latestBar.timestamp);
		const dayStart = new Date(latestTs);
		dayStart.setHours(0, 0, 0, 0);

		const sameDayBars = bars.filter((barItem) => {
			const ts = new Date(barItem.timestamp);
			return ts >= dayStart && ts <= latestTs && ts.getFullYear() === latestTs.getFullYear() && ts.getMonth() === latestTs.getMonth() && ts.getDate() === latestTs.getDate();
		});

		const dailyHighVal = sameDayBars.length > 0 ? Math.max(...sameDayBars.map((b) => b.high)) : null;
		const dailyLowVal = sameDayBars.length > 0 ? Math.min(...sameDayBars.map((b) => b.low)) : null;

		const previousDayBars = bars.filter((barItem) => {
			const ts = new Date(barItem.timestamp);
			return ts < dayStart;
		});
		const previousCloseVal = previousDayBars.length > 0 ? previousDayBars[previousDayBars.length - 1].close : null;

		return { dailyHigh: dailyHighVal, dailyLow: dailyLowVal, previousClose: previousCloseVal };
	}, [bars, latestBar]);

	const drawingLabel = drawingMode === "horizontal" ? "水平線" : drawingMode === "trend" ? "トレンドライン" : "オフ";

	return (
		<div className="bg-gray-900 rounded-lg overflow-hidden">
			<div className="bg-gray-800 px-3 py-2 hidden md:flex items-center gap-3 border-b border-gray-700">
				<select value={symbol} onChange={(e) => handleSymbolChange(e.target.value)} disabled={isConnected} className={`bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 font-semibold ${isConnected ? "opacity-50 cursor-not-allowed" : "hover:border-gray-500"}`}>
					{SYMBOL_OPTIONS.map((opt) => (
						<option key={opt.value} value={opt.value}>
							{opt.label}
						</option>
					))}
				</select>

				<select value={timeframe} onChange={(e) => handleTimeframeChange(parseInt(e.target.value, 10))} disabled={isConnected} className={`bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 ${isConnected ? "opacity-50 cursor-not-allowed" : "hover:border-gray-500"}`}>
					{TIMEFRAME_OPTIONS.map((opt) => (
						<option key={opt.value} value={opt.value}>
							{opt.label}
						</option>
					))}
				</select>

				<button onClick={() => setDrawingMode(drawingMode === "horizontal" ? "none" : "horizontal")} className={`p-1.5 text-xs rounded transition ${drawingMode === "horizontal" ? "bg-yellow-600 text-black" : "bg-gray-700 text-gray-200 hover:bg-gray-600"}`} title="水平線">
					↔︎
				</button>

				<button onClick={() => setDrawingMode(drawingMode === "trend" ? "none" : "trend")} className={`p-1.5 text-xs rounded transition ${drawingMode === "trend" ? "bg-yellow-600 text-black" : "bg-gray-700 text-gray-200 hover:bg-gray-600"}`} title="トレンドライン">
					↗︎
				</button>

				<button onClick={handleClearLines} className="px-2 py-1 text-xs rounded bg-gray-700 text-gray-200 hover:bg-gray-600">
					クリア
				</button>

				<div className="flex-1" />

				<div className="flex items-center gap-2">
					<StatusBadge status={status} />

					{isConnected ? (
						<button
							onClick={() => {
								setHasEverConnected(false);
								disconnect();
							}}
							className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition"
						>
							切断
						</button>
					) : (
						<button onClick={connect} disabled={isLoading} className={`px-3 py-1 text-white text-xs rounded transition ${isLoading ? "bg-gray-600 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"}`}>
							{isLoading ? "接続中..." : "接続"}
						</button>
					)}

					{rightAction && <div className="ml-1">{rightAction}</div>}
				</div>
			</div>

			{error && (
				<div className="bg-red-900/50 border-b border-red-500 px-4 py-2">
					<p className="text-red-300 text-sm">⚠️ {error}</p>
				</div>
			)}

			{isConnected && isMarketClosed && (
				<div className="bg-yellow-900/50 border-b border-yellow-500 px-4 py-2">
					<p className="text-yellow-300 text-sm">ℹ️ 市場が閉まっている可能性があります（5分以上新しいデータが受信されていません）</p>
				</div>
			)}

			<div className="p-0.5 space-y-2">
				{hasEverConnected || isConnected || bars.length > 0 ? (
					<div className="space-y-2">
						<div className="px-2">
							<PricePanel bar={latestBar} dailyHigh={dailyHigh} dailyLow={dailyLow} previousClose={previousClose} />
						</div>

						<div className="relative">
							<CandlestickChart
								ohlcvData={chartData}
								height={height}
								drawingMode={drawingMode}
								drawnLines={drawnLines}
								onCompleteLine={handleCompleteLine}
								onExitDrawing={handleExitDrawing}
							/>
						</div>

						<div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-2">
							{drawnLines.length === 0 ? (
								<p className="text-xs text-gray-500 text-center">描画ライン無し</p>
							) : (
								<div className="space-y-1.5">
									{drawnLines.map((line, idx) => (
										<div key={line.id} className="flex items-center gap-2 text-xs text-gray-100 bg-gray-900/60 rounded px-2 py-1 border border-gray-700/60">
											<span className="px-1.5 py-0.5 rounded bg-gray-700 text-gray-200">{line.type === "horizontal" ? "水平" : "トレンド"} {idx + 1}</span>
											<input type="color" value={line.color ?? DEFAULT_LINE_COLOR} onChange={(e) => handleUpdateLine(line.id, { color: e.target.value })} className="w-7 h-7 rounded border border-gray-600 bg-gray-900 cursor-pointer" title="色" />
											<input
												type="range"
												min={Math.min(...LINE_WIDTH_OPTIONS)}
												max={Math.max(...LINE_WIDTH_OPTIONS)}
												step={1}
												value={line.lineWidth ?? DEFAULT_LINE_WIDTH}
												onChange={(e) => handleUpdateLine(line.id, { lineWidth: Number(e.target.value) })}
												className="accent-yellow-400 w-16"
												title="太さ"
											/>
											<span className="text-gray-400 text-xs">{line.lineWidth ?? DEFAULT_LINE_WIDTH}px</span>
											<button onClick={() => handleDeleteLine(line.id)} className="ml-auto px-1.5 py-0.5 text-xs rounded bg-red-700 text-white hover:bg-red-800">
												削除
											</button>
										</div>
									))}
								</div>
							)}
						</div>

						{latestTick && (
							<div className="bg-gray-800/50 rounded-lg p-2 text-xs border border-gray-700/50">
								<div className="flex items-center justify-between mb-1">
									<span className="text-gray-400">最新Tick</span>
									<span className="text-gray-500 text-xs">{new Date(latestTick.timestamp).toLocaleTimeString("ja-JP")}</span>
								</div>
								<div className="grid grid-cols-4 gap-2">
									<div>
										<span className="text-gray-500 text-xs">Bid</span>
										<div className="font-mono text-red-400 text-xs">{latestTick.bid.toFixed(5)}</div>
									</div>
									<div>
										<span className="text-gray-500 text-xs">Ask</span>
										<div className="font-mono text-green-400 text-xs">{latestTick.ask.toFixed(5)}</div>
									</div>
									<div>
										<span className="text-gray-500 text-xs">Mid</span>
										<div className="font-mono text-xs">{latestTick.mid.toFixed(5)}</div>
									</div>
									<div>
										<span className="text-gray-500 text-xs">Spread</span>
										<div className="font-mono text-yellow-400 text-xs">{(latestTick.spread * 10000).toFixed(1)}p</div>
									</div>
								</div>
							</div>
						)}
					</div>
				) : (
					<div className="flex flex-col items-center justify-center py-16 text-gray-400">
						<div className="text-5xl mb-3">📡</div>
						<p className="text-sm mb-3">未接続</p>
						<button onClick={connect} disabled={isLoading} className={`px-4 py-1.5 rounded-lg text-sm transition ${isLoading ? "bg-gray-600 cursor-not-allowed" : "bg-green-600 hover:bg-green-700 text-white"}`}>
							{isLoading ? "接続中..." : "接続開始"}
						</button>
					</div>
				)}
			</div>

			<div className="md:hidden sticky bottom-0 z-20 bg-gray-900 border-t border-gray-800 px-3 py-2 space-y-2">
				<div className="flex items-center gap-2">
					<select value={symbol} onChange={(e) => handleSymbolChange(e.target.value)} disabled={isConnected} className={`bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700 flex-1 min-w-0 ${isConnected ? "opacity-50 cursor-not-allowed" : "hover:border-gray-600"}`}>
						{SYMBOL_OPTIONS.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>

					<select value={timeframe} onChange={(e) => handleTimeframeChange(parseInt(e.target.value, 10))} disabled={isConnected} className={`bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700 w-24 ${isConnected ? "opacity-50 cursor-not-allowed" : "hover:border-gray-600"}`}>
						{TIMEFRAME_OPTIONS.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>

					{isConnected ? (
						<button
							onClick={() => {
								setHasEverConnected(false);
								disconnect();
							}}
							className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition"
						>
							切断
						</button>
					) : (
						<button onClick={connect} disabled={isLoading} className={`px-3 py-1 text-white text-xs rounded transition ${isLoading ? "bg-gray-600 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"}`}>
							{isLoading ? "接続中" : "接続"}
						</button>
					)}
				</div>

				<div className="flex items-center justify-between text-[11px] text-gray-300">
					<div className="flex items-center gap-2">
						<StatusBadge status={status} />
						<span className="text-gray-400">描画: {drawingLabel}</span>
					</div>
					<div className="flex items-center gap-1">
						<button onClick={() => setDrawingMode(drawingMode === "horizontal" ? "none" : "horizontal")} className={`px-2 py-1 rounded text-[11px] ${drawingMode === "horizontal" ? "bg-yellow-600 text-black" : "bg-gray-800 text-gray-200"}`}>
							水平
						</button>
						<button onClick={() => setDrawingMode(drawingMode === "trend" ? "none" : "trend")} className={`px-2 py-1 rounded text-[11px] ${drawingMode === "trend" ? "bg-yellow-600 text-black" : "bg-gray-800 text-gray-200"}`}>
							トレンド
						</button>
						<button onClick={handleClearLines} className="px-2 py-1 rounded text-[11px] bg-gray-800 text-gray-200">
							クリア
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

export default RealtimeChart;
