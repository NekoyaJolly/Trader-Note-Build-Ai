/**
 * BacktestChartTab — バックテスト結果チャート可視化
 *
 * 機能:
 * - ローソク足チャート上にエントリー/イグジットマーカーを表示
 * - 選択トレードの TP/SL ラインを #No 付きで描画
 * - トレードナビゲーション（前/次）
 * - トレード詳細パネル
 * - ストラテジーで使用したインジケーターを自動描画
 */

"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import CandlestickChart, {
    type OHLCVDataPoint,
    type ChartMarker,
    type DrawnLine,
    type IndicatorLineConfig,
} from "./CandlestickChart";
import { fetchOhlcvCandles } from "@/lib/api";
import { indicatorToChartConfigs } from "@/lib/chartIndicators";
import type {
    BacktestTradeEvent,
    Strategy,
    BacktestResult,
    ConditionGroup,
    IndicatorCondition,
} from "@/types/strategy";
import type { IndicatorId, IndicatorParams } from "@/types/indicator";

// ========================================
// 型定義
// ========================================

interface BacktestChartTabProps {
    /** バックテスト結果 */
    result: BacktestResult;
    /** ストラテジー情報（インジケーター・TP/SL表示用） */
    strategy: Strategy;
}

/** ストラテジーから抽出されたインジケーター情報 */
interface ExtractedIndicator {
    indicatorId: IndicatorId;
    params: IndicatorParams;
    key: string; // 一意キー (indicatorId + params の組み合わせ)
}

// ========================================
// カラーパレット
// ========================================

const COLORS = {
    buyEntry: "#22c55e",     // green
    sellEntry: "#ef4444",    // red
    winExit: "#22c55e",      // green
    lossExit: "#ef4444",     // red
    timeoutExit: "#eab308",  // yellow
    signalExit: "#8b5cf6",   // purple
    tp: "rgba(34, 197, 94, 0.6)",   // green semi-transparent
    sl: "rgba(239, 68, 68, 0.6)",   // red semi-transparent
    selected: "#38bdf8",     // sky blue highlight
};

const EXIT_REASON_LABELS: Record<string, string> = {
    take_profit: "TP利確",
    stop_loss: "SL損切",
    timeout: "タイムアウト",
    signal: "シグナル",
};

// ========================================
// ユーティリティ
// ========================================

function formatPrice(price: number, symbol: string): string {
    const isJpy = symbol.includes("JPY");
    return price.toFixed(isJpy ? 3 : 5);
}

function formatDuration(entryTime: string, exitTime: string): string {
    const ms = new Date(exitTime).getTime() - new Date(entryTime).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}分`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}時間${mins % 60}分`;
    const days = Math.floor(hours / 24);
    return `${days}日${hours % 24}時間`;
}

function getExitColor(reason: string): string {
    switch (reason) {
        case "take_profit": return COLORS.winExit;
        case "stop_loss": return COLORS.lossExit;
        case "timeout": return COLORS.timeoutExit;
        case "signal": return COLORS.signalExit;
        default: return COLORS.timeoutExit;
    }
}

// ========================================
// ストラテジー条件からインジケーターを抽出
// ========================================

function extractIndicatorsFromConditions(
    conditions: ConditionGroup
): ExtractedIndicator[] {
    const seen = new Set<string>();
    const result: ExtractedIndicator[] = [];

    function visit(node: ConditionGroup | IndicatorCondition) {
        // ConditionGroup の場合は再帰
        if ("conditions" in node) {
            for (const child of node.conditions) {
                visit(child as ConditionGroup | IndicatorCondition);
            }
            return;
        }

        // IndicatorCondition の場合
        const cond = node as IndicatorCondition;
        const key = `${cond.indicatorId}:${JSON.stringify(cond.params)}`;
        if (!seen.has(key)) {
            seen.add(key);
            result.push({
                indicatorId: cond.indicatorId,
                params: cond.params,
                key,
            });
        }

        // 比較対象が別のインジケーターの場合も抽出
        if (cond.compareTarget?.type === "indicator") {
            const target = cond.compareTarget;
            const targetKey = `${target.indicatorId}:${JSON.stringify(target.params)}`;
            if (!seen.has(targetKey)) {
                seen.add(targetKey);
                result.push({
                    indicatorId: target.indicatorId,
                    params: target.params,
                    key: targetKey,
                });
            }
        }
    }

    visit(conditions);
    return result;
}

// ========================================
// トレード → マーカー変換
// ========================================

function tradesToMarkers(
    trades: BacktestTradeEvent[],
    selectedIndex: number | null
): ChartMarker[] {
    const markers: ChartMarker[] = [];

    trades.forEach((trade, idx) => {
        const isSelected = idx === selectedIndex;
        const entryTs = new Date(trade.entryTime).getTime();
        const exitTs = new Date(trade.exitTime).getTime();

        // エントリーマーカー
        markers.push({
            timestamp: entryTs,
            position: trade.side === "buy" ? "belowBar" : "aboveBar",
            color: isSelected ? COLORS.selected : (trade.side === "buy" ? COLORS.buyEntry : COLORS.sellEntry),
            shape: trade.side === "buy" ? "arrowUp" : "arrowDown",
            text: isSelected ? `#${idx + 1} Entry` : `#${idx + 1}`,
        });

        // イグジットマーカー
        markers.push({
            timestamp: exitTs,
            position: trade.side === "buy" ? "aboveBar" : "belowBar",
            color: isSelected ? COLORS.selected : getExitColor(trade.exitReason),
            shape: "circle",
            text: isSelected
                ? `#${idx + 1} Exit ${trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(2)}`
                : `#${idx + 1}`,
        });
    });

    // lightweight-charts requires markers sorted by time
    markers.sort((a, b) => a.timestamp - b.timestamp);
    return markers;
}

// ========================================
// トレード → TP/SL ライン（#No 付き）
// ========================================

function tradesToTpSlLines(
    trades: BacktestTradeEvent[],
    strategy: Strategy,
    selectedIndex: number | null
): DrawnLine[] {
    const lines: DrawnLine[] = [];
    const exitSettings = strategy.currentVersion?.exitSettings;
    if (!exitSettings) return lines;

    const tp = exitSettings.takeProfit;
    const sl = exitSettings.stopLoss;

    // 選択中のトレードのみ TP/SL を表示（全体表示のときは非表示）
    const indicesToShow = selectedIndex !== null ? [selectedIndex] : [];

    indicesToShow.forEach((idx) => {
        const trade = trades[idx];
        if (!trade) return;

        const entryTs = new Date(trade.entryTime).getTime();
        const exitTs = new Date(trade.exitTime).getTime();
        const no = idx + 1;

        // TP price
        let tpPrice: number | null = null;
        let slPrice: number | null = null;

        if (tp.unit === "percent") {
            const factor = tp.value / 100;
            tpPrice = trade.side === "buy"
                ? trade.entryPrice * (1 + factor)
                : trade.entryPrice * (1 - factor);
        } else if (tp.unit === "pips") {
            const pipValue = strategy.symbol.includes("JPY") ? 0.01 : 0.0001;
            tpPrice = trade.side === "buy"
                ? trade.entryPrice + tp.value * pipValue
                : trade.entryPrice - tp.value * pipValue;
        }

        if (sl.unit === "percent") {
            const factor = sl.value / 100;
            slPrice = trade.side === "buy"
                ? trade.entryPrice * (1 - factor)
                : trade.entryPrice * (1 + factor);
        } else if (sl.unit === "pips") {
            const pipValue = strategy.symbol.includes("JPY") ? 0.01 : 0.0001;
            slPrice = trade.side === "buy"
                ? trade.entryPrice - sl.value * pipValue
                : trade.entryPrice + sl.value * pipValue;
        }

        // Entry price line
        lines.push({
            id: `entry-${no}`,
            type: "horizontal" as const,
            price: trade.entryPrice,
            startTime: entryTs,
            endTime: exitTs,
            color: "#60a5fa",  // blue
            lineWidth: 1,
        });

        if (tpPrice !== null) {
            lines.push({
                id: `tp-${no}`,
                type: "horizontal" as const,
                price: tpPrice,
                startTime: entryTs,
                endTime: exitTs,
                color: COLORS.tp,
                lineWidth: 1,
            });
        }

        if (slPrice !== null) {
            lines.push({
                id: `sl-${no}`,
                type: "horizontal" as const,
                price: slPrice,
                startTime: entryTs,
                endTime: exitTs,
                color: COLORS.sl,
                lineWidth: 1,
            });
        }
    });

    return lines;
}

// ========================================
// メインコンポーネント
// ========================================

export default function BacktestChartTab({ result, strategy }: BacktestChartTabProps) {
    const [ohlcvData, setOhlcvData] = useState<OHLCVDataPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedTradeIndex, setSelectedTradeIndex] = useState<number | null>(null);
    const [showIndicators, setShowIndicators] = useState(true);

    const trades = result.trades;
    const symbol = result.symbol || strategy.symbol;

    // ストラテジーで使用されたインジケーターを抽出
    const strategyIndicators = useMemo(() => {
        const conditions = strategy.currentVersion?.entryConditions;
        if (!conditions) return [];
        return extractIndicatorsFromConditions(conditions);
    }, [strategy]);

    // OHLCV データ取得
    useEffect(() => {
        let cancelled = false;

        async function loadData() {
            setLoading(true);
            setError(null);

            try {
                const data = await fetchOhlcvCandles({
                    symbol,
                    timeframe: result.timeframe,
                    startDate: result.startDate,
                    endDate: result.endDate,
                });

                if (!cancelled) {
                    setOhlcvData(data);
                    if (trades.length > 0) {
                        setSelectedTradeIndex(0);
                    }
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "OHLCVデータの取得に失敗しました");
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        loadData();
        return () => { cancelled = true; };
    }, [result.startDate, result.endDate, result.timeframe, symbol, trades.length]);

    // マーカー生成
    const markers = useMemo(
        () => tradesToMarkers(trades, selectedTradeIndex),
        [trades, selectedTradeIndex]
    );

    // 選択中トレードの TP/SL ライン（#No 付き）
    const drawnLines = useMemo<DrawnLine[]>(
        () => tradesToTpSlLines(trades, strategy, selectedTradeIndex),
        [trades, strategy, selectedTradeIndex]
    );

    // ストラテジーインジケーターをチャート用に計算
    const indicators = useMemo<IndicatorLineConfig[]>(() => {
        if (!showIndicators || ohlcvData.length === 0 || strategyIndicators.length === 0) return [];

        const configs: IndicatorLineConfig[] = [];
        for (const ind of strategyIndicators) {
            try {
                const paramsObj: Record<string, number> = {};
                for (const [k, v] of Object.entries(ind.params)) {
                    if (typeof v === "number") paramsObj[k] = v;
                }
                const chartConfigs = indicatorToChartConfigs(ind.indicatorId, ohlcvData, paramsObj);
                configs.push(...chartConfigs);
            } catch (err) {
                console.warn(`[BacktestChartTab] インジケーター計算エラー (${ind.indicatorId}):`, err);
            }
        }
        return configs;
    }, [showIndicators, ohlcvData, strategyIndicators]);

    // ナビゲーション
    const goToTrade = useCallback((index: number) => {
        if (index < 0 || index >= trades.length) return;
        setSelectedTradeIndex(index);
    }, [trades.length]);

    const goPrev = useCallback(() => {
        if (selectedTradeIndex === null) return;
        goToTrade(selectedTradeIndex - 1);
    }, [selectedTradeIndex, goToTrade]);

    const goNext = useCallback(() => {
        if (selectedTradeIndex === null) return;
        goToTrade(selectedTradeIndex + 1);
    }, [selectedTradeIndex, goToTrade]);

    // 選択中のトレード
    const selectedTrade = selectedTradeIndex !== null ? trades[selectedTradeIndex] : null;

    // 選択中トレードのエントリータイムスタンプ（チャートスクロール用）
    const focusTimestamp = useMemo(() => {
        if (!selectedTrade) return null;
        return new Date(selectedTrade.entryTime).getTime();
    }, [selectedTrade]);

    // ========================================
    // レンダリング
    // ========================================

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400" />
                <p className="text-sm text-gray-400">チャートデータを読み込み中...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4">
                <p className="text-red-400 text-sm font-medium">チャートデータの取得に失敗しました</p>
                <p className="text-red-400/70 text-xs mt-1">{error}</p>
            </div>
        );
    }

    if (ohlcvData.length === 0) {
        return (
            <div className="bg-slate-800/50 rounded-lg p-6 text-center">
                <p className="text-gray-400 text-sm">この期間のOHLCVデータがありません。</p>
                <p className="text-gray-500 text-xs mt-1">バックテスト実行時にデータが取得されている必要があります。</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* ナビゲーションバー */}
            <div className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">トレード:</span>
                    <span className="text-sm font-medium text-white">
                        {selectedTradeIndex !== null ? `${selectedTradeIndex + 1} / ${trades.length}` : `全 ${trades.length} 件`}
                    </span>
                </div>

                <div className="flex items-center gap-1">
                    {/* インジケーター表示トグル */}
                    {strategyIndicators.length > 0 && (
                        <button
                            onClick={() => setShowIndicators(!showIndicators)}
                            className={`px-2 py-1 text-xs font-medium rounded transition-colors mr-2
                ${showIndicators
                                    ? "bg-purple-600/50 text-purple-300 border border-purple-500/50"
                                    : "bg-slate-700 text-gray-400 hover:bg-slate-600"}`}
                        >
                            📈 {showIndicators ? "ON" : "OFF"} ({strategyIndicators.length})
                        </button>
                    )}

                    <button
                        onClick={goPrev}
                        disabled={selectedTradeIndex === null || selectedTradeIndex <= 0}
                        className="px-2 py-1 text-xs font-medium rounded transition-colors
              bg-slate-700 text-gray-300 hover:bg-slate-600
              disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        ◀ 前
                    </button>
                    <button
                        onClick={goNext}
                        disabled={selectedTradeIndex === null || selectedTradeIndex >= trades.length - 1}
                        className="px-2 py-1 text-xs font-medium rounded transition-colors
              bg-slate-700 text-gray-300 hover:bg-slate-600
              disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        次 ▶
                    </button>
                    <button
                        onClick={() => setSelectedTradeIndex(null)}
                        className={`px-2 py-1 text-xs font-medium rounded transition-colors ml-1
              ${selectedTradeIndex === null
                                ? "bg-cyan-600 text-white"
                                : "bg-slate-700 text-gray-300 hover:bg-slate-600"}`}
                    >
                        全体
                    </button>
                </div>
            </div>

            {/* チャート */}
            <CandlestickChart
                ohlcvData={ohlcvData}
                markers={markers}
                drawnLines={drawnLines}
                indicators={indicators}
                height={500}
                symbol={symbol}
                timeframe={result.timeframe}
                title="バックテスト結果"
                focusTimestamp={focusTimestamp}
            />

            {/* 凡例 */}
            <div className="flex flex-wrap items-center gap-3 px-2 text-[11px] text-gray-400">
                <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.buyEntry }} />
                    Buy Entry
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.sellEntry }} />
                    Sell Entry
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.winExit }} />
                    TP
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.lossExit }} />
                    SL
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.timeoutExit }} />
                    Timeout
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.signalExit }} />
                    Signal
                </span>
                {showIndicators && strategyIndicators.length > 0 && (
                    <span className="flex items-center gap-1 ml-2 text-purple-400">
                        📈 ストラテジーインジケーター表示中
                    </span>
                )}
            </div>

            {/* 選択中トレード詳細 */}
            {selectedTrade && (
                <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-white flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${selectedTrade.side === "buy" ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"
                                }`}>
                                {selectedTrade.side.toUpperCase()}
                            </span>
                            トレード #{(selectedTradeIndex ?? 0) + 1}
                        </h4>
                        <span className={`text-sm font-mono font-bold ${selectedTrade.pnl >= 0 ? "text-green-400" : "text-red-400"
                            }`}>
                            {selectedTrade.pnl >= 0 ? "+" : ""}{selectedTrade.pnl.toFixed(2)}
                            <span className="text-[10px] text-gray-400 ml-1">
                                ({selectedTrade.pnlPercent >= 0 ? "+" : ""}{selectedTrade.pnlPercent.toFixed(2)}%)
                            </span>
                        </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div>
                            <span className="text-gray-500">エントリー</span>
                            <p className="text-gray-200 font-mono">{formatPrice(selectedTrade.entryPrice, symbol)}</p>
                            <p className="text-gray-500 text-[10px]">
                                {new Date(selectedTrade.entryTime).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </p>
                        </div>
                        <div>
                            <span className="text-gray-500">イグジット</span>
                            <p className="text-gray-200 font-mono">{formatPrice(selectedTrade.exitPrice, symbol)}</p>
                            <p className="text-gray-500 text-[10px]">
                                {new Date(selectedTrade.exitTime).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </p>
                        </div>
                        <div>
                            <span className="text-gray-500">決済理由</span>
                            <p className={`font-medium ${selectedTrade.exitReason === "take_profit" ? "text-green-400" :
                                selectedTrade.exitReason === "stop_loss" ? "text-red-400" :
                                    "text-yellow-400"
                                }`}>
                                {EXIT_REASON_LABELS[selectedTrade.exitReason] || selectedTrade.exitReason}
                            </p>
                        </div>
                        <div>
                            <span className="text-gray-500">保有時間</span>
                            <p className="text-gray-200">{formatDuration(selectedTrade.entryTime, selectedTrade.exitTime)}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* トレード一覧（クリックで選択） */}
            {trades.length > 0 && (
                <div className="bg-slate-800/30 rounded-lg overflow-hidden">
                    <div className="px-3 py-2 border-b border-slate-700/50">
                        <span className="text-xs font-medium text-gray-400">トレード一覧（クリックで選択）</span>
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                        {trades.map((trade, idx) => (
                            <button
                                key={trade.eventId}
                                onClick={() => goToTrade(idx)}
                                className={`w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors
                  ${idx === selectedTradeIndex
                                        ? "bg-cyan-900/30 border-l-2 border-cyan-400"
                                        : "hover:bg-slate-700/30 border-l-2 border-transparent"}`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-500 w-5 text-right font-mono">#{idx + 1}</span>
                                    <span className={`px-1 rounded text-[10px] font-bold ${trade.side === "buy" ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"
                                        }`}>
                                        {trade.side === "buy" ? "B" : "S"}
                                    </span>
                                    <span className="text-gray-400 font-mono">{formatPrice(trade.entryPrice, symbol)}</span>
                                    <span className="text-gray-600">→</span>
                                    <span className="text-gray-400 font-mono">{formatPrice(trade.exitPrice, symbol)}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`text-[10px] px-1 rounded ${trade.exitReason === "take_profit" ? "bg-green-900/30 text-green-400" :
                                        trade.exitReason === "stop_loss" ? "bg-red-900/30 text-red-400" :
                                            "bg-yellow-900/30 text-yellow-400"
                                        }`}>
                                        {EXIT_REASON_LABELS[trade.exitReason]?.slice(0, 2) || "?"}
                                    </span>
                                    <span className={`font-mono font-medium ${trade.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                                        {trade.pnl >= 0 ? "+" : ""}{trade.pnl.toFixed(2)}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
