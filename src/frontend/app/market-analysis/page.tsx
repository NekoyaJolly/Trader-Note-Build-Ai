'use client';

/**
 * マーケット分析ページ
 * 
 * 目的:
 * - XAUUSDなどのOHLCVデータをリアルタイム取得
 * - ローソク足チャート表示
 * - 12次元特徴量でマーケット状態を可視化
 * - cTrader WebSocket によるリアルタイムチャート
 * - トレード情報モーダル表示
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { CandlestickChart, OHLCVDataPoint } from '@/components/CandlestickChart';
import { RealtimeChart } from '@/components/RealtimeChart';
import { NeonButton } from '@/components/ui/NeonButton';
import { IndicatorSelector, SelectedIndicator } from '@/components/IndicatorSelector';
import { indicatorToChartConfigs } from '@/lib/chartIndicators';
import { TradingModal } from '@/components/trading/TradingModal';
import { DataPresetModal, DataPreset } from '@/components/DataPresetModal';
import { apiFetch } from '@/lib/apiClient';

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

// 時間足選択肢
const TIMEFRAMES = [
    { value: '1m', label: '1分' },
    { value: '5m', label: '5分' },
    { value: '15m', label: '15分' },
    { value: '30m', label: '30分' },
    { value: '1h', label: '1時間' },
    { value: '4h', label: '4時間' },
    { value: '1d', label: '1日' },
    { value: '1w', label: '1週' },
];

// データ本数選択肢
const DATA_COUNTS = [
    { value: 60, label: '60本' },
    { value: 120, label: '120本' },
    { value: 240, label: '240本' },
    { value: 500, label: '500本' },
    { value: 1000, label: '1000本' },
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

// RealtimeChart の内部時間足 (秒) → 分析 API 用の文字列。チャートを単一ソースに分析と同期する。
const SECONDS_TO_TIMEFRAME: Record<number, string> = {
    60: '1m',
    300: '5m',
    900: '15m',
    1800: '30m',
    3600: '1h',
    14400: '4h',
};

export default function MarketAnalysisPage() {
    const [selectedSymbol, setSelectedSymbol] = useState('XAUUSD');
    const [selectedTimeframe, setSelectedTimeframe] = useState('1m');
    const [selectedDataCount, setSelectedDataCount] = useState(60);
    // 分析パネルの開閉。リアルタイムチャートは常時マウントしたまま、その下にパネルを展開する。
    const [showAnalysis, setShowAnalysis] = useState(false);
    const [analysisData, setAnalysisData] = useState<MarketAnalysisData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedIndicators, setSelectedIndicators] = useState<SelectedIndicator[]>([]);
    const [isTradingModalOpen, setIsTradingModalOpen] = useState(false);

    // データプリセット、モーダル、過去データステート
    const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
    const [selectedPreset, setSelectedPreset] = useState<DataPreset | null>(null);
    const [historicalData, setHistoricalData] = useState<OHLCVDataPoint[]>([]);
    const [historicalLoading, setHistoricalLoading] = useState(false);
    const [dataSource, setDataSource] = useState<'api' | 'preset'>('api');

    const handleSymbolChange = useCallback((symbol: string) => {
        setSelectedSymbol(symbol);
        setAnalysisData(null);
        setError(null);
    }, []);

    // リアルタイムチャート側の時間足変更を分析に同期する (チャートを単一ソースにする)。
    // 受け取るのは秒単位。分析 API 用の文字列に変換し、変わったら分析データを破棄して再取得させる。
    const handleRealtimeTimeframeChange = useCallback((seconds: number) => {
        const tf = SECONDS_TO_TIMEFRAME[seconds];
        if (!tf) return;
        setSelectedTimeframe((prev) => {
            if (prev === tf) return prev;
            setAnalysisData(null);
            return tf;
        });
    }, []);

    // データ取得
    const fetchAnalysis = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
            const response = await apiFetch(
                `${apiBase}/api/market-analysis/${selectedSymbol}?timeframe=${selectedTimeframe}&count=${selectedDataCount}`
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
    }, [selectedSymbol, selectedTimeframe, selectedDataCount]);

    // 分析パネルを開いている間、データが無ければ自動取得 (時間足/シンボル変更時も再取得)
    useEffect(() => {
        if (showAnalysis && !analysisData && !loading) {
            void fetchAnalysis();
        }
    }, [showAnalysis, analysisData, loading, fetchAnalysis]);

    // OHLCVデータをチャート用に変換。
    // useMemo で参照を安定化させないと、依存に持つ useMemo が毎レンダー再計算される
    // (react-hooks/exhaustive-deps の logical expression 警告対策)。
    const chartData: OHLCVDataPoint[] = useMemo(
        () =>
            analysisData?.ohlcv.map(d => ({
                timestamp: new Date(d.timestamp).getTime(),
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
                volume: d.volume,
            })) || [],
        [analysisData],
    );

    // プリセット選択時のDBデータ取得
    const handleSelectPreset = useCallback(async (preset: DataPreset) => {
        setSelectedPreset(preset);
        setIsPresetModalOpen(false);
        setDataSource('preset');
        setHistoricalLoading(true);
        try {
            const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
            const res = await apiFetch(
                `${apiBase}/api/ohlcv/candles?symbol=${encodeURIComponent(preset.symbol)}&timeframe=${encodeURIComponent(preset.timeframe)}&limit=500`
            );
            if (!res.ok) throw new Error(`APIエラー: ${res.status}`);
            const result = await res.json();
            if (!result.success) throw new Error(result.error || 'データ取得失敗');

            const ohlcv: OHLCVDataPoint[] = result.data.map(
                (d: { timestamp: string; open: number; high: number; low: number; close: number; volume: number }) => ({
                    timestamp: new Date(d.timestamp).getTime(),
                    open: d.open,
                    high: d.high,
                    low: d.low,
                    close: d.close,
                    volume: d.volume,
                })
            );
            setHistoricalData(ohlcv);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : '過去データの取得に失敗しました');
        } finally {
            setHistoricalLoading(false);
        }
    }, []);

    // データソース切替: APIに戻す
    const switchToApiData = useCallback(() => {
        setDataSource('api');
        setSelectedPreset(null);
        setHistoricalData([]);
    }, []);

    // 表示用チャートデータ（データソースに応じて切替）
    const displayChartData = dataSource === 'preset' ? historicalData : chartData;

    // 選択されたインジケーターを計算 (表示中データ = プリセット時は過去データ、それ以外は分析データ)
    const indicatorConfigs = useMemo(() => {
        if (displayChartData.length === 0 || selectedIndicators.length === 0) {
            return [];
        }

        const configs = [];
        for (const selected of selectedIndicators) {
            try {
                const indicatorConfigs = indicatorToChartConfigs(
                    selected.id,
                    displayChartData,
                    selected.params,
                    selected.displaySettings
                );
                configs.push(...indicatorConfigs);
            } catch (error) {
                console.warn(`[MarketAnalysis] インジケーター計算エラー (${selected.id}):`, error);
            }
        }
        return configs;
    }, [displayChartData, selectedIndicators]);

    return (
        <div className="min-h-screen bg-gray-900 text-white p-4 md:p-6 space-y-4">
            {/* セクション見出しは冗長 (サイドバーで現在地が分かる) ため撤去し、チャートの縦スペースを確保 */}
            {/* リアルタイムチャートは常時マウント。分析を開いても同じチャートがそのまま残る。 */}
            <RealtimeChart
                symbol={selectedSymbol}
                height={500}
                onSymbolChange={handleSymbolChange}
                onTimeframeChange={handleRealtimeTimeframeChange}
                rightAction={
                    <NeonButton
                        color="cyan"
                        size="sm"
                        variant="outline"
                        onClick={() => setShowAnalysis((v) => !v)}
                        icon="📊"
                        className="whitespace-nowrap"
                    >
                        {showAnalysis ? '分析 ▴' : '分析 ▾'}
                    </NeonButton>
                }
            />

            {/* 分析パネル: チャートの下に展開。上のリアルタイムチャートはそのまま残る。 */}
            {showAnalysis && (
                <div className="bg-gray-900 rounded-lg border border-gray-800 shadow-xl overflow-hidden">
                    {/* ヘッダー: 銘柄/時間足はチャートと同期 (表示のみ) + 取得本数 + 取得/管理 */}
                    <div className="bg-gray-800 px-3 py-2 flex flex-wrap items-center gap-2 border-b border-gray-700">
                        <span className="text-xs font-semibold text-white">{selectedSymbol}</span>
                        <span className="text-xs text-gray-400">{TIMEFRAMES.find((tf) => tf.value === selectedTimeframe)?.label || selectedTimeframe}</span>
                        {analysisData && (
                            <span className="text-xs text-gray-500">{analysisData.meta.dataPoints}本</span>
                        )}
                        {analysisData && (
                            <span className="text-xs text-gray-400">{new Date(analysisData.timestamp).toLocaleString('ja-JP')}</span>
                        )}

                        <select
                            value={selectedDataCount}
                            onChange={(e) => { setSelectedDataCount(parseInt(e.target.value, 10)); setAnalysisData(null); }}
                            className="bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 hover:border-gray-500"
                            title="分析に使う本数"
                        >
                            {DATA_COUNTS.map((dc) => (
                                <option key={dc.value} value={dc.value}>{dc.label}</option>
                            ))}
                        </select>

                        <div className="flex-1" />

                        {dataSource === 'preset' && selectedPreset ? (
                            <div className="flex items-center gap-1">
                                <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-1 rounded">📂 {selectedPreset.symbol} / {selectedPreset.timeframe}</span>
                                <button onClick={switchToApiData} className="text-xs text-gray-400 hover:text-white px-1.5 py-1 rounded hover:bg-gray-600 transition" title="ライブデータに切替">✕</button>
                            </div>
                        ) : (
                            <span className="text-xs text-green-400 bg-green-400/10 px-2 py-1 rounded">📡 ライブ</span>
                        )}

                        <NeonButton color="orange" size="sm" variant="outline" onClick={() => setIsPresetModalOpen(true)} icon="📊" className="whitespace-nowrap">データ管理</NeonButton>
                        <NeonButton color="purple" size="sm" onClick={fetchAnalysis} disabled={loading} icon="📥" className="whitespace-nowrap">{loading ? '取得中...' : '再取得'}</NeonButton>
                    </div>

                    <div className="p-4 space-y-4">
                        {error && (
                            <div className="bg-red-900/50 border border-red-500 rounded-lg p-4"><p className="text-red-300">⚠️ {error}</p></div>
                        )}

                        {loading && !analysisData && (
                            <div className="flex items-center justify-center py-10 text-gray-400 gap-3">
                                <div className="w-6 h-6 border-4 border-gray-600 border-t-blue-400 rounded-full animate-spin" aria-hidden="true" />
                                <span className="text-sm">分析データを取得中…</span>
                            </div>
                        )}

                        {/* ライブ分析の数字 (チャートは上にあるため、ここは数字のみを横並びで) */}
                        {analysisData && (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                {/* 市場状態 + 最新 OHLC */}
                                <div className="bg-gray-800 rounded-lg p-4">
                                    <h2 className="text-lg font-semibold mb-3">🎯 市場状態</h2>
                                    <div className="text-xl font-bold text-center py-3 bg-gray-700 rounded-lg">{analysisData.marketCondition}</div>
                                    <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                                        <div className="bg-gray-900/50 rounded p-1.5"><div className="text-gray-500 text-[10px]">始値</div><div className="font-mono text-xs">{analysisData.latestPrice.open.toFixed(2)}</div></div>
                                        <div className="bg-gray-900/50 rounded p-1.5"><div className="text-gray-500 text-[10px]">高値</div><div className="font-mono text-green-400 text-xs">{analysisData.latestPrice.high.toFixed(2)}</div></div>
                                        <div className="bg-gray-900/50 rounded p-1.5"><div className="text-gray-500 text-[10px]">安値</div><div className="font-mono text-red-400 text-xs">{analysisData.latestPrice.low.toFixed(2)}</div></div>
                                        <div className="bg-gray-900/50 rounded p-1.5"><div className="text-gray-500 text-[10px]">終値</div><div className="font-mono text-xs">{analysisData.latestPrice.close.toFixed(2)}</div></div>
                                    </div>
                                </div>

                                {/* インジケーター */}
                                <div className="bg-gray-800 rounded-lg p-4">
                                    <h2 className="text-lg font-semibold mb-3">📈 インジケーター</h2>
                                    <div className="space-y-2">
                                        <div className="flex justify-between"><span className="text-gray-400">RSI(14)</span><span className={`font-mono ${analysisData.indicators.rsi >= 70 ? 'text-red-400' : analysisData.indicators.rsi <= 30 ? 'text-green-400' : ''}`}>{analysisData.indicators.rsi.toFixed(1)}</span></div>
                                        <div className="flex justify-between"><span className="text-gray-400">MACDヒスト</span><span className={`font-mono ${analysisData.indicators.macdHistogram > 0 ? 'text-green-400' : 'text-red-400'}`}>{analysisData.indicators.macdHistogram.toFixed(4)}</span></div>
                                        <div className="flex justify-between"><span className="text-gray-400">SMA(20)</span><span className="font-mono">{analysisData.indicators.sma20.toFixed(2)}</span></div>
                                    </div>
                                </div>

                                {/* 12次元特徴量 */}
                                <div className="bg-gray-800 rounded-lg p-4">
                                    <h2 className="text-lg font-semibold mb-3">🧬 12次元特徴量</h2>
                                    <div className="space-y-2 max-h-[360px] overflow-y-auto">
                                        {analysisData.featureVector.detailed.map((feature) => (
                                            <div key={feature.index} className="bg-gray-700 rounded p-2">
                                                <div className="flex justify-between items-center mb-1">
                                                    <span className="text-sm flex items-center gap-1">
                                                        {feature.name}
                                                        <span className="text-gray-400 cursor-help relative group" title={feature.description}>
                                                            ⓘ
                                                            <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-2 py-1 bg-gray-900 text-gray-200 text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg border border-gray-600">{feature.description}</span>
                                                        </span>
                                                    </span>
                                                    <span className="font-mono text-sm">{feature.displayValue}</span>
                                                </div>
                                                <div className="w-full bg-gray-600 rounded-full h-2">
                                                    <div className={`h-2 rounded-full ${getFeatureColor(feature.value, feature.index)}`} style={{ width: `${Math.abs(feature.value) * 100}%`, marginLeft: feature.index === 0 && feature.value < 0 ? 'auto' : 0 }} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 保存データ(プリセット)選択時のみ、その過去データを小さなチャートで表示 */}
                        {dataSource === 'preset' && (
                            <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
                                <div className="bg-gray-800 px-3 py-2 flex items-center gap-3 border-b border-gray-700">
                                    <span className="text-xs font-semibold text-amber-300">📂 保存データ{selectedPreset ? ` (${selectedPreset.symbol} / ${selectedPreset.timeframe})` : ''}</span>
                                    <div className="flex-1" />
                                    <IndicatorSelector selectedIndicators={selectedIndicators} onSelectionChange={setSelectedIndicators} compact={true} />
                                </div>
                                <div className="p-0.5">
                                    {historicalLoading ? (
                                        <div className="flex items-center justify-center py-10 text-gray-400 gap-3"><div className="w-6 h-6 border-4 border-gray-600 border-t-amber-400 rounded-full animate-spin" aria-hidden="true" /><span className="text-sm">過去データを読み込み中…</span></div>
                                    ) : (
                                        <div className="h-[320px]"><CandlestickChart ohlcvData={displayChartData} height={300} indicators={indicatorConfigs} /></div>
                                    )}
                                </div>
                            </div>
                        )}

                        {!analysisData && !loading && !error && dataSource === 'api' && (
                            <div className="text-center py-10 text-gray-400">
                                <p className="text-sm">上のチャートの銘柄・時間足で分析します。「📥 再取得」で最新化、「📊 データ管理」で保存済み過去データを表示できます。</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* データプリセットモーダル */}
            <DataPresetModal
                isOpen={isPresetModalOpen}
                onClose={() => setIsPresetModalOpen(false)}
                onSelectPreset={handleSelectPreset}
            />

            {/* トレードモーダル */}
            <TradingModal
                isOpen={isTradingModalOpen}
                onClose={() => setIsTradingModalOpen(false)}
            />

            {/* トレード情報表示ボタン（フローティング） */}
            <button
                onClick={() => setIsTradingModalOpen(true)}
                className="fixed bottom-6 right-6 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-2 transition-all hover:scale-105 z-40"
            >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                トレード情報
            </button>
        </div>
    );
}
