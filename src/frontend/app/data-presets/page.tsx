/**
 * データプリセット管理ページ
 * 
 * 目的:
 * - ヒストリカル OHLCV データの CSV インポート
 * - プリセット一覧の表示
 * - プリセットの削除
 * 
 * @see NOTE.md - ドメイン仕様
 * @see docs/ARCHITECTURE.md - 実装仕様
 */

"use client";

import React, { useState, useEffect, useRef } from "react";

// ============================================
// 型定義
// ============================================

/** データプリセット */
interface DataPreset {
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

/** インポート結果 */
interface ImportResult {
  symbol: string;
  timeframe: string;
  importedCount: number;
  skippedCount: number;
  presetId: string;
  startDate: string | null;
  endDate: string | null;
}

// ============================================
// API 関数
// ============================================

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

/** プリセット一覧を取得 */
async function fetchPresets(): Promise<DataPreset[]> {
  const response = await fetch(`${API_BASE_URL}/api/ohlcv/presets`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('プリセット一覧の取得に失敗しました');
  }

  const payload = await response.json();
  return payload.data;
}

/** CSV ファイルをインポート */
async function importCSV(file: File, options?: {
  symbol?: string;
  timeframe?: string;
  presetName?: string;
  description?: string;
}): Promise<ImportResult> {
  console.log('[importCSV] API_BASE_URL:', API_BASE_URL);
  const formData = new FormData();
  formData.append('file', file);

  if (options?.symbol) {
    formData.append('symbol', options.symbol);
  }
  if (options?.timeframe) {
    formData.append('timeframe', options.timeframe);
  }
  if (options?.presetName) {
    formData.append('presetName', options.presetName);
  }
  if (options?.description) {
    formData.append('description', options.description);
  }

  console.log('[importCSV] Sending request to:', `${API_BASE_URL}/api/ohlcv/import`);
  const response = await fetch(`${API_BASE_URL}/api/ohlcv/import`, {
    method: 'POST',
    body: formData,
  });

  console.log('[importCSV] Response status:', response.status);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.error('[importCSV] Error response:', error);
    throw new Error(error.error || 'インポートに失敗しました');
  }

  const payload = await response.json();
  console.log('[importCSV] Success payload:', payload);
  return payload.data;
}

/** プリセットを削除 */
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
// サブコンポーネント
// ============================================

/** ファイルドロップゾーン */
function FileDropZone({
  onFileSelect
}: {
  onFileSelect: (file: File) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
      onFileSelect(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
      className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${isDragging
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-slate-600 hover:border-slate-500'
        }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={handleFileChange}
        className="hidden"
      />
      <div className="text-4xl mb-4">📁</div>
      <p className="text-gray-300 mb-2">
        CSV ファイルをドラッグ＆ドロップ
      </p>
      <p className="text-gray-500 text-sm">
        またはクリックしてファイルを選択
      </p>
      <p className="text-gray-500 text-xs mt-4">
        フォーマット: time,open,high,low,close
      </p>
      <p className="text-gray-500 text-xs">
        ファイル名例: USDJPY_1h.csv
      </p>
    </div>
  );
}

/** プリセット一覧テーブル */
function PresetTable({
  presets,
  onDelete,
  deleting,
}: {
  presets: DataPreset[];
  onDelete: (id: string) => void;
  deleting: string | null;
}) {
  if (presets.length === 0) {
    return (
      <div className="text-center text-gray-400 py-8">
        プリセットデータがありません。CSV ファイルをインポートしてください。
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-700 text-gray-300">
          <tr>
            <th className="px-4 py-3 text-left">シンボル</th>
            <th className="px-4 py-3 text-left">時間足</th>
            <th className="px-4 py-3 text-left">期間</th>
            <th className="px-4 py-3 text-right">レコード数</th>
            <th className="px-4 py-3 text-left">名前</th>
            <th className="px-4 py-3 text-left">更新日時</th>
            <th className="px-4 py-3 text-center">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700">
          {presets.map((preset) => (
            <tr key={preset.id} className="hover:bg-slate-700/50">
              <td className="px-4 py-3 text-white font-medium">
                {preset.symbol}
              </td>
              <td className="px-4 py-3 text-gray-300">
                {preset.timeframe}
              </td>
              <td className="px-4 py-3 text-gray-300 text-xs">
                {new Date(preset.startDate).toLocaleDateString('ja-JP')}
                <br />
                〜 {new Date(preset.endDate).toLocaleDateString('ja-JP')}
              </td>
              <td className="px-4 py-3 text-right text-gray-300">
                {preset.recordCount.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-gray-300">
                {preset.name}
                {preset.description && (
                  <p className="text-xs text-gray-500">{preset.description}</p>
                )}
              </td>
              <td className="px-4 py-3 text-gray-400 text-xs">
                {new Date(preset.updatedAt).toLocaleString('ja-JP')}
              </td>
              <td className="px-4 py-3 text-center">
                <button
                  onClick={() => onDelete(preset.id)}
                  disabled={deleting === preset.id}
                  className={`px-3 py-1 rounded text-sm transition-colors ${deleting === preset.id
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                    }`}
                >
                  {deleting === preset.id ? '削除中...' : '削除'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================
// メインコンポーネント
// ============================================

export default function DataPresetsPage() {
  // プリセット一覧
  const [presets, setPresets] = useState<DataPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // インポートステート
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // インポートオプション
  const [importOptions, setImportOptions] = useState({
    symbol: '',
    timeframe: '',
    presetName: '',
    description: '',
  });

  // 削除ステート
  const [deleting, setDeleting] = useState<string | null>(null);

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
    loadPresets();
  }, []);

  // ============================================
  // イベントハンドラ
  // ============================================

  /** ファイル選択 */
  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setImportResult(null);

    // ファイル名からシンボルと時間足を推定
    const match = file.name.match(/^([A-Z]+(?:\/[A-Z]+)?)_?(\d+[mhdwM])?/i);
    if (match) {
      setImportOptions((prev) => ({
        ...prev,
        symbol: match[1]?.replace('_', '/') || '',
        timeframe: match[2] || '',
      }));
    }
  };

  /** インポート実行 */
  const handleImport = async () => {
    console.log('[DataPresets] handleImport called, selectedFile:', selectedFile?.name);
    if (!selectedFile) {
      console.log('[DataPresets] No file selected');
      return;
    }

    try {
      setImporting(true);
      setError(null);
      console.log('[DataPresets] Starting import...', {
        symbol: importOptions.symbol,
        timeframe: importOptions.timeframe,
      });

      const result = await importCSV(selectedFile, {
        symbol: importOptions.symbol || undefined,
        timeframe: importOptions.timeframe || undefined,
        presetName: importOptions.presetName || undefined,
        description: importOptions.description || undefined,
      });

      console.log('[DataPresets] Import successful:', result);
      setImportResult(result);
      setSelectedFile(null);
      setImportOptions({
        symbol: '',
        timeframe: '',
        presetName: '',
        description: '',
      });

      // プリセット一覧を再取得
      await loadPresets();
    } catch (err) {
      console.error('[DataPresets] Import error:', err);
      setError(err instanceof Error ? err.message : 'インポートに失敗しました');
    } finally {
      setImporting(false);
    }
  };

  /** プリセット削除 */
  const handleDelete = async (id: string) => {
    if (!confirm('このプリセットを削除しますか？関連する OHLCV データも削除されます。')) {
      return;
    }

    try {
      setDeleting(id);
      setError(null);
      await deletePreset(id);
      await loadPresets();
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました');
    } finally {
      setDeleting(null);
    }
  };

  // ============================================
  // レンダリング
  // ============================================

  return (
    <div className="space-y-6">
      {/* エラー表示 */}
      {error && (
        <div className="bg-red-600/20 border border-red-600 text-red-400 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* インポート成功メッセージ */}
      {importResult && (
        <div className="bg-green-600/20 border border-green-600 text-green-400 px-4 py-3 rounded mb-6">
          ✅ インポート完了: {importResult.symbol}/{importResult.timeframe} - {importResult.importedCount}件
          {importResult.skippedCount > 0 && ` (スキップ: ${importResult.skippedCount}件)`}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左カラム: インポート */}
        <div className="lg:col-span-1">
          <div className="bg-slate-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              CSV インポート
            </h2>

            {/* ファイルドロップゾーン */}
            {!selectedFile && (
              <FileDropZone onFileSelect={handleFileSelect} />
            )}

            {/* 選択されたファイル情報 */}
            {selectedFile && (
              <div className="space-y-4">
                <div className="bg-slate-700 rounded p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-medium">{selectedFile.name}</p>
                      <p className="text-gray-400 text-sm">
                        {(selectedFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedFile(null)}
                      className="text-gray-400 hover:text-white"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* インポートオプション */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      シンボル
                    </label>
                    <input
                      type="text"
                      value={importOptions.symbol}
                      onChange={(e) => setImportOptions((prev) => ({
                        ...prev,
                        symbol: e.target.value,
                      }))}
                      placeholder="例: USD/JPY"
                      className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      時間足
                    </label>
                    <select
                      value={importOptions.timeframe}
                      onChange={(e) => setImportOptions((prev) => ({
                        ...prev,
                        timeframe: e.target.value,
                      }))}
                      className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">自動推定</option>
                      <option value="1m">1分足</option>
                      <option value="5m">5分足</option>
                      <option value="15m">15分足</option>
                      <option value="30m">30分足</option>
                      <option value="1h">1時間足</option>
                      <option value="4h">4時間足</option>
                      <option value="1d">日足</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      プリセット名（任意）
                    </label>
                    <input
                      type="text"
                      value={importOptions.presetName}
                      onChange={(e) => setImportOptions((prev) => ({
                        ...prev,
                        presetName: e.target.value,
                      }))}
                      placeholder="例: 2024年データ"
                      className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      説明（任意）
                    </label>
                    <textarea
                      value={importOptions.description}
                      onChange={(e) => setImportOptions((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))}
                      placeholder="このデータセットの説明..."
                      rows={2}
                      className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* インポートボタン */}
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className={`w-full py-3 rounded-lg font-medium transition-colors ${importing
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                >
                  {importing ? 'インポート中...' : 'インポート実行'}
                </button>
              </div>
            )}

            {/* フォーマットガイド */}
            <div className="mt-6 text-xs text-gray-500">
              <h3 className="font-medium text-gray-400 mb-2">CSV フォーマット</h3>
              <pre className="bg-slate-700 p-2 rounded overflow-x-auto">
                time,open,high,low,close{"\n"}
                2024-01-01T00:00:00Z,148.50,148.75,148.25,148.60{"\n"}
                2024-01-01T01:00:00Z,148.60,148.90,148.50,148.80
              </pre>
              <p className="mt-2">
                ※ ファイル名を <code className="bg-slate-700 px-1 rounded">USDJPY_1h.csv</code> のように
                することでシンボルと時間足を自動推定します
              </p>
            </div>
          </div>
        </div>

        {/* 右カラム: プリセット一覧 */}
        <div className="lg:col-span-2">
          <div className="bg-slate-800 rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-white">
                プリセット一覧
              </h2>
              <button
                onClick={loadPresets}
                disabled={loading}
                className="text-gray-400 hover:text-white text-sm"
              >
                🔄 更新
              </button>
            </div>

            {loading ? (
              <div className="text-center text-gray-400 py-8">
                読み込み中...
              </div>
            ) : (
              <PresetTable
                presets={presets}
                onDelete={handleDelete}
                deleting={deleting}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
