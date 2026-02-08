'use client';

/**
 * データプリセット管理モーダル
 * 
 * マーケット分析ページから呼び出して、
 * - プリセット一覧表示
 * - CSVインポート
 * - プリセット選択（分析タブにデータロード）
 */

import React, { useState, useEffect, useRef } from 'react';

// ============================================
// 型定義
// ============================================

export interface DataPreset {
    id: string;
    symbol: string;
    timeframe: string;
    name: string;
    description: string | null;
    startDate: string;
    endDate: string;
    recordCount: number;
    sourceFile: string | null;
    createdAt: string;
    updatedAt: string;
}

interface ImportResult {
    symbol: string;
    timeframe: string;
    importedCount: number;
    skippedCount: number;
    presetId: string;
    startDate: string | null;
    endDate: string | null;
}

interface DataPresetModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectPreset: (preset: DataPreset) => void;
}

// ============================================
// API 関数
// ============================================

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3100';

async function fetchPresets(): Promise<DataPreset[]> {
    const response = await fetch(`${API_BASE_URL}/api/ohlcv/presets`, {
        cache: 'no-store',
    });
    if (!response.ok) throw new Error('プリセット一覧の取得に失敗しました');
    const payload = await response.json();
    return payload.data;
}

async function importCSV(file: File, options?: {
    symbol?: string;
    timeframe?: string;
    presetName?: string;
    description?: string;
}): Promise<ImportResult> {
    const formData = new FormData();
    formData.append('file', file);
    if (options?.symbol) formData.append('symbol', options.symbol);
    if (options?.timeframe) formData.append('timeframe', options.timeframe);
    if (options?.presetName) formData.append('presetName', options.presetName);
    if (options?.description) formData.append('description', options.description);

    const response = await fetch(`${API_BASE_URL}/api/ohlcv/import`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'インポートに失敗しました');
    }

    const payload = await response.json();
    return payload.data;
}

async function deletePreset(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/ohlcv/presets/${id}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || '削除に失敗しました');
    }
}

// ============================================
// メインコンポーネント
// ============================================

export function DataPresetModal({ isOpen, onClose, onSelectPreset }: DataPresetModalProps) {
    const [presets, setPresets] = useState<DataPreset[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // インポートステート
    const [showImport, setShowImport] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [importing, setImporting] = useState(false);
    const [importResult, setImportResult] = useState<ImportResult | null>(null);
    const [importOptions, setImportOptions] = useState({
        symbol: '',
        timeframe: '',
        presetName: '',
        description: '',
    });

    const [deleting, setDeleting] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ============================================
    // データ取得
    // ============================================

    const loadPresets = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await fetchPresets();
            setPresets(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'データの取得に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            void loadPresets();
        }
    }, [isOpen]);

    // ============================================
    // イベントハンドラ
    // ============================================

    const handleFileSelect = (file: File) => {
        setSelectedFile(file);
        setImportResult(null);
        const match = file.name.match(/^([A-Z]+(?:\/[A-Z]+)?)_?(\d+[mhdwM])?/i);
        if (match) {
            setImportOptions(prev => ({
                ...prev,
                symbol: match[1]?.replace('_', '/') || '',
                timeframe: match[2] || '',
            }));
        }
    };

    const handleImport = async () => {
        if (!selectedFile) return;
        try {
            setImporting(true);
            setError(null);
            const result = await importCSV(selectedFile, {
                symbol: importOptions.symbol || undefined,
                timeframe: importOptions.timeframe || undefined,
                presetName: importOptions.presetName || undefined,
                description: importOptions.description || undefined,
            });
            setImportResult(result);
            setSelectedFile(null);
            setImportOptions({ symbol: '', timeframe: '', presetName: '', description: '' });
            await loadPresets();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'インポートに失敗しました');
        } finally {
            setImporting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('このプリセットを削除しますか？')) return;
        try {
            setDeleting(id);
            await deletePreset(id);
            await loadPresets();
        } catch (err) {
            setError(err instanceof Error ? err.message : '削除に失敗しました');
        } finally {
            setDeleting(null);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.csv')) {
            handleFileSelect(file);
        }
    };

    // ============================================
    // レンダリング
    // ============================================

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">📊</span>
                        <h2 className="text-lg font-bold text-white">データプリセット管理</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowImport(!showImport)}
                            className={`px-3 py-1.5 text-sm rounded-lg transition ${showImport
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`}
                        >
                            {showImport ? '✕ 閉じる' : '📥 CSVインポート'}
                        </button>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-white text-xl px-2"
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* エラー表示 */}
                {error && (
                    <div className="bg-red-600/20 border-b border-red-600 text-red-400 px-6 py-2 text-sm">
                        {error}
                    </div>
                )}

                {/* インポート成功メッセージ */}
                {importResult && (
                    <div className="bg-green-600/20 border-b border-green-600 text-green-400 px-6 py-2 text-sm">
                        ✅ インポート完了: {importResult.symbol}/{importResult.timeframe} - {importResult.importedCount}件
                    </div>
                )}

                <div className="flex-1 overflow-y-auto">
                    {/* CSVインポートセクション */}
                    {showImport && (
                        <div className="px-6 py-4 border-b border-gray-700 bg-gray-800/50">
                            {!selectedFile ? (
                                <div
                                    onDragOver={e => e.preventDefault()}
                                    onDrop={handleDrop}
                                    onClick={() => fileInputRef.current?.click()}
                                    className="border-2 border-dashed border-gray-600 rounded-lg p-6 text-center cursor-pointer hover:border-gray-500 transition-colors"
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".csv"
                                        onChange={e => {
                                            const file = e.target.files?.[0];
                                            if (file) handleFileSelect(file);
                                        }}
                                        className="hidden"
                                    />
                                    <div className="text-3xl mb-2">📁</div>
                                    <p className="text-gray-300 text-sm">CSVファイルをドラッグ＆ドロップ</p>
                                    <p className="text-gray-500 text-xs mt-1">またはクリックしてファイルを選択</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between bg-gray-700 rounded px-3 py-2">
                                        <div>
                                            <p className="text-white text-sm font-medium">{selectedFile.name}</p>
                                            <p className="text-gray-400 text-xs">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                                        </div>
                                        <button onClick={() => setSelectedFile(null)} className="text-gray-400 hover:text-white">✕</button>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs text-gray-400 mb-1">シンボル</label>
                                            <input
                                                type="text"
                                                value={importOptions.symbol}
                                                onChange={e => setImportOptions(prev => ({ ...prev, symbol: e.target.value }))}
                                                placeholder="例: XAU/USD"
                                                className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-400 mb-1">時間足</label>
                                            <select
                                                value={importOptions.timeframe}
                                                onChange={e => setImportOptions(prev => ({ ...prev, timeframe: e.target.value }))}
                                                className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            >
                                                <option value="">自動推定</option>
                                                <option value="1m">1分足</option>
                                                <option value="5m">5分足</option>
                                                <option value="15m">15分足</option>
                                                <option value="1h">1時間足</option>
                                                <option value="4h">4時間足</option>
                                                <option value="1d">日足</option>
                                            </select>
                                        </div>
                                    </div>

                                    <button
                                        onClick={handleImport}
                                        disabled={importing}
                                        className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${importing
                                            ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                                            }`}
                                    >
                                        {importing ? 'インポート中...' : 'インポート実行'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* プリセット一覧 */}
                    <div className="px-6 py-4">
                        {loading ? (
                            <div className="text-center text-gray-400 py-8">読み込み中...</div>
                        ) : presets.length === 0 ? (
                            <div className="text-center text-gray-400 py-8">
                                <p className="text-3xl mb-2">📋</p>
                                <p className="text-sm">プリセットデータがありません</p>
                                <p className="text-xs text-gray-500 mt-1">CSVファイルをインポートしてください</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {presets.map(preset => (
                                    <div
                                        key={preset.id}
                                        className="bg-gray-800 border border-gray-700 rounded-lg p-3 hover:border-gray-600 transition-colors group"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-white font-semibold text-sm">{preset.symbol}</span>
                                                    <span className="text-gray-400 text-xs px-1.5 py-0.5 bg-gray-700 rounded">{preset.timeframe}</span>
                                                    <span className="text-gray-500 text-xs">{preset.recordCount.toLocaleString()}件</span>
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    {new Date(preset.startDate).toLocaleDateString('ja-JP')} 〜 {new Date(preset.endDate).toLocaleDateString('ja-JP')}
                                                    {preset.name && <span className="ml-2 text-gray-400">| {preset.name}</span>}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => onSelectPreset(preset)}
                                                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg transition"
                                                >
                                                    チャート表示
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(preset.id)}
                                                    disabled={deleting === preset.id}
                                                    className={`px-2 py-1.5 text-xs rounded-lg transition ${deleting === preset.id
                                                        ? 'bg-gray-600 text-gray-400'
                                                        : 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                                                        }`}
                                                >
                                                    {deleting === preset.id ? '...' : '削除'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
