"use client";

/**
 * ノートバックテストタブ
 * 
 * 目的:
 * - 承認済みノートを選択してバックテストを実行
 * - 12次元特徴量ベースでノートの優位性を検証
 * 
 * ストラテジーバックテストページに統合される
 */

import React, { useState, useEffect, useCallback } from "react";
import {
    fetchNotes,
    executeBacktest,
    fetchBacktestResult,
    type NoteSummary,
    type BacktestSummary,
    type BacktestExecuteParams,
} from "@/lib/api";

// ============================================
// 型定義
// ============================================

interface NoteBacktestTabProps {
    /** ストラテジーのシンボル（フィルタ用） */
    symbol: string;
}

/** ソートキー */
type SortKey = "createdAt" | "symbol" | "side";

/** ソート順 */
type SortOrder = "asc" | "desc";

// ============================================
// ヘルパー関数
// ============================================

function getDefaultStartDate(): string {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date.toISOString().split("T")[0];
}

function getDefaultEndDate(): string {
    return new Date().toISOString().split("T")[0];
}

// ============================================
// サブコンポーネント
// ============================================

/** ノートリストアイテム */
function NoteListItem({
    note,
    isSelected,
    onClick,
}: {
    note: NoteSummary;
    isSelected: boolean;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className={`w-full text-left p-3 rounded-lg border transition-all ${isSelected
                    ? "bg-cyan-600/20 border-cyan-500"
                    : "bg-slate-700/30 border-slate-600/50 hover:border-cyan-500/30"
                }`}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${note.side === "buy"
                                ? "bg-green-600/30 text-green-400"
                                : "bg-red-600/30 text-red-400"
                            }`}
                    >
                        {note.side === "buy" ? "買い" : "売り"}
                    </span>
                    <span className="font-medium text-white">{note.symbol}</span>
                </div>
                <span className="text-xs text-gray-400">
                    {new Date(note.createdAt).toLocaleDateString("ja-JP")}
                </span>
            </div>
            {note.aiSummary && (
                <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                    {note.aiSummary}
                </p>
            )}
        </button>
    );
}

/** バックテスト結果表示 */
function BacktestResultCard({ result }: { result: BacktestSummary }) {
    const getColorByValue = (value: number, threshold: number) =>
        value >= threshold ? "text-green-400" : "text-red-400";

    return (
        <div className="space-y-4">
            {/* サマリー */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-700/50 rounded p-3">
                    <div className="text-xs text-gray-400">セットアップ数</div>
                    <div className="text-lg font-bold text-white">{result.setupCount}</div>
                </div>
                <div className="bg-slate-700/50 rounded p-3">
                    <div className="text-xs text-gray-400">勝率</div>
                    <div className={`text-lg font-bold ${getColorByValue(result.winRate, 0.5)}`}>
                        {(result.winRate * 100).toFixed(1)}%
                    </div>
                </div>
                <div className="bg-slate-700/50 rounded p-3">
                    <div className="text-xs text-gray-400">PF</div>
                    <div className={`text-lg font-bold ${result.profitFactor && result.profitFactor >= 1 ? "text-green-400" : "text-red-400"}`}>
                        {result.profitFactor?.toFixed(2) ?? "-"}
                    </div>
                </div>
                <div className="bg-slate-700/50 rounded p-3">
                    <div className="text-xs text-gray-400">期待値</div>
                    <div className={`text-lg font-bold ${getColorByValue(result.expectancy, 0)}`}>
                        {result.expectancy >= 0 ? "+" : ""}
                        {result.expectancy.toFixed(2)}%
                    </div>
                </div>
            </div>

            {/* 詳細指標 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-700/30 rounded p-2">
                    <div className="text-xs text-gray-500">勝ち</div>
                    <div className="text-green-400">{result.winCount}</div>
                </div>
                <div className="bg-slate-700/30 rounded p-2">
                    <div className="text-xs text-gray-500">負け</div>
                    <div className="text-red-400">{result.lossCount}</div>
                </div>
                <div className="bg-slate-700/30 rounded p-2">
                    <div className="text-xs text-gray-500">タイムアウト</div>
                    <div className="text-gray-400">{result.timeoutCount}</div>
                </div>
                <div className="bg-slate-700/30 rounded p-2">
                    <div className="text-xs text-gray-500">平均損益</div>
                    <div className={result.averagePnL >= 0 ? "text-green-400" : "text-red-400"}>
                        {result.averagePnL >= 0 ? "+" : ""}{result.averagePnL.toFixed(2)}%
                    </div>
                </div>
            </div>

            {/* トレード一覧 */}
            {result.events && result.events.length > 0 && (
                <div className="mt-4">
                    <h4 className="text-sm font-medium text-gray-300 mb-2">
                        トレード詳細 ({result.events.length}件)
                    </h4>
                    <div className="overflow-x-auto max-h-64">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-700/50 text-gray-400 sticky top-0">
                                <tr>
                                    <th className="px-2 py-1 text-left">エントリー</th>
                                    <th className="px-2 py-1 text-right">価格</th>
                                    <th className="px-2 py-1 text-right">スコア</th>
                                    <th className="px-2 py-1 text-center">結果</th>
                                    <th className="px-2 py-1 text-right">損益</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/50">
                                {result.events.map((event, idx) => (
                                    <tr key={idx} className="hover:bg-slate-700/30">
                                        <td className="px-2 py-1 text-gray-300">
                                            {new Date(event.entryTime).toLocaleString("ja-JP", {
                                                month: "numeric",
                                                day: "numeric",
                                                hour: "2-digit",
                                                minute: "2-digit",
                                            })}
                                        </td>
                                        <td className="px-2 py-1 text-right text-gray-300">
                                            {event.entryPrice.toLocaleString()}
                                        </td>
                                        <td className="px-2 py-1 text-right text-cyan-400">
                                            {(event.matchScore * 100).toFixed(0)}%
                                        </td>
                                        <td className="px-2 py-1 text-center">
                                            <span
                                                className={`px-1.5 py-0.5 rounded text-xs ${event.outcome === "win"
                                                        ? "bg-green-600/30 text-green-400"
                                                        : event.outcome === "loss"
                                                            ? "bg-red-600/30 text-red-400"
                                                            : "bg-gray-600/30 text-gray-400"
                                                    }`}
                                            >
                                                {event.outcome === "win" ? "勝" : event.outcome === "loss" ? "負" : "TO"}
                                            </span>
                                        </td>
                                        <td
                                            className={`px-2 py-1 text-right ${(event.pnl ?? 0) >= 0 ? "text-green-400" : "text-red-400"
                                                }`}
                                        >
                                            {event.pnl !== null ? `${event.pnl >= 0 ? "+" : ""}${event.pnl.toFixed(2)}%` : "-"}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================
// メインコンポーネント
// ============================================

export function NoteBacktestTab({ symbol }: NoteBacktestTabProps) {
    // ノート一覧
    const [notes, setNotes] = useState<NoteSummary[]>([]);
    const [loadingNotes, setLoadingNotes] = useState(true);
    const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

    // ソート・フィルタ
    const [sortKey, setSortKey] = useState<SortKey>("createdAt");
    const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
    const [filterSymbol, setFilterSymbol] = useState<string>("all");
    const [filterSide, setFilterSide] = useState<"all" | "buy" | "sell">("all");

    // バックテストパラメータ
    const [params, setParams] = useState({
        startDate: getDefaultStartDate(),
        endDate: getDefaultEndDate(),
        timeframe: "1h",
        matchThreshold: 0.8,
        takeProfit: 1.0,
        stopLoss: 0.5,
        maxHoldingMinutes: 240,
    });

    // バックテスト状態
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<BacktestSummary | null>(null);
    const [error, setError] = useState<string | null>(null);

    // ============================================
    // データ取得
    // ============================================

    const loadNotes = useCallback(async () => {
        try {
            setLoadingNotes(true);
            const { notes: fetchedNotes } = await fetchNotes({ status: "active" });
            setNotes(fetchedNotes);
        } catch (err) {
            console.error("ノート取得エラー:", err);
        } finally {
            setLoadingNotes(false);
        }
    }, []);

    useEffect(() => {
        loadNotes();
    }, [loadNotes]);

    // ============================================
    // フィルタ・ソート処理
    // ============================================

    const filteredAndSortedNotes = React.useMemo(() => {
        let result = [...notes];

        // フィルタ
        if (filterSymbol !== "all") {
            result = result.filter((n) => n.symbol === filterSymbol);
        }
        if (filterSide !== "all") {
            result = result.filter((n) => n.side === filterSide);
        }

        // ソート
        result.sort((a, b) => {
            let comparison = 0;
            switch (sortKey) {
                case "createdAt":
                    comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                    break;
                case "symbol":
                    comparison = a.symbol.localeCompare(b.symbol);
                    break;
                case "side":
                    comparison = a.side.localeCompare(b.side);
                    break;
            }
            return sortOrder === "asc" ? comparison : -comparison;
        });

        return result;
    }, [notes, filterSymbol, filterSide, sortKey, sortOrder]);

    // 利用可能なシンボルのリスト
    const availableSymbols = React.useMemo(() => {
        const symbols = new Set(notes.map((n) => n.symbol));
        return Array.from(symbols).sort();
    }, [notes]);

    // ============================================
    // バックテスト実行
    // ============================================

    const handleRunBacktest = async () => {
        if (!selectedNoteId) {
            setError("ノートを選択してください");
            return;
        }

        try {
            setRunning(true);
            setError(null);
            setResult(null);

            const executeParams: BacktestExecuteParams = {
                noteId: selectedNoteId,
                startDate: params.startDate,
                endDate: params.endDate,
                timeframe: params.timeframe,
                matchThreshold: params.matchThreshold,
                takeProfit: params.takeProfit,
                stopLoss: params.stopLoss,
                maxHoldingMinutes: params.maxHoldingMinutes,
            };

            const { runId } = await executeBacktest(executeParams);

            // ポーリングで結果を取得
            let attempts = 0;
            const maxAttempts = 60;
            const pollInterval = 2000;

            const poll = async () => {
                const resultData = await fetchBacktestResult(runId);
                if (resultData && resultData.status === "completed") {
                    setResult(resultData);
                    setRunning(false);
                    return;
                }
                if (resultData && resultData.status === "failed") {
                    setError("バックテストが失敗しました");
                    setRunning(false);
                    return;
                }
                attempts++;
                if (attempts >= maxAttempts) {
                    setError("バックテストがタイムアウトしました");
                    setRunning(false);
                    return;
                }
                setTimeout(poll, pollInterval);
            };

            poll();
        } catch (err) {
            const message = err instanceof Error ? err.message : "バックテストの実行に失敗しました";
            setError(message);
            setRunning(false);
        }
    };

    // ============================================
    // レンダリング
    // ============================================

    const selectedNote = notes.find((n) => n.id === selectedNoteId);

    return (
        <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* 左カラム: ノート選択 */}
                <div className="lg:col-span-1 space-y-3">
                    <h3 className="text-sm font-semibold text-white">承認済みノート</h3>

                    {/* フィルタ・ソート */}
                    <div className="flex flex-wrap gap-2 text-xs">
                        <select
                            value={filterSymbol}
                            onChange={(e) => setFilterSymbol(e.target.value)}
                            className="bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1 text-white"
                        >
                            <option value="all">全シンボル</option>
                            {availableSymbols.map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </select>
                        <select
                            value={filterSide}
                            onChange={(e) => setFilterSide(e.target.value as "all" | "buy" | "sell")}
                            className="bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1 text-white"
                        >
                            <option value="all">全方向</option>
                            <option value="buy">買い</option>
                            <option value="sell">売り</option>
                        </select>
                        <select
                            value={`${sortKey}-${sortOrder}`}
                            onChange={(e) => {
                                const [key, order] = e.target.value.split("-") as [SortKey, SortOrder];
                                setSortKey(key);
                                setSortOrder(order);
                            }}
                            className="bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1 text-white"
                        >
                            <option value="createdAt-desc">作成日（新しい順）</option>
                            <option value="createdAt-asc">作成日（古い順）</option>
                            <option value="symbol-asc">シンボル（A→Z）</option>
                            <option value="symbol-desc">シンボル（Z→A）</option>
                        </select>
                    </div>

                    {/* ノートリスト */}
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                        {loadingNotes ? (
                            <div className="text-center text-gray-400 py-8">読み込み中...</div>
                        ) : filteredAndSortedNotes.length === 0 ? (
                            <div className="text-center text-gray-400 py-8">
                                承認済みノートがありません
                            </div>
                        ) : (
                            filteredAndSortedNotes.map((note) => (
                                <NoteListItem
                                    key={note.id}
                                    note={note}
                                    isSelected={note.id === selectedNoteId}
                                    onClick={() => setSelectedNoteId(note.id)}
                                />
                            ))
                        )}
                    </div>
                </div>

                {/* 中央カラム: パラメータ設定 */}
                <div className="lg:col-span-1 space-y-3">
                    <h3 className="text-sm font-semibold text-white">バックテスト設定</h3>

                    {selectedNote ? (
                        <div className="bg-cyan-600/10 border border-cyan-500/30 rounded p-3 mb-3">
                            <div className="text-xs text-gray-400 mb-1">選択中のノート</div>
                            <div className="flex items-center gap-2">
                                <span
                                    className={`px-2 py-0.5 rounded text-xs ${selectedNote.side === "buy"
                                            ? "bg-green-600/30 text-green-400"
                                            : "bg-red-600/30 text-red-400"
                                        }`}
                                >
                                    {selectedNote.side === "buy" ? "買い" : "売り"}
                                </span>
                                <span className="font-medium text-white">{selectedNote.symbol}</span>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-slate-700/30 border border-slate-600/50 rounded p-3 text-center text-gray-400 text-sm">
                            左のリストからノートを選択してください
                        </div>
                    )}

                    {/* 期間設定 */}
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">開始日</label>
                            <input
                                type="date"
                                value={params.startDate}
                                onChange={(e) => setParams({ ...params, startDate: e.target.value })}
                                className="w-full bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1.5 text-sm text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">終了日</label>
                            <input
                                type="date"
                                value={params.endDate}
                                onChange={(e) => setParams({ ...params, endDate: e.target.value })}
                                className="w-full bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1.5 text-sm text-white"
                            />
                        </div>
                    </div>

                    {/* 時間足・閾値 */}
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">時間足</label>
                            <select
                                value={params.timeframe}
                                onChange={(e) => setParams({ ...params, timeframe: e.target.value })}
                                className="w-full bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1.5 text-sm text-white"
                            >
                                <option value="15m">15分</option>
                                <option value="30m">30分</option>
                                <option value="1h">1時間</option>
                                <option value="4h">4時間</option>
                                <option value="1d">日足</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">マッチ閾値</label>
                            <input
                                type="number"
                                min="0"
                                max="1"
                                step="0.05"
                                value={params.matchThreshold}
                                onChange={(e) => setParams({ ...params, matchThreshold: parseFloat(e.target.value) })}
                                className="w-full bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1.5 text-sm text-white"
                            />
                        </div>
                    </div>

                    {/* TP/SL */}
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">利確 (%)</label>
                            <input
                                type="number"
                                min="0.1"
                                step="0.1"
                                value={params.takeProfit}
                                onChange={(e) => setParams({ ...params, takeProfit: parseFloat(e.target.value) })}
                                className="w-full bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1.5 text-sm text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">損切 (%)</label>
                            <input
                                type="number"
                                min="0.1"
                                step="0.1"
                                value={params.stopLoss}
                                onChange={(e) => setParams({ ...params, stopLoss: parseFloat(e.target.value) })}
                                className="w-full bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1.5 text-sm text-white"
                            />
                        </div>
                    </div>

                    {/* 最大保有時間 */}
                    <div>
                        <label className="block text-xs text-gray-400 mb-1">最大保有時間 (分)</label>
                        <input
                            type="number"
                            min="0"
                            step="60"
                            value={params.maxHoldingMinutes}
                            onChange={(e) => setParams({ ...params, maxHoldingMinutes: parseInt(e.target.value) })}
                            className="w-full bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1.5 text-sm text-white"
                        />
                    </div>

                    {/* 実行ボタン */}
                    <button
                        onClick={handleRunBacktest}
                        disabled={!selectedNoteId || running}
                        className={`w-full py-2 rounded font-medium transition-all ${!selectedNoteId || running
                                ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                                : "bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20"
                            }`}
                    >
                        {running ? (
                            <span className="flex items-center justify-center gap-2">
                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                    <circle
                                        className="opacity-25"
                                        cx="12"
                                        cy="12"
                                        r="10"
                                        stroke="currentColor"
                                        strokeWidth="4"
                                        fill="none"
                                    />
                                    <path
                                        className="opacity-75"
                                        fill="currentColor"
                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                    />
                                </svg>
                                実行中...
                            </span>
                        ) : (
                            "ノートバックテスト実行"
                        )}
                    </button>
                </div>

                {/* 右カラム: 結果表示 */}
                <div className="lg:col-span-1 space-y-3">
                    <h3 className="text-sm font-semibold text-white">検証結果</h3>

                    {error && (
                        <div className="bg-red-600/20 border border-red-500/50 text-red-400 px-3 py-2 rounded text-sm">
                            {error}
                        </div>
                    )}

                    {result ? (
                        <BacktestResultCard result={result} />
                    ) : (
                        <div className="bg-slate-700/30 border border-slate-600/50 rounded p-8 text-center text-gray-400 text-sm">
                            ノートを選択してバックテストを実行してください
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default NoteBacktestTab;
