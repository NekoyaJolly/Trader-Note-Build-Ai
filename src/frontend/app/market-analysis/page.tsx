'use client';

/**
 * マーケット分析ページ
 * 
 * 目的:
 * - XAUUSDなどのOHLCVデータをリアルタイム取得
 * - ローソク足チャート表示
 * - 12次元特徴量でマーケット状態を可視化
 */

import React, { useState, useCallback } from 'react';
import { CandlestickChart, OHLCVDataPoint } from '@/components/CandlestickChart';

// 12次元特徴量の詳細型
interface FeatureDetail {
    index: number;
    name: string;
    description: string;
    value: number;
    displayValue: string;
}

// API レスポンス型
interface MarketAnalysisData {
    symbol: string;
    timeframe: string;
    timestamp: string;
    ohlcv: Array<{
        timestamp: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
    }>;
    latestPrice: {
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
    };
    indicators: {
        rsi: number;
        macdHistogram: number;
        sma20: number;
        bbUpper: number;
        bbMiddle: number;
        bbLower: number;
    };
    featureVector: {
        raw: number[];
        detailed: FeatureDetail[];
    };
    marketCondition: string;
    meta: {
        dataPoints: number;
        analysisTime: string;
    };
}

// シンボル選択肢
const SYMBOLS = [
    { value: 'XAUUSD', label: 'XAU/USD (ゴールド)' },
    { value: 'EURUSD', label: 'EUR/USD' },
    { value: 'USDJPY', label: 'USD/JPY' },
    { value: 'GBPUSD', label: 'GBP/USD' },
];

// 特徴量の色分け
function getFeatureColor(value: number, index: number): string {
    // RSI系（5, 6）は反転表示（高い = 買われすぎで注意）
    if (index === 5 || index === 6) {
        if (value >= 0.7) return 'bg-red-500';
        if (value <= 0.3) return 'bg-green-500';
        return 'bg-yellow-500';
    }

    // トレンド方向（0）は-1〜1なので特別処理
    if (index === 0) {
        if (value > 0.3) return 'bg-green-500';
        if (value < -0.3) return 'bg-red-500';
        return 'bg-yellow-500';
    }

    // 通常は0〜1で、高いほど強い
    if (value >= 0.7) return 'bg-green-500';
    if (value <= 0.3) return 'bg-red-500';
    return 'bg-yellow-500';
}

export default function MarketAnalysisPage() {
    const [selectedSymbol, setSelectedSymbol] = useState('XAUUSD');
    const [analysisData, setAnalysisData] = useState<MarketAnalysisData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // データ取得
    const fetchAnalysis = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';
            const response = await fetch(
                `${apiBase}/api/market-analysis/${selectedSymbol}?timeframe=1m&count=60`
            );

            if (!response.ok) {
                throw new Error(`APIエラー: ${response.status}`);
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'データ取得に失敗しました');
            }

            setAnalysisData(result.data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'エラーが発生しました');
        } finally {
            setLoading(false);
        }
    }, [selectedSymbol]);

    // OHLCVデータをチャート用に変換
    const chartData: OHLCVDataPoint[] = analysisData?.ohlcv.map(d => ({
        timestamp: new Date(d.timestamp).getTime(),
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume,
    })) || [];

    return (
        <div className="min-h-screen bg-gray-900 text-white p-6">
            {/* ヘッダー */}
            <div className="mb-6">
                <h1 className="text-3xl font-bold mb-2">📊 マーケット分析</h1>
                <p className="text-gray-400">
                    リアルタイムOHLCVデータと12次元特徴量による市場状態分析
                </p>
            </div>

            {/* コントロールパネル */}
            <div className="bg-gray-800 rounded-lg p-4 mb-6 flex flex-wrap gap-4 items-center">
                <div>
                    <label className="block text-sm text-gray-400 mb-1">シンボル</label>
                    <select
                        value={selectedSymbol}
                        onChange={(e) => setSelectedSymbol(e.target.value)}
                        className="bg-gray-700 text-white rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        {SYMBOLS.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                    </select>
                </div>

                <div className="flex-1" />

                <button
                    onClick={fetchAnalysis}
                    disabled={loading}
                    className={`px-6 py-2 rounded-lg font-semibold transition ${loading
                        ? 'bg-gray-600 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                >
                    {loading ? '取得中...' : '📥 データ取得'}
                </button>
            </div>

            {/* エラー表示 */}
            {error && (
                <div className="bg-red-900/50 border border-red-500 rounded-lg p-4 mb-6">
                    <p className="text-red-300">⚠️ {error}</p>
                </div>
            )}

            {/* メインコンテンツ */}
            {analysisData && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* 左カラム: チャート */}
                    <div className="lg:col-span-2">
                        <div className="bg-gray-800 rounded-lg p-4">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-semibold">
                                    {analysisData.symbol} - 1分足 ({analysisData.meta.dataPoints}本)
                                </h2>
                                <span className="text-gray-400 text-sm">
                                    {new Date(analysisData.timestamp).toLocaleString('ja-JP')}
                                </span>
                            </div>

                            <div className="h-[400px]">
                                <CandlestickChart
                                    ohlcvData={chartData}
                                    height={380}
                                />
                            </div>

                            {/* 価格情報 */}
                            <div className="mt-4 grid grid-cols-4 gap-4 text-center">
                                <div className="bg-gray-700 rounded p-2">
                                    <div className="text-gray-400 text-xs">始値</div>
                                    <div className="font-mono">{analysisData.latestPrice.open.toFixed(2)}</div>
                                </div>
                                <div className="bg-gray-700 rounded p-2">
                                    <div className="text-gray-400 text-xs">高値</div>
                                    <div className="font-mono text-green-400">{analysisData.latestPrice.high.toFixed(2)}</div>
                                </div>
                                <div className="bg-gray-700 rounded p-2">
                                    <div className="text-gray-400 text-xs">安値</div>
                                    <div className="font-mono text-red-400">{analysisData.latestPrice.low.toFixed(2)}</div>
                                </div>
                                <div className="bg-gray-700 rounded p-2">
                                    <div className="text-gray-400 text-xs">終値</div>
                                    <div className="font-mono">{analysisData.latestPrice.close.toFixed(2)}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 右カラム: 特徴量 */}
                    <div className="space-y-6">
                        {/* 市場状態 */}
                        <div className="bg-gray-800 rounded-lg p-4">
                            <h2 className="text-xl font-semibold mb-3">🎯 市場状態</h2>
                            <div className="text-2xl font-bold text-center py-4 bg-gray-700 rounded-lg">
                                {analysisData.marketCondition}
                            </div>
                        </div>

                        {/* インジケーター */}
                        <div className="bg-gray-800 rounded-lg p-4">
                            <h2 className="text-xl font-semibold mb-3">📈 インジケーター</h2>
                            <div className="space-y-2">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">RSI(14)</span>
                                    <span className={`font-mono ${analysisData.indicators.rsi >= 70 ? 'text-red-400' :
                                        analysisData.indicators.rsi <= 30 ? 'text-green-400' : ''
                                        }`}>
                                        {analysisData.indicators.rsi.toFixed(1)}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">MACDヒスト</span>
                                    <span className={`font-mono ${analysisData.indicators.macdHistogram > 0 ? 'text-green-400' : 'text-red-400'
                                        }`}>
                                        {analysisData.indicators.macdHistogram.toFixed(4)}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">SMA(20)</span>
                                    <span className="font-mono">{analysisData.indicators.sma20.toFixed(2)}</span>
                                </div>
                            </div>
                        </div>

                        {/* 12次元特徴量 */}
                        <div className="bg-gray-800 rounded-lg p-4">
                            <h2 className="text-xl font-semibold mb-3">🧬 12次元特徴量</h2>
                            <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                {analysisData.featureVector.detailed.map((feature) => (
                                    <div key={feature.index} className="bg-gray-700 rounded p-2">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-sm flex items-center gap-1">
                                                {feature.name}
                                                <span
                                                    className="text-gray-400 cursor-help relative group"
                                                    title={feature.description}
                                                >
                                                    ⓘ
                                                    {/* ツールチップ */}
                                                    <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-2 py-1 bg-gray-900 text-gray-200 text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg border border-gray-600">
                                                        {feature.description}
                                                    </span>
                                                </span>
                                            </span>
                                            <span className="font-mono text-sm">{feature.displayValue}</span>
                                        </div>
                                        <div className="w-full bg-gray-600 rounded-full h-2">
                                            <div
                                                className={`h-2 rounded-full ${getFeatureColor(feature.value, feature.index)}`}
                                                style={{
                                                    width: `${Math.abs(feature.value) * 100}%`,
                                                    marginLeft: feature.index === 0 && feature.value < 0 ? 'auto' : 0,
                                                }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 初期表示 */}
            {!analysisData && !loading && !error && (
                <div className="text-center py-20">
                    <div className="text-6xl mb-4">📊</div>
                    <p className="text-gray-400 text-lg">
                        シンボルを選択して「データ取得」ボタンをクリックしてください
                    </p>
                </div>
            )}
        </div>
    );
}
