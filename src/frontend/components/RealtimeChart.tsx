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

import React, { ReactNode, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useRealtimeChart, OHLCVBar, PendingBar, ConnectionStatus } from "@/hooks/useRealtimeChart";
import { DrawnLine, OHLCVDataPoint, IndicatorLineConfig, PositionOverlay } from "./CandlestickChart";
import { IndicatorSelector, SelectedIndicator } from "./IndicatorSelector";
import { indicatorToChartConfigs } from "@/lib/chartIndicators";
import { getMarketStatus, MarketStatus } from "@/lib/marketHours";
import { useTradingAccount } from "@/hooks/useTradingAccount";
import { OrderPanel } from "@/components/chart/OrderPanel";
import { DraggableOrderPanel } from "@/components/chart/DraggableOrderPanel";
import { ChartPaneContainer } from "@/components/chart/ChartPaneContainer";
import { DrawingMode } from "@/components/chart/DrawingOverlay";
import { apiFetch } from "@/lib/apiClient";
import { ChartSymbolsResponseSchema, type ChartSymbolOption } from "@/schemas/api/chartSymbols";
import { SelectedIndicatorArraySchema } from "@/schemas/api/chartIndicators";
import { z } from "zod";

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

// 市場関連定数 (シンボル / TF / 本数) は marketConstants.ts に集約。
// page.tsx 等と重複させない (ハードコード重複の再発防止 2026-06-06)。
import {
	SYMBOL_OPTIONS,
	TIMEFRAME_OPTIONS,
	DATA_COUNT_OPTIONS,
	DEFAULT_DATA_COUNT,
	secondsToApiTimeframe,
	DEFAULT_TIMEFRAME_API,
	FALLBACK_REFRESH_INTERVAL_MS as FALLBACK_REFRESH_INTERVAL,
	BROKER_QUOTE_REFRESH_INTERVAL_MS as BROKER_QUOTE_REFRESH_INTERVAL,
} from '@/lib/marketConstants';

const DEFAULT_LINE_COLOR = "#fbbf24";
const DEFAULT_LINE_WIDTH = 2;
const LINE_WIDTH_OPTIONS = [1, 2, 3, 4];

// ブローカー (cTrader) overlay 用の型。ローソ足 (EODHD/local) とは別レイヤー。
type BrokerConnectionStatus = "connected" | "degraded" | "disconnected";

interface BrokerQuote {
	symbol: string;
	broker: "cTrader";
	bid: number;
	ask: number;
	spread: number;
	timestamp: string;
	isRealtime: boolean;
}

interface BrokerQuoteResponse {
	quote: BrokerQuote | null;
	status: BrokerConnectionStatus;
	warning?: string;
}

// /api/chart/candles レスポンス (ChartCandlesResponse) の最小ランタイム検証用。
// frontend に Zod 依存が無いため、外部レスポンスは型ガードで narrow し盲目的な as を避ける。
interface ChartCandlePayload {
	time: number;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number | null;
}
interface ChartCandlesPayload {
	candles: ChartCandlePayload[];
	warning?: string;
}

function isChartCandlesPayload(value: unknown): value is ChartCandlesPayload {
	if (typeof value !== "object" || value === null) return false;
	const candles = (value as { candles?: unknown }).candles;
	if (!Array.isArray(candles)) return false;
	return candles.every(
		(c) =>
			typeof c === "object" &&
			c !== null &&
			typeof (c as { time?: unknown }).time === "number" &&
			typeof (c as { open?: unknown }).open === "number" &&
			typeof (c as { high?: unknown }).high === "number" &&
			typeof (c as { low?: unknown }).low === "number" &&
			typeof (c as { close?: unknown }).close === "number"
	);
}

function isBrokerQuoteResponse(value: unknown): value is BrokerQuoteResponse {
	if (typeof value !== "object" || value === null) return false;
	const status = (value as { status?: unknown }).status;
	return status === "connected" || status === "degraded" || status === "disconnected";
}

// /api/chart/symbols のレスポンス (動的シンボル候補) は @/schemas/api/chartSymbols の
// Zod スキーマでランタイム検証する (フロントにシンボルをハードコードさせない動的供給, 条件7)。

/** フロントでのシンボル正規化 (英数字のみ・大文字化)。backend の normalizeCTraderSymbol と整合。 */
const normalizeSymbolInput = (raw: string): string =>
	raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

// 選択インジケーターは銘柄横断のユーザー設定として localStorage にグローバル保存する。
// (描画ラインは銘柄×足ごと=ChartDrawing だが、インジケーターは銘柄に依らず適用したいため)
export const SELECTED_INDICATORS_STORAGE_KEY = "chart-selected-indicators";

/**
 * localStorage から選択インジケーターを復元する (条件6: 再起動でも消えない)。
 * 壊れた値・旧形式は Zod で弾いて空配列にフォールバックする。
 *
 * **副作用を持たせないこと**: 本関数は useState の lazy initializer として呼ばれる。
 * initializer は開発時の React StrictMode による二重実行や再マウント等で複数回呼ばれうる。
 * 以前ここに「描画試行中」sentinel の setItem を入れていたが、複数回呼ばれると 1 回目で
 * sentinel を立て→2 回目が「前回クラッシュ」と誤判定して復元を破棄し、インジが消える不具合を
 * 起こした。よって本関数は純粋な read のみにする。クラッシュ自体は描画側 (ChartPaneContainer の
 * setVisibleRange / データ再投入 try/catch) で根治済みのため、復元ループ用の sentinel は不要。
 */
export function loadPersistedIndicators(): SelectedIndicator[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = window.localStorage.getItem(SELECTED_INDICATORS_STORAGE_KEY);
		if (!raw) return [];
		const parsed = SelectedIndicatorArraySchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : [];
	} catch {
		return [];
	}
}

// 時間足 (秒) と取得本数も銘柄横断のユーザー設定として localStorage に保存する。
// 理由: リロード / 一旦離れて再訪したときにデフォルト (1分足 / 1000本) に戻ってしまい、
// 5000本や1時間足にした選択が毎回失われて不便だったため (Side-A UI 改善)。
// 値は marketConstants の許容集合で検証し、壊れた / 旧形式の値は fallback に落とす。
export const SELECTED_TIMEFRAME_STORAGE_KEY = "chart-selected-timeframe";
export const SELECTED_DATA_COUNT_STORAGE_KEY = "chart-selected-data-count";

// localStorage 由来の値も外部入力としてインジ復元 (SelectedIndicatorArraySchema) と同様に Zod で検証する。
// z.coerce.number で文字列→数値化し、許容集合 (marketConstants) に含まれる値のみ通す。
// 文字列化不能 (NaN) / 集合外 / 空文字はすべて refine で弾かれ、呼び出し側で fallback に落ちる。
const PersistedTimeframeSchema = z.coerce
	.number()
	.refine((value) => TIMEFRAME_OPTIONS.some((opt) => opt.value === value));
const PersistedDataCountSchema = z.coerce
	.number()
	.refine((value) => DATA_COUNT_OPTIONS.some((opt) => opt.value === value));

/** localStorage から時間足 (秒) を復元する。許容外・壊れた値は fallback を返す。 */
export function loadPersistedTimeframe(fallback: number): number {
	if (typeof window === "undefined") return fallback;
	try {
		const raw = window.localStorage.getItem(SELECTED_TIMEFRAME_STORAGE_KEY);
		if (raw === null) return fallback;
		const parsed = PersistedTimeframeSchema.safeParse(raw);
		return parsed.success ? parsed.data : fallback;
	} catch {
		return fallback;
	}
}

/** localStorage から取得本数を復元する。許容外・壊れた値は fallback を返す。 */
export function loadPersistedDataCount(fallback: number): number {
	if (typeof window === "undefined") return fallback;
	try {
		const raw = window.localStorage.getItem(SELECTED_DATA_COUNT_STORAGE_KEY);
		if (raw === null) return fallback;
		const parsed = PersistedDataCountSchema.safeParse(raw);
		return parsed.success ? parsed.data : fallback;
	} catch {
		return fallback;
	}
}

/**
 * 銘柄ピッカー (検索可能な free-text 入力 + 動的候補 datalist)。
 *
 * TradingView / MT5 / cTrader と同様、任意シンボルを打ち込めて、候補からも選べる。
 * - 候補一致を選んだ場合: 即確定
 * - free-text を打った場合: Enter / blur で確定 (3 文字以上 & 現在値と異なる時のみ)
 * - 無効入力 (空・短すぎ) は元の symbol に戻す
 */
export function SymbolPicker({
	symbol,
	options,
	onCommit,
	listId,
	className,
}: {
	symbol: string;
	options: ChartSymbolOption[];
	onCommit: (symbol: string) => void;
	listId: string;
	className: string;
}) {
	const [input, setInput] = useState(symbol);

	// 外部 (親) で symbol が変わったら入力欄も同期する
	useEffect(() => {
		setInput(symbol);
	}, [symbol]);

	const commit = (raw: string) => {
		const normalized = normalizeSymbolInput(raw);
		if (normalized.length >= 3 && normalized !== symbol) {
			onCommit(normalized);
		} else {
			setInput(symbol); // 無効入力は元に戻す
		}
	};

	return (
		<>
			<input
				list={listId}
				value={input}
				onChange={(e) => {
					const v = e.target.value;
					setInput(v);
					// datalist 候補を選んだ場合 (value 完全一致) は即確定する
					if (options.some((o) => o.value === v)) commit(v);
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter") e.currentTarget.blur();
				}}
				onBlur={() => commit(input)}
				className={className}
				placeholder="シンボル"
				spellCheck={false}
				autoComplete="off"
				aria-label="シンボル"
			/>
			<datalist id={listId}>
				{options.map((opt) => (
					<option key={opt.value} value={opt.value}>
						{opt.label}
					</option>
				))}
			</datalist>
		</>
	);
}

interface PricePanelProps {
	bar: PendingBar | OHLCVBar | null;
	dailyHigh: number | null;
	dailyLow: number | null;
	previousClose: number | null;
	// ブローカー (cTrader) の現在気配。価格情報と同じ行に Bid/Ask/スプレッドとして並べる。
	brokerStatus: BrokerConnectionStatus;
	brokerQuote: BrokerQuote | null;
}

// 価格の小数桁数を価格帯から推定する (cTrader digits 情報が無いため近似)。
// 例: EURUSD(1.08)→5桁 / USDJPY(150)→3桁 / XAUUSD(4458)→2桁。
const priceDigits = (value: number): number => {
	const v = Math.abs(value);
	if (v >= 1000) return 2;
	if (v >= 100) return 3;
	return 5;
};
// 価格を整形する。Bid/Ask/スプレッドは桁数を揃えたいので refForDigits に基準価格を渡す。
const formatPrice = (value: number, refForDigits?: number): string =>
	value.toFixed(priceDigits(refForDigits ?? value));

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

	return <span className={`text-xs px-2 h-7 inline-flex items-center rounded ${colorClass}`}>{label}</span>;
};

const PricePanel = ({ bar, dailyHigh, dailyLow, previousClose, brokerStatus, brokerQuote }: PricePanelProps) => {
	if (!bar) {
		return <div className="bg-gray-800 rounded-lg p-3 text-sm text-gray-500 border border-gray-700">データ未取得</div>;
	}

	const timestamp = "startTime" in bar ? bar.startTime : bar.timestamp;
	// JST 固定 + 24 時間制で表示し、チャート横軸 (JST 化済み) と時刻基準を揃える
	const timeLabel = new Date(timestamp).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false }) + " JST";
	const dayChange = previousClose != null ? bar.close - previousClose : null;
	const dayChangePercent = previousClose != null && previousClose !== 0 && dayChange != null ? (dayChange / previousClose) * 100 : null;
	const changeColor = dayChange != null ? (dayChange >= 0 ? "text-green-400" : "text-red-400") : "text-gray-400";
	const formatNullable = (val: number | null) => (val == null ? "-" : formatPrice(val, bar.close));
	const dayChangePercentLabel = dayChangePercent == null ? "--%" : `${dayChangePercent >= 0 ? "+" : ""}${dayChangePercent.toFixed(2)}%`;

	return (
		<div className="bg-gray-800 rounded-lg p-2">
			<div className="flex flex-nowrap items-center gap-1.5 text-sm overflow-x-auto">
				<div className="flex-none w-[90px] bg-gray-900/60 rounded px-2 py-1">
					<div className="text-[10px] text-gray-400 whitespace-nowrap">現在価格</div>
					<div className="text-base font-mono font-bold text-green-400 leading-tight whitespace-nowrap">{formatPrice(bar.close)}</div>
				</div>

				<div className="flex-none w-[90px] bg-gray-900/60 rounded px-2 py-1">
					<div className="text-[10px] text-gray-400 whitespace-nowrap">時刻</div>
					<div className="font-mono text-xs text-gray-200 leading-tight whitespace-nowrap">{timeLabel}</div>
				</div>

				<div className="flex-none w-[90px] bg-gray-900/60 rounded px-2 py-1">
					<div className="text-[10px] text-gray-400 whitespace-nowrap">前日比（{dayChangePercentLabel}）</div>
					<div className={`font-mono text-xs ${changeColor} leading-tight whitespace-nowrap`}>
						{dayChange == null ? "-" : `${dayChange >= 0 ? "+" : ""}${formatPrice(dayChange, bar.close)}`}
					</div>
				</div>

				<div className="flex-none w-[90px] bg-gray-900/60 rounded px-2 py-1">
					<div className="text-[10px] text-gray-400 whitespace-nowrap">当日高値</div>
					<div className="font-mono text-xs text-green-300 leading-tight whitespace-nowrap">{formatNullable(dailyHigh)}</div>
				</div>

				<div className="flex-none w-[90px] bg-gray-900/60 rounded px-2 py-1">
					<div className="text-[10px] text-gray-400 whitespace-nowrap">当日安値</div>
					<div className="font-mono text-xs text-red-300 leading-tight whitespace-nowrap">{formatNullable(dailyLow)}</div>
				</div>

				{/* ブローカー (cTrader) 気配。価格情報と同じ行に並べ、UX 上まとめて把握できるようにする */}
				<div className="flex-none w-px self-stretch bg-gray-700 mx-0.5" />
				{brokerStatus === "connected" && brokerQuote ? (
					<>
						<div className="flex-none w-[100px] bg-gray-900/60 rounded px-2 py-1 border border-emerald-700/30">
							<div className="text-[10px] text-gray-400 whitespace-nowrap">Bid</div>
							<div className="font-mono text-xs text-red-400 leading-tight whitespace-nowrap">{formatPrice(brokerQuote.bid)}</div>
						</div>
						<div className="flex-none w-[100px] bg-gray-900/60 rounded px-2 py-1 border border-emerald-700/30">
							<div className="text-[10px] text-gray-400 whitespace-nowrap">Ask</div>
							<div className="font-mono text-xs text-green-400 leading-tight whitespace-nowrap">{formatPrice(brokerQuote.ask, brokerQuote.bid)}</div>
						</div>
						<div className="flex-none w-[90px] bg-gray-900/60 rounded px-2 py-1">
							{/* スプレッドは価格差 (生値)。Bid/Ask と桁数を揃えて単位 (建値通貨の価格差) を明確にする */}
							<div className="text-[10px] text-gray-400 whitespace-nowrap">スプレッド(価格差)</div>
							<div className="font-mono text-xs text-yellow-400 leading-tight whitespace-nowrap">{formatPrice(brokerQuote.spread, brokerQuote.bid)}</div>
						</div>
					</>
				) : (
					<div className="flex-none flex items-center gap-1.5 bg-gray-900/40 rounded px-2 py-1 border border-gray-700/60">
						<span className="inline-block w-2 h-2 rounded-full bg-gray-500" />
						<span className="text-[11px] text-gray-400 whitespace-nowrap">
							{brokerStatus === "degraded" ? "気配取得不可" : "ブローカー未接続"}
						</span>
					</div>
				)}
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
	// 時間足・本数は localStorage から復元 (なければ初期値)。リロードでデフォルトに戻さない。
	const [timeframe, setTimeframe] = useState<number>(() => loadPersistedTimeframe(initialTimeframe));
	const [dataCount, setDataCount] = useState<number>(() => loadPersistedDataCount(DEFAULT_DATA_COUNT)); // データ本数 (marketConstants.ts)
	const [drawingMode, setDrawingMode] = useState<DrawingMode>("none");
	const [drawnLines, setDrawnLines] = useState<DrawnLine[]>([]);
	// 初期値は localStorage から復元 (条件6: 再起動でインジケーターが消えない)
	const [selectedIndicators, setSelectedIndicators] = useState<SelectedIndicator[]>(loadPersistedIndicators);

	// シンボル候補 (動的)。初期値は marketConstants の最終フォールバック。
	// マウント後に /api/chart/symbols (cTrader ∪ DB ∪ シード) で上書きする (条件7)。
	const [symbolOptions, setSymbolOptions] = useState<ChartSymbolOption[]>(() =>
		SYMBOL_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
	);

	// 市場時間判定ステート
	const [marketStatus, setMarketStatus] = useState<MarketStatus>(() => getMarketStatus());

	// 市場時間を定期チェック（1分間隔）
	useEffect(() => {
		const checkMarket = () => setMarketStatus(getMarketStatus());
		const timer = setInterval(checkMarket, 60000);
		return () => clearInterval(timer);
	}, []);

	// シンボル候補を API から動的取得して上書きする (失敗時はフォールバックを維持)。
	const apiBaseForSymbols = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
	useEffect(() => {
		let cancelled = false;
		const loadSymbols = async () => {
			try {
				const res = await apiFetch(`${apiBaseForSymbols}/api/chart/symbols`);
				if (!res.ok) return;
				// 外部レスポンスは Zod でランタイム検証してから採用する (盲目的な as を避ける)
				const parsed = ChartSymbolsResponseSchema.safeParse(await res.json());
				if (!cancelled && parsed.success && parsed.data.data.symbols.length > 0) {
					setSymbolOptions(parsed.data.data.symbols);
				}
			} catch {
				// ネットワークエラー時は marketConstants の最終フォールバックを維持する
			}
		};
		void loadSymbols();
		return () => {
			cancelled = true;
		};
	}, [apiBaseForSymbols]);

	// 選択インジケーターを localStorage に永続化する (条件6: 再起動でも消えない)
	useEffect(() => {
		if (typeof window === "undefined") return;
		try {
			window.localStorage.setItem(
				SELECTED_INDICATORS_STORAGE_KEY,
				JSON.stringify(selectedIndicators),
			);
		} catch {
			// localStorage 不可 (容量超過 / プライベートモード) は無視
		}
	}, [selectedIndicators]);

	// 時間足を localStorage に永続化する (リロードでデフォルトに戻さない)
	useEffect(() => {
		if (typeof window === "undefined") return;
		try {
			window.localStorage.setItem(SELECTED_TIMEFRAME_STORAGE_KEY, String(timeframe));
		} catch {
			// localStorage 不可は無視
		}
	}, [timeframe]);

	// 取得本数を localStorage に永続化する (リロードでデフォルトに戻さない)
	useEffect(() => {
		if (typeof window === "undefined") return;
		try {
			window.localStorage.setItem(SELECTED_DATA_COUNT_STORAGE_KEY, String(dataCount));
		} catch {
			// localStorage 不可は無視
		}
	}, [dataCount]);

	// 復元した時間足を親 (市場分析パネル) にも一度だけ反映する。
	// 親は自前の selectedTimeframe をデフォルトで初期化するため、child の復元値と
	// ズレたまま分析パネルだけ別 TF を表示してしまうのを防ぐ。ref で初回のみ実行。
	const didNotifyInitialTimeframe = useRef(false);
	useEffect(() => {
		if (didNotifyInitialTimeframe.current) return;
		didNotifyInitialTimeframe.current = true;
		if (timeframe !== initialTimeframe) {
			onTimeframeChange?.(timeframe);
		}
	}, [timeframe, initialTimeframe, onTimeframeChange]);

	// チャート OHLCV フォールバック用ステート
	const [fallbackData, setFallbackData] = useState<OHLCVDataPoint[]>([]);
	const [fallbackLoading, setFallbackLoading] = useState(false);
	const [fallbackError, setFallbackError] = useState<string | null>(null);
	// データ無し/遅延などの「警告」はエラーと分けて扱う (再試行を促さない)
	const [fallbackWarning, setFallbackWarning] = useState<string | null>(null);
	const fallbackTimerRef = useRef<NodeJS.Timeout | null>(null);

	// ブローカー (cTrader) overlay 用ステート。ローソ足とは別レイヤーで bid/ask を扱う。
	const [brokerQuote, setBrokerQuote] = useState<BrokerQuote | null>(null);
	const [brokerStatus, setBrokerStatus] = useState<BrokerConnectionStatus>("disconnected");
	const brokerTimerRef = useRef<NodeJS.Timeout | null>(null);

	// モバイル発注シートの開閉
	const [showMobileOrder, setShowMobileOrder] = useState(false);

	const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

	const storageKey = useMemo(() => `chart-lines-${symbol}-${timeframe}`, [symbol, timeframe]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		let isCancelled = false;
		const loadLines = async () => {
			try {
				const res = await apiFetch(
					`${apiBase}/api/chart-drawings?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(String(timeframe))}`,
					{ cache: "no-store" }
				);
				if (!res.ok) {
					throw new Error(`HTTP ${res.status}`);
				}
				const result = await res.json() as { success: boolean; data?: { lines?: DrawnLine[] } };
				if (isCancelled) return;
				if (result.success && result.data?.lines) {
					setDrawnLines(result.data.lines);
					onLinesChange?.(result.data.lines);
					window.localStorage.setItem(storageKey, JSON.stringify(result.data.lines));
					return;
				}
			} catch {
				// API失敗時はローカルキャッシュへフォールバック
			}

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
		};
		void loadLines();
		return () => {
			isCancelled = true;
		};
	}, [apiBase, onLinesChange, storageKey, symbol, timeframe]);

	// realtime SSE は「進行中の足を重ねるオーバーレイ」。チャート本体 (ヒストリカル
	// ローソク足) は接続状態に依存せず常に表示する (下の fetchFallbackData 経路)。
	// autoConnect は市場開場中のみ true。閉場中 (週末・祝日等) は配信が無く、接続前
	// send による "Sent before connected" エラーの温床になるため SSE を張らない。
	// connect() は POST /api/realtime/connect → EodhdRealtimeOrchestrator (EODHD WS) で
	// EODHD_API_KEY 共通認証 (cTrader 非依存)。bid/ask overlay は /api/broker/quote の別経路。
	const { bars, pendingBar, latestTick, status, error, isConnected, isLoading, isMarketClosed, connect, disconnect } = useRealtimeChart(symbol, { timeframe, persistConnection: true, autoConnect: marketStatus.isOpen });
	const { positions: tradingPositions, refetch: refetchTrading } = useTradingAccount(true);

	// ============================================
	// チャート OHLCV フォールバック (EODHD 主体)
	// SSE (cTrader/EODHD WebSocket) 未接続時に /api/chart/candles から OHLCV を取得する。
	// この経路は cTrader に依存しないため、ブローカー障害時もローソ足を表示できる。
	// ============================================
	const fetchFallbackData = useCallback(async () => {
		const apiTimeframe = secondsToApiTimeframe(timeframe) ?? DEFAULT_TIMEFRAME_API;
		setFallbackLoading(true);
		setFallbackError(null);
		setFallbackWarning(null);
		try {
			const res = await apiFetch(
				`${apiBase}/api/chart/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${apiTimeframe}&limit=${dataCount}`
			);
			if (!res.ok) {
				// 404=symbol未対応 / 503=外部プロバイダー障害 をサーバーのメッセージで区別する
				const errBody = await res.json().catch(() => null) as { error?: string } | null;
				throw new Error(errBody?.error || `APIエラー: ${res.status}`);
			}
			// ChartCandlesResponse を型ガードで検証してから利用する (盲目的な as を避ける)
			const payload: unknown = await res.json();
			if (!isChartCandlesPayload(payload)) {
				throw new Error('チャートデータの形式が不正です');
			}
			const candles = payload.candles;
			const ohlcv: OHLCVDataPoint[] = candles.map((c) => ({
				timestamp: c.time * 1000, // Unix 秒 → ms (lightweight-charts 用)
				open: c.open,
				high: c.high,
				low: c.low,
				close: c.close,
				volume: c.volume ?? 0,
			}));
			setFallbackData(ohlcv);
			// データが空でも 200 で返る (symbol 有効・データ無し)。これはエラーではなく「警告」。
			// 再試行を促す赤表示にせず、注意表示として扱う。
			if (candles.length === 0 && payload.warning) {
				setFallbackWarning(payload.warning);
			}
		} catch (err) {
			setFallbackError(err instanceof Error ? err.message : 'チャートデータ取得失敗');
		} finally {
			setFallbackLoading(false);
		}
	}, [apiBase, symbol, timeframe, dataCount]);

	// ヒストリカルローソク足は「常に」取得する。
	//
	// **設計方針 (2026-06-06 全面修正)**: TradingView / MT5 / cTrader と同様、チャートは
	// 市場の開閉やリアルタイム接続状態に関係なく、まずヒストリカルローソク足
	// (EODHD → 障害時 DB) を土台として常時表示する。realtime SSE はこの上に進行中の足を
	// 重ねるだけのオーバーレイ。以前は本取得を marketStatus.isOpen / 接続状態でゲートして
	// いたため、週末 (FX 閉場) にローソク足が 1 本も出ず「市場は閉場しています」だけが
	// 出る不具合があった (条件1/2 違反)。
	useEffect(() => {
		// マウント時・symbol/timeframe/dataCount 変更時に必ず 1 回取得する。
		void fetchFallbackData();

		// 定期リフレッシュは「市場開場中 かつ realtime 未接続」の時だけ行う。
		// 閉場中は価格が動かず、realtime 接続中は SSE が最新足を更新するため、無駄な再取得を避ける。
		if (marketStatus.isOpen && !isConnected) {
			fallbackTimerRef.current = setInterval(() => {
				void fetchFallbackData();
			}, FALLBACK_REFRESH_INTERVAL);
		}

		return () => {
			if (fallbackTimerRef.current) {
				clearInterval(fallbackTimerRef.current);
				fallbackTimerRef.current = null;
			}
		};
	}, [fetchFallbackData, marketStatus.isOpen, isConnected]);

	// ============================================
	// ブローカー (cTrader) quote overlay
	// チャートのローソ足とは独立して bid/ask/スプレッドを取得する。
	// cTrader 障害時は status=degraded/disconnected を受け取り、発注ボタンを無効化する。
	// ============================================
	const fetchBrokerQuote = useCallback(async () => {
		try {
			const res = await apiFetch(
				`${apiBase}/api/broker/quote?symbol=${encodeURIComponent(symbol)}`
			);
			// 503 (disconnected) でも body は BrokerQuoteResponse 形式で返るが、
			// 401 等の想定外レスポンスは形が異なるため、型ガードで検証してから採用する。
			const payload: unknown = await res.json().catch(() => null);
			if (!isBrokerQuoteResponse(payload)) {
				setBrokerStatus("disconnected");
				setBrokerQuote(null);
				return;
			}
			setBrokerStatus(payload.status);
			setBrokerQuote(payload.quote);
		} catch {
			// ネットワークエラー時はブローカー未接続扱い (チャート表示には影響しない)
			setBrokerStatus("disconnected");
			setBrokerQuote(null);
		}
	}, [apiBase, symbol]);

	// シンボル変更時に即時取得 + 市場開場中は定期更新
	useEffect(() => {
		if (!marketStatus.isOpen) {
			if (brokerTimerRef.current) {
				clearInterval(brokerTimerRef.current);
				brokerTimerRef.current = null;
			}
			setBrokerStatus("disconnected");
			setBrokerQuote(null);
			return;
		}
		void fetchBrokerQuote();
		brokerTimerRef.current = setInterval(() => {
			void fetchBrokerQuote();
		}, BROKER_QUOTE_REFRESH_INTERVAL);
		return () => {
			if (brokerTimerRef.current) {
				clearInterval(brokerTimerRef.current);
				brokerTimerRef.current = null;
			}
		};
	}, [fetchBrokerQuote, marketStatus.isOpen]);

	const handleTimeframeChange = async (newTimeframe: number) => {
		const wasConnected = isConnected;
		if (wasConnected) {
			disconnect();
		}
		setTimeframe(newTimeframe);
		setDrawingMode("none");
		onTimeframeChange?.(newTimeframe);
		// 接続中だった場合は自動再接続
		if (wasConnected) {
			setTimeout(() => {
				void connect();
			}, 500); // 少し待ってから再接続
		}
	};

	const handleSymbolChange = async (newSymbol: string) => {
		const wasConnected = isConnected;
		if (wasConnected) {
			disconnect();
		}
		setDrawingMode("none");
		onSymbolChange?.(newSymbol);
		// 接続中だった場合は自動再接続
		if (wasConnected) {
			setTimeout(() => {
				void connect();
			}, 500); // 少し待ってから再接続
		}
	};

	const persistLines = (lines: DrawnLine[]) => {
		setDrawnLines(lines);
		onLinesChange?.(lines);
		if (typeof window === "undefined") return;
		if (lines.length === 0) {
			window.localStorage.removeItem(storageKey);
		} else {
			window.localStorage.setItem(storageKey, JSON.stringify(lines));
		}
		void apiFetch(`${apiBase}/api/chart-drawings/sync`, {
			method: "PUT",
			body: JSON.stringify({
				symbol,
				timeframe: String(timeframe),
				lines,
			}),
		}).catch(() => {
			// ネットワークエラー時はローカル保存を優先
		});
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
			if (
				(line.type === "trend" || line.type === "rectangle" || line.type === "fibonacci") &&
				("startPrice" in payload || "endPrice" in payload || "startTime" in payload || "endTime" in payload)
			) {
				return { ...line, ...payload, ...baseUpdate } as typeof line;
			}
			if (line.type === "text" && ("text" in payload || "time" in payload || "price" in payload)) {
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

		// ベース: ヒストリカルローソク足 (EODHD → 障害時 DB)。深い本数 (dataCount) を土台にする。
		for (const d of fallbackData) {
			dataMap.set(d.timestamp, d);
		}

		// オーバーレイ: realtime SSE の確定バー。同一時刻足は上書き、新しい足は追加する。
		// これによりヒストリカルの深さを保ったまま最新足だけがライブ更新される
		// (以前は SSE 接続時にヒストリカルを丸ごと捨てて ≤60 本に縮んでいた)。
		for (const bar of bars) {
			const timestamp = new Date(bar.timestamp).getTime();
			dataMap.set(timestamp, { timestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume });
		}

		// 進行中バー (未確定) を最後に重ねる。
		if (pendingBar) {
			const timestamp = new Date(pendingBar.startTime).getTime();
			dataMap.set(timestamp, { timestamp, open: pendingBar.open, high: pendingBar.high, low: pendingBar.low, close: pendingBar.close, volume: pendingBar.volume });
		}

		return Array.from(dataMap.values()).sort((a, b) => a.timestamp - b.timestamp);
	}, [bars, pendingBar, fallbackData]);

	// 選択されたインジケーターを計算
	const indicatorConfigs: IndicatorLineConfig[] = useMemo(() => {
		if (chartData.length === 0 || selectedIndicators.length === 0) {
			// デバッグモード時のみログ出力（頻繁なログを避ける）
			if (process.env.NODE_ENV === 'development' && selectedIndicators.length > 0) {
				console.log('[RealtimeChart] インジケーター計算スキップ（データ不足）:', { chartDataLength: chartData.length, selectedIndicatorsLength: selectedIndicators.length });
			}
			return [];
		}

		const configs: IndicatorLineConfig[] = [];
		for (const selected of selectedIndicators) {
			try {
				const indicatorConfigs = indicatorToChartConfigs(
					selected.id,
					chartData,
					selected.params,
					selected.displaySettings
				);
				configs.push(...indicatorConfigs);
			} catch (error) {
				console.error(`[RealtimeChart] インジケーター計算エラー (${selected.id}):`, error);
			}
		}
		// デバッグモード時のみ詳細ログ
		if (process.env.NODE_ENV === 'development' && configs.length > 0) {
			console.log('[RealtimeChart] インジケーター計算完了:', { selectedCount: selectedIndicators.length, configCount: configs.length });
		}
		return configs;
	}, [chartData, selectedIndicators]);

	// latestBar: cTrader バーがあればそれを使い、なければ fallback チャートデータの最後の要素を使う
	const latestBar = bars.length > 0 ? bars[bars.length - 1] : null;
	const latestFallbackBar = chartData.length > 0 ? chartData[chartData.length - 1] : null;

	// PricePanel に渡す疑似バー（cTrader 未接続時）
	const pricePanelBar = latestBar ?? (latestFallbackBar ? {
		symbol,
		timeframe: String(timeframe),
		timestamp: new Date(latestFallbackBar.timestamp).toISOString(),
		open: latestFallbackBar.open,
		high: latestFallbackBar.high,
		low: latestFallbackBar.low,
		close: latestFallbackBar.close,
		volume: latestFallbackBar.volume,
		tickCount: 0,
	} as OHLCVBar : null);

	const { dailyHigh, dailyLow, previousClose } = useMemo(() => {
		// chartData を使って計算（cTrader・フォールバックどちらでも動く）
		if (chartData.length === 0) return { dailyHigh: null, dailyLow: null, previousClose: null };
		const lastPoint = chartData[chartData.length - 1];
		const latestTs = new Date(lastPoint.timestamp);
		const dayStart = new Date(latestTs);
		dayStart.setHours(0, 0, 0, 0);

		const sameDayPoints = chartData.filter((d) => {
			const ts = new Date(d.timestamp);
			return ts >= dayStart && ts <= latestTs;
		});

		const dailyHighVal = sameDayPoints.length > 0 ? Math.max(...sameDayPoints.map((d) => d.high)) : null;
		const dailyLowVal = sameDayPoints.length > 0 ? Math.min(...sameDayPoints.map((d) => d.low)) : null;

		const previousDayPoints = chartData.filter((d) => {
			const ts = new Date(d.timestamp);
			return ts < dayStart;
		});
		const previousCloseVal = previousDayPoints.length > 0 ? previousDayPoints[previousDayPoints.length - 1].close : null;

		return { dailyHigh: dailyHighVal, dailyLow: dailyLowVal, previousClose: previousCloseVal };
	}, [chartData]);

	const drawingLabel = drawingMode === "horizontal"
		? "水平線"
		: drawingMode === "trend"
			? "トレンドライン"
			: drawingMode === "rectangle"
				? "矩形"
				: drawingMode === "fibonacci"
					? "フィボナッチ"
					: drawingMode === "text"
						? "テキスト"
						: "オフ";

	const symbolPositions = useMemo(
		() => tradingPositions.filter((position) => position.symbol.replace('/', '').toUpperCase() === symbol.replace('/', '').toUpperCase()),
		[tradingPositions, symbol]
	);

	// 発注の無効化理由 (市場閉場 / ブローカー未接続)。OrderPanel に渡して誤案内を防ぐ。
	const orderDisabled = !marketStatus.isOpen || brokerStatus !== "connected";
	const orderDisabledReason = !marketStatus.isOpen
		? "市場閉場のため発注できません"
		: brokerStatus !== "connected"
			? "ブローカー未接続のため発注できません"
			: undefined;

	const positionOverlays: PositionOverlay[] = useMemo(
		() =>
			symbolPositions.map((position) => ({
				positionId: position.positionId,
				side: position.side,
				entryPrice: position.entryPrice,
				takeProfit: position.takeProfit,
				stopLoss: position.stopLoss,
				profitLoss: position.profitLoss,
			})),
		[symbolPositions]
	);

	return (
		<div className="bg-gray-900 rounded-lg overflow-hidden">
			{/* デスクトップ用ヘッダー
			    中間幅でも各コントロールを縮ませず (shrink-0)・文字を横維持 (whitespace-nowrap) し、
			    収まらない時は縦に折り返さず横スクロール (overflow-x-auto) させる。
			    スペーサー (flex-1) は余白がある時だけ伸び、狭い時は 0 に畳まれて右側要素を寄せる。 */}
			<div className="bg-gray-800 px-3 py-2 hidden md:flex items-center gap-2 border-b border-gray-700 overflow-x-auto [&>*]:shrink-0 [&>*]:whitespace-nowrap">
				<SymbolPicker
					symbol={symbol}
					options={symbolOptions}
					onCommit={handleSymbolChange}
					listId="chart-symbols-desktop"
					className="bg-gray-700 text-white text-xs rounded px-2 h-7 border border-gray-600 hover:border-gray-500 w-24"
				/>

				<select value={timeframe} onChange={(e) => handleTimeframeChange(parseInt(e.target.value, 10))} className="bg-gray-700 text-white text-xs rounded px-2 h-7 border border-gray-600 hover:border-gray-500">
					{TIMEFRAME_OPTIONS.map((opt) => (
						<option key={opt.value} value={opt.value}>
							{opt.label}
						</option>
					))}
				</select>

				<select value={dataCount} onChange={(e) => setDataCount(parseInt(e.target.value, 10))} className="bg-gray-700 text-white text-xs rounded px-2 h-7 border border-gray-600 hover:border-gray-500">
					{DATA_COUNT_OPTIONS.map((opt) => (
						<option key={opt.value} value={opt.value}>
							{opt.label}
						</option>
					))}
				</select>

				<button onClick={() => setDrawingMode(drawingMode === "horizontal" ? "none" : "horizontal")} className={`h-7 w-7 inline-flex items-center justify-center text-xs rounded transition ${drawingMode === "horizontal" ? "bg-yellow-600 text-black" : "bg-gray-700 text-gray-200 hover:bg-gray-600"}`} aria-label="水平線" title="水平線">
					↔︎
				</button>

				<button onClick={() => setDrawingMode(drawingMode === "trend" ? "none" : "trend")} className={`h-7 w-7 inline-flex items-center justify-center text-xs rounded transition ${drawingMode === "trend" ? "bg-yellow-600 text-black" : "bg-gray-700 text-gray-200 hover:bg-gray-600"}`} aria-label="トレンドライン" title="トレンドライン">
					↗︎
				</button>
				<button onClick={() => setDrawingMode(drawingMode === "rectangle" ? "none" : "rectangle")} className={`h-7 w-7 inline-flex items-center justify-center text-xs rounded transition ${drawingMode === "rectangle" ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-200 hover:bg-gray-600"}`} aria-label="矩形" title="矩形">
					▭
				</button>
				<button onClick={() => setDrawingMode(drawingMode === "fibonacci" ? "none" : "fibonacci")} className={`h-7 w-7 inline-flex items-center justify-center text-xs rounded transition ${drawingMode === "fibonacci" ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-200 hover:bg-gray-600"}`} aria-label="フィボナッチ" title="フィボナッチ">
					F
				</button>
				<button onClick={() => setDrawingMode(drawingMode === "text" ? "none" : "text")} className={`h-7 w-7 inline-flex items-center justify-center text-xs rounded transition ${drawingMode === "text" ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-200 hover:bg-gray-600"}`} aria-label="テキスト" title="テキスト">
					T
				</button>

				<button onClick={handleClearLines} className="px-2 h-7 inline-flex items-center text-xs rounded bg-gray-700 text-gray-200 hover:bg-gray-600">
					クリア
				</button>

				<div className="flex-1" />

				<IndicatorSelector
					selectedIndicators={selectedIndicators}
					onSelectionChange={setSelectedIndicators}
					compact={true}
				/>

				<div className="flex items-center gap-2">
					<StatusBadge status={status} />

					{isConnected ? (
						<button
							onClick={disconnect}
							className="px-3 h-7 inline-flex items-center bg-red-600 hover:bg-red-700 text-white text-xs rounded transition"
						>
							切断
						</button>
					) : (
						<button onClick={connect} disabled={isLoading} className={`px-3 h-7 inline-flex items-center text-white text-xs rounded transition ${isLoading ? "bg-gray-600 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"}`}>
							{isLoading ? "接続中..." : "接続"}
						</button>
					)}

					{rightAction && <div className="ml-1">{rightAction}</div>}
				</div>
			</div>

			{/* モバイル用インジケーターセレクター（下部固定） */}
			<div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-gray-800 border-t border-gray-700 shadow-lg max-h-[50vh] overflow-y-auto">
				<IndicatorSelector
					selectedIndicators={selectedIndicators}
					onSelectionChange={setSelectedIndicators}
					compact={true}
				/>
			</div>

			{/* realtime SSE のエラーは「ローソク足が 1 本も無い」時だけ目立たせる。
			    ヒストリカルが表示できていれば realtime はオプションのオーバーレイなので、
			    ヘッダーの StatusBadge (エラー) のみで十分 (チャートは隠さない)。 */}
			{error && chartData.length === 0 && (
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
				{chartData.length > 0 ? (
					<div className="space-y-2">
						{/* ステータスバッジ: ローソク足は常に表示し、ここで状態を補足する。
						    閉場中 → 🌙 ヒストリカル表示中 / 開場中だが realtime 未接続 → 接続ボタン付き案内。 */}
						{!marketStatus.isOpen ? (
							<div className="bg-gray-800/60 border-b border-gray-700 px-4 py-1.5 flex items-center gap-2">
								<span className="text-base" aria-hidden="true">🌙</span>
								<p className="text-xs text-gray-300">{marketStatus.message}（ヒストリカルデータを表示中）</p>
							</div>
						) : !isConnected ? (
							<div className="bg-blue-900/30 border-b border-blue-500/50 px-4 py-1.5 flex items-center justify-between">
								<p className="text-blue-300 text-xs">📊 ヒストリカルデータを表示中（30秒ごとに自動更新）</p>
								<button onClick={connect} disabled={isLoading} className={`px-3 py-1 text-white text-xs rounded transition ${isLoading ? "bg-gray-600 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"}`}>
									{isLoading ? "接続中..." : "リアルタイム接続"}
								</button>
							</div>
						) : null}

						<div className="px-2">
							<PricePanel
								bar={pricePanelBar}
								dailyHigh={dailyHigh}
								dailyLow={dailyLow}
								previousClose={previousClose}
								brokerStatus={brokerStatus}
								brokerQuote={brokerQuote}
							/>
						</div>

						<div className="relative" style={{ marginBottom: '60px' }}>
							<ChartPaneContainer
								ohlcvData={chartData}
								height={height}
								indicators={indicatorConfigs}
								drawingMode={drawingMode}
								drawnLines={drawnLines}
								positionOverlays={positionOverlays}
								onCompleteLine={handleCompleteLine}
								onUpdateLine={handleUpdateLine}
								onDeleteLine={handleDeleteLine}
								onExitDrawing={handleExitDrawing}
							/>

							{/* PC: チャート上にコンパクトな発注パネルをオーバーレイ。
							    ハンドルをドラッグして任意位置へ移動でき、位置は localStorage に保存される。
							    描画モード中は誤クリック防止のため隠す。発注はブローカー接続中のみ許可。 */}
							{drawingMode === "none" && (
								<DraggableOrderPanel
									symbol={symbol}
									disabled={orderDisabled}
									disabledReason={orderDisabledReason}
									onOrderPlaced={() => {
										void refetchTrading();
									}}
								/>
							)}
						</div>

						{/* モバイル: 下からスライドする発注シート。FAB で開閉する。 */}
						<div className="md:hidden">
							<button
								type="button"
								onClick={() => setShowMobileOrder((v) => !v)}
								className="w-full rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 py-2 hover:bg-gray-700 transition"
							>
								{showMobileOrder ? "▼ 注文パネルを閉じる" : "▲ ワンクリック注文"}
							</button>
							{showMobileOrder && (
								<div className="mt-2">
									<OrderPanel
										symbol={symbol}
										disabled={orderDisabled}
										disabledReason={orderDisabledReason}
										onOrderPlaced={() => {
											void refetchTrading();
										}}
									/>
								</div>
							)}
						</div>

						<div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-2">
							<div className="flex items-center justify-between mb-2">
								<p className="text-xs text-gray-300">保有ポジション（{symbol}）</p>
								<button
									onClick={() => {
										void refetchTrading();
									}}
									className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-200 hover:bg-gray-600"
								>
									更新
								</button>
							</div>
							{symbolPositions.length === 0 ? (
								<p className="text-xs text-gray-500">このシンボルの保有ポジションはありません</p>
							) : (
								<div className="space-y-1.5">
									{symbolPositions.map((position) => (
										<div key={position.positionId} className="flex items-center gap-2 text-xs text-gray-100 bg-gray-900/60 rounded px-2 py-1 border border-gray-700/60">
											<span className={`px-1.5 py-0.5 rounded ${position.side === "BUY" ? "bg-green-600/30 text-green-300" : "bg-red-600/30 text-red-300"}`}>
												{position.side}
											</span>
											<span className="text-gray-300">Entry {position.entryPrice.toFixed(2)}</span>
											{position.takeProfit !== undefined && <span className="text-green-300">TP {position.takeProfit.toFixed(2)}</span>}
											{position.stopLoss !== undefined && <span className="text-red-300">SL {position.stopLoss.toFixed(2)}</span>}
											<span className={`ml-auto font-mono ${position.profitLoss >= 0 ? "text-green-400" : "text-red-400"}`}>
												{position.profitLoss >= 0 ? "+" : ""}
												{position.profitLoss.toFixed(2)}
											</span>
										</div>
									))}
								</div>
							)}
						</div>

						<div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-2">
							{drawnLines.length === 0 ? (
								<p className="text-xs text-gray-500 text-center">描画ライン無し</p>
							) : (
								<div className="space-y-1.5">
									{drawnLines.map((line, idx) => (
										<div key={line.id} className="flex items-center gap-2 text-xs text-gray-100 bg-gray-900/60 rounded px-2 py-1 border border-gray-700/60">
											<span className="px-1.5 py-0.5 rounded bg-gray-700 text-gray-200">
												{line.type === "horizontal"
													? "水平"
													: line.type === "trend"
														? "トレンド"
														: line.type === "rectangle"
															? "矩形"
															: line.type === "fibonacci"
																? "Fib"
																: "テキスト"} {idx + 1}
											</span>
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
									<span className="text-gray-500 text-xs">{new Date(latestTick.timestamp).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false })} JST</span>
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
					/* ローソク足がまだ 1 本も無い時の状態表示。
					   ヒストリカル取得は市場の開閉に関係なく走るので、通常はここに来ない
					   (取得中 / 取得失敗 / EODHD・DB 双方が空 のいずれか)。
					   loading → error → 市場閉場 → 空 の順で出し分ける。 */
					<div className="flex flex-col items-center justify-center py-16 text-gray-400">
						{fallbackLoading ? (
							<>
								<div className="w-10 h-10 mb-3 border-4 border-gray-600 border-t-blue-400 rounded-full animate-spin" aria-hidden="true" />
								<p className="text-sm text-blue-300">ローソク足データを取得中…</p>
							</>
						) : fallbackError ? (
							<>
								<div className="text-5xl mb-3">⚠️</div>
								<p className="text-sm mb-2 text-red-400">{fallbackError}</p>
								<button onClick={fetchFallbackData} className="px-4 py-1.5 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white transition">
									再試行
								</button>
							</>
						) : !marketStatus.isOpen ? (
							<>
								<div className="text-6xl mb-4">🌙</div>
								<h3 className="text-xl font-semibold text-gray-200 mb-2">市場は閉場しています</h3>
								<p className="text-sm text-gray-400 mb-1">{marketStatus.message}</p>
								<p className="text-xs text-gray-500 mt-2 max-w-md text-center">
									保存済みのヒストリカルデータが見つかりませんでした。市場開場後に自動取得されます。
								</p>
								{fallbackWarning && (
									<p className="text-xs text-gray-500 mt-1 max-w-md text-center">{fallbackWarning}</p>
								)}
							</>
						) : (
							<>
								<div className="w-10 h-10 mb-3 border-4 border-gray-600 border-t-blue-400 rounded-full animate-spin" aria-hidden="true" />
								<p className="text-sm text-blue-300">データを自動取得中…（まだ受信できていません）</p>
								<p className="text-xs text-gray-500 mt-1">30秒ごとに自動で再取得します</p>
								{fallbackWarning && (
									<p className="text-xs text-gray-500 mt-1 max-w-md text-center">{fallbackWarning}</p>
								)}
								<button onClick={fetchFallbackData} className="mt-3 px-4 py-1.5 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white transition">
									再取得
								</button>
							</>
						)}
					</div>
				)}
			</div>

			<div className="md:hidden sticky bottom-0 z-20 bg-gray-900 border-t border-gray-800 px-3 py-2 space-y-2">
				<div className="flex items-center gap-2">
					<SymbolPicker
						symbol={symbol}
						options={symbolOptions}
						onCommit={handleSymbolChange}
						listId="chart-symbols-mobile"
						className="bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700 flex-1 min-w-0 hover:border-gray-600"
					/>

					<select value={timeframe} onChange={(e) => handleTimeframeChange(parseInt(e.target.value, 10))} className="bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700 w-20 hover:border-gray-600">
						{TIMEFRAME_OPTIONS.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>

					<select value={dataCount} onChange={(e) => setDataCount(parseInt(e.target.value, 10))} className="bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700 w-20 hover:border-gray-600">
						{DATA_COUNT_OPTIONS.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>

					{isConnected ? (
						<button
							onClick={disconnect}
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
						<button onClick={() => setDrawingMode(drawingMode === "rectangle" ? "none" : "rectangle")} className={`px-2 py-1 rounded text-[11px] ${drawingMode === "rectangle" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-200"}`}>
							矩形
						</button>
						<button onClick={() => setDrawingMode(drawingMode === "fibonacci" ? "none" : "fibonacci")} className={`px-2 py-1 rounded text-[11px] ${drawingMode === "fibonacci" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-200"}`}>
							Fib
						</button>
						<button onClick={() => setDrawingMode(drawingMode === "text" ? "none" : "text")} className={`px-2 py-1 rounded text-[11px] ${drawingMode === "text" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-200"}`}>
							Text
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
