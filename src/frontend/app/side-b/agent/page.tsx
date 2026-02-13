/**
 * AI Agent 詳細ページ
 *
 * エージェントの詳細状態、全思考ログ、メモリ内容を表示
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "") + "/api/side-b";

interface ThinkingLogEntry {
    timestamp: string;
    cycle: number;
    state: string;
    action: string;
    reasoning: string;
    data?: Record<string, unknown>;
}

interface LessonsData {
    lessons: string[];
    count: number;
    stats: {
        winRate: number;
        totalTrades: number;
        wins: number;
        losses: number;
    };
}

const stateColors: Record<string, string> = {
    IDLE: "text-gray-400 bg-gray-500/20",
    SESSION_OPEN: "text-yellow-400 bg-yellow-500/20",
    MONITORING: "text-green-400 bg-green-500/20",
    EVALUATING_ENTRY: "text-blue-400 bg-blue-500/20",
    MANAGING_POSITION: "text-purple-400 bg-purple-500/20",
    REFLECTING: "text-cyan-400 bg-cyan-500/20",
    REVISING_STRATEGY: "text-orange-400 bg-orange-500/20",
};

export default function AgentDetailPage() {
    const [thinkingLog, setThinkingLog] = useState<ThinkingLogEntry[]>([]);
    const [lessonsData, setLessonsData] = useState<LessonsData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [logLimit, setLogLimit] = useState(50);

    const fetchData = useCallback(async () => {
        try {
            const [logRes, lessonsRes] = await Promise.allSettled([
                fetch(`${API_BASE}/agent/thinking-log?limit=${logLimit}`),
                fetch(`${API_BASE}/agent/lessons`),
            ]);

            if (logRes.status === "fulfilled" && logRes.value.ok) {
                const data = await logRes.value.json();
                setThinkingLog(data.log || []);
            }
            if (lessonsRes.status === "fulfilled" && lessonsRes.value.ok) {
                setLessonsData(await lessonsRes.value.json());
            }
        } catch (err) {
            console.error("[Agent] fetch error:", err);
        } finally {
            setIsLoading(false);
        }
    }, [logLimit]);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10_000);
        return () => clearInterval(interval);
    }, [fetchData]);

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen">
            <main className="max-w-5xl w-full mx-auto px-3 sm:px-4 md:px-6 py-6 sm:py-8">
                {/* ヘッダー */}
                <div className="flex items-center gap-3 mb-6">
                    <Link
                        href="/side-b"
                        className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors"
                    >
                        ← Dashboard
                    </Link>
                    <span className="text-gray-600">|</span>
                    <h1 className="text-xl font-bold text-white">AI Agent 詳細</h1>
                </div>

                {/* 統計カード */}
                {lessonsData && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                        <div className="card-surface rounded-xl p-4 text-center">
                            <p className="text-xs text-gray-500">勝率</p>
                            <p className={`text-2xl font-bold ${lessonsData.stats.winRate >= 50 ? "text-green-400" : "text-red-400"}`}>
                                {Math.round(lessonsData.stats.winRate)}%
                            </p>
                        </div>
                        <div className="card-surface rounded-xl p-4 text-center">
                            <p className="text-xs text-gray-500">総トレード</p>
                            <p className="text-2xl font-bold text-white">{lessonsData.stats.totalTrades}</p>
                        </div>
                        <div className="card-surface rounded-xl p-4 text-center">
                            <p className="text-xs text-gray-500">勝ち</p>
                            <p className="text-2xl font-bold text-green-400">{lessonsData.stats.wins}</p>
                        </div>
                        <div className="card-surface rounded-xl p-4 text-center">
                            <p className="text-xs text-gray-500">負け</p>
                            <p className="text-2xl font-bold text-red-400">{lessonsData.stats.losses}</p>
                        </div>
                    </div>
                )}

                {/* 学び一覧 */}
                {lessonsData && lessonsData.lessons.length > 0 && (
                    <div className="card-surface rounded-xl overflow-hidden mb-6">
                        <div className="px-4 py-3 border-b border-slate-700/50">
                            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                                <span>💡</span> AI の学び ({lessonsData.count})
                            </h2>
                        </div>
                        <div className="px-4 py-3 space-y-2 max-h-60 overflow-y-auto">
                            {lessonsData.lessons.map((lesson, idx) => (
                                <div
                                    key={idx}
                                    className="flex items-start gap-2 px-3 py-2 rounded-lg bg-cyan-500/5 border border-cyan-500/10"
                                >
                                    <span className="text-cyan-400 text-xs mt-0.5 shrink-0">{idx + 1}.</span>
                                    <p className="text-xs text-gray-300">{lesson}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 全思考ログ */}
                <div className="card-surface rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
                        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                            <span>🧠</span> 思考ログ ({thinkingLog.length})
                        </h2>
                        <div className="flex items-center gap-2">
                            <select
                                value={logLimit}
                                onChange={(e) => setLogLimit(Number(e.target.value))}
                                className="bg-slate-700 text-xs text-gray-300 rounded px-2 py-1 border-0"
                            >
                                <option value={20}>20件</option>
                                <option value={50}>50件</option>
                                <option value={100}>100件</option>
                            </select>
                            <button
                                onClick={fetchData}
                                className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                            >
                                更新
                            </button>
                        </div>
                    </div>
                    <div className="max-h-[600px] overflow-y-auto divide-y divide-slate-700/30">
                        {thinkingLog.length === 0 ? (
                            <div className="px-4 py-12 text-center">
                                <p className="text-sm text-gray-500">思考ログがありません</p>
                            </div>
                        ) : (
                            thinkingLog.map((entry, idx) => {
                                const colorClass = stateColors[entry.state] || "text-gray-400 bg-gray-500/20";
                                return (
                                    <div key={idx} className="px-4 py-3 hover:bg-slate-700/20 transition-colors">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${colorClass}`}>
                                                {entry.state}
                                            </span>
                                            <span className="text-[10px] text-gray-500 font-mono">
                                                #{entry.cycle} •{" "}
                                                {new Date(entry.timestamp).toLocaleString("ja-JP", {
                                                    month: "2-digit",
                                                    day: "2-digit",
                                                    hour: "2-digit",
                                                    minute: "2-digit",
                                                    second: "2-digit",
                                                })}
                                            </span>
                                        </div>
                                        <p className="text-sm text-white font-medium">{entry.action}</p>
                                        {entry.reasoning && (
                                            <p className="text-xs text-gray-400 mt-1">{entry.reasoning}</p>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
