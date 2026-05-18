/**
 * Side-B: 自動実行設定ページ
 * 
 * スケジューラーの設定・制御UI
 * - 自動実行の有効/無効切替
 * - 対象シンボル・時間足設定
 * - 実行スケジュール設定
 * - 手動実行ボタン
 * 
 * @see docs/side-b/TradeAssistant-AI.md
 */

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";

// APIベースURL（同一オリジン: 相対パス）
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "") + "/api/side-b";

// スケジューラー設定型
interface SchedulerConfig {
  enabled: boolean;
  symbols: string[];
  timeframe: string;
  monitorIntervalMs: number;
  dailyPlanTimeUTC: string;
  autoGenerateNote: boolean;
}

// 市場状態型
interface MarketStatusInfo {
  isOpen: boolean;
  currentTimeUTC: string;
  currentTimeJST: string;
  nextOpen?: string;
  nextClose?: string;
  message: string;
}

// スケジューラー状態型
interface SchedulerStatus {
  isRunning: boolean;
  config: SchedulerConfig;
  lastDailyPlanRun?: string;
  lastMonitorRun?: string;
  marketStatus: MarketStatusInfo;
  errors: string[];
}

// 利用可能なシンボル
const availableSymbols = [
  { value: "XAU/USD", label: "XAU/USD (ゴールド)" },
  { value: "EUR/USD", label: "EUR/USD (ユーロドル)" },
  { value: "USD/JPY", label: "USD/JPY (ドル円)" },
  { value: "GBP/USD", label: "GBP/USD (ポンドドル)" },
];

// 利用可能な時間足
const availableTimeframes = [
  { value: "5m", label: "5分足" },
  { value: "15m", label: "15分足" },
  { value: "1h", label: "1時間足" },
  { value: "4h", label: "4時間足" },
];

// 日次プラン実行時刻（UTC）
const dailyPlanTimes = [
  { value: "00:00", label: "00:00 UTC (09:00 JST)" },
  { value: "06:00", label: "06:00 UTC (15:00 JST)" },
  { value: "12:00", label: "12:00 UTC (21:00 JST)" },
  { value: "22:00", label: "22:00 UTC (07:00 JST)" },
];

export default function SettingsPage() {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  // 編集用のローカル状態
  const [editConfig, setEditConfig] = useState<SchedulerConfig>({
    enabled: false,
    symbols: ["XAU/USD"],
    timeframe: "15m",
    monitorIntervalMs: 60000,
    dailyPlanTimeUTC: "00:00",
    autoGenerateNote: true,
  });

  // 初回読み込み
  useEffect(() => {
    fetchStatus();
    // 30秒ごとに状態を更新
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // 状態取得 (初期化 + 30秒 polling、ユーザー操作起因ではないため toast は出さず inline のみ)
  async function fetchStatus() {
    try {
      const res = await fetch(`${API_BASE}/scheduler/status`);
      if (!res.ok) throw new Error("状態の取得に失敗しました");
      const data = await res.json();
      setStatus(data);
      setEditConfig(data.config);
      setError(null);
    } catch (err) {
      // 30s polling で動くため toast を出すと連発する (Copilot レビュー #4)。
      // 初期化失敗のフィードバックは inline UI のみで担保。
      setError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setLoading(false);
    }
  }

  // 設定保存
  async function handleSaveConfig() {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/scheduler/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editConfig),
      });
      if (!res.ok) throw new Error("設定の保存に失敗しました");
      const data = await res.json();
      setStatus(data);
      setError(null);
      toast.success("設定を保存しました");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "不明なエラー";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  // スケジューラー開始
  async function handleStart() {
    setRunning(true);
    try {
      const res = await fetch(`${API_BASE}/scheduler/start`, { method: "POST" });
      if (!res.ok) throw new Error("開始に失敗しました");
      const data = await res.json();
      setStatus(data);
      setError(null);
      toast.success("スケジューラーを開始しました");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "不明なエラー";
      setError(msg);
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  }

  // スケジューラー停止
  async function handleStop() {
    setRunning(true);
    try {
      const res = await fetch(`${API_BASE}/scheduler/stop`, { method: "POST" });
      if (!res.ok) throw new Error("停止に失敗しました");
      const data = await res.json();
      setStatus(data);
      setError(null);
      toast.success("スケジューラーを停止しました");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "不明なエラー";
      setError(msg);
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  }

  // 日次プラン手動実行
  async function handleRunDailyPlan() {
    setRunning(true);
    try {
      const res = await fetch(`${API_BASE}/scheduler/run-daily-plan`, { method: "POST" });
      if (!res.ok) throw new Error("日次プラン実行に失敗しました");
      await fetchStatus();
      setError(null);
      toast.success("日次プランを実行しました");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "不明なエラー";
      setError(msg);
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  }

  // 監視手動実行
  async function handleRunMonitor() {
    setRunning(true);
    try {
      const res = await fetch(`${API_BASE}/scheduler/run-monitor`, { method: "POST" });
      if (!res.ok) throw new Error("監視実行に失敗しました");
      await fetchStatus();
      setError(null);
      toast.success("監視を実行しました");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "不明なエラー";
      setError(msg);
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  }

  // シンボル切替
  function toggleSymbol(symbol: string) {
    const newSymbols = editConfig.symbols.includes(symbol)
      ? editConfig.symbols.filter((s) => s !== symbol)
      : [...editConfig.symbols, symbol];
    setEditConfig({ ...editConfig, symbols: newSymbols.length > 0 ? newSymbols : [symbol] });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-purple-950 flex items-center justify-center">
        <div className="text-white text-xl">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-purple-950 text-white">
      {/* ヘッダー */}
      <header className="border-b border-slate-800/50 bg-slate-950/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/side-b" className="text-slate-400 hover:text-white transition-colors">
              ← Dashboard
            </Link>
            <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
              🔧 自動実行設定
            </h1>
          </div>

          {/* 市場状態 */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400">市場:</span>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${status?.marketStatus?.isOpen
                ? "bg-green-500/20 text-green-400 border border-green-500/30"
                : "bg-red-500/20 text-red-400 border border-red-500/30"
              }`}>
              {status?.marketStatus?.message || "不明"}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* エラー表示 */}
        {error && (
          <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-4 text-red-400">
            ⚠️ {error}
          </div>
        )}

        {/* スケジューラー状態カード */}
        <section className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <span>📡</span>
            スケジューラー状態
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {/* 実行状態 */}
            <div className="bg-slate-800/50 rounded-lg p-4 text-center">
              <div className="text-sm text-slate-400 mb-1">状態</div>
              <div className={`text-lg font-bold ${status?.isRunning ? "text-green-400" : "text-slate-500"}`}>
                {status?.isRunning ? "🟢 実行中" : "⏸️ 停止中"}
              </div>
            </div>

            {/* 最終日次プラン実行 */}
            <div className="bg-slate-800/50 rounded-lg p-4 text-center">
              <div className="text-sm text-slate-400 mb-1">最終プラン生成</div>
              <div className="text-sm">
                {status?.lastDailyPlanRun
                  ? new Date(status.lastDailyPlanRun).toLocaleString("ja-JP")
                  : "未実行"}
              </div>
            </div>

            {/* 最終監視実行 */}
            <div className="bg-slate-800/50 rounded-lg p-4 text-center">
              <div className="text-sm text-slate-400 mb-1">最終監視実行</div>
              <div className="text-sm">
                {status?.lastMonitorRun
                  ? new Date(status.lastMonitorRun).toLocaleString("ja-JP")
                  : "未実行"}
              </div>
            </div>

            {/* エラー数 */}
            <div className="bg-slate-800/50 rounded-lg p-4 text-center">
              <div className="text-sm text-slate-400 mb-1">直近エラー</div>
              <div className={`text-lg font-bold ${(status?.errors?.length ?? 0) > 0 ? "text-red-400" : "text-green-400"}`}>
                {status?.errors?.length ?? 0}件
              </div>
            </div>
          </div>

          {/* 開始/停止ボタン */}
          <div className="flex gap-4">
            <button
              onClick={handleStart}
              disabled={running || status?.isRunning}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {running ? "処理中..." : "▶️ 開始"}
            </button>
            <button
              onClick={handleStop}
              disabled={running || !status?.isRunning}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {running ? "処理中..." : "⏹️ 停止"}
            </button>
          </div>
        </section>

        {/* 設定カード */}
        <section className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <span>⚙️</span>
            実行設定
          </h2>

          <div className="space-y-6">
            {/* 有効/無効 */}
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">自動実行を有効にする</div>
                <div className="text-sm text-slate-400">オンにすると、設定したスケジュールで自動的にプラン生成・監視を行います</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={editConfig.enabled}
                  onChange={(e) => setEditConfig({ ...editConfig, enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-14 h-7 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-purple-600"></div>
              </label>
            </div>

            {/* シンボル選択 */}
            <div>
              <div className="font-medium mb-2">対象シンボル</div>
              <div className="flex flex-wrap gap-2">
                {availableSymbols.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => toggleSymbol(s.value)}
                    className={`px-4 py-2 rounded-lg border transition-all ${editConfig.symbols.includes(s.value)
                        ? "bg-purple-600 border-purple-500 text-white"
                        : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600"
                      }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 時間足選択 */}
            <div>
              <div className="font-medium mb-2">分析する時間足</div>
              <div className="flex flex-wrap gap-2">
                {availableTimeframes.map((tf) => (
                  <button
                    key={tf.value}
                    onClick={() => setEditConfig({ ...editConfig, timeframe: tf.value })}
                    className={`px-4 py-2 rounded-lg border transition-all ${editConfig.timeframe === tf.value
                        ? "bg-purple-600 border-purple-500 text-white"
                        : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600"
                      }`}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 日次プラン実行時刻 */}
            <div>
              <div className="font-medium mb-2">日次プラン生成時刻</div>
              <select
                value={editConfig.dailyPlanTimeUTC}
                onChange={(e) => setEditConfig({ ...editConfig, dailyPlanTimeUTC: e.target.value })}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-purple-500"
              >
                {dailyPlanTimes.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* 監視間隔 */}
            <div>
              <div className="font-medium mb-2">監視間隔</div>
              <select
                value={editConfig.monitorIntervalMs}
                onChange={(e) => setEditConfig({ ...editConfig, monitorIntervalMs: Number(e.target.value) })}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-purple-500"
              >
                <option value={30000}>30秒</option>
                <option value={60000}>1分</option>
                <option value={120000}>2分</option>
                <option value={300000}>5分</option>
              </select>
            </div>

            {/* Note自動生成 */}
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">決済時にNoteを自動生成</div>
                <div className="text-sm text-slate-400">トレード決済後、自動的にAIノートを生成します</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={editConfig.autoGenerateNote}
                  onChange={(e) => setEditConfig({ ...editConfig, autoGenerateNote: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-14 h-7 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-purple-600"></div>
              </label>
            </div>

            {/* 保存ボタン */}
            <button
              onClick={handleSaveConfig}
              disabled={saving}
              className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 rounded-lg font-medium transition-all disabled:opacity-50"
            >
              {saving ? "保存中..." : "💾 設定を保存"}
            </button>
          </div>
        </section>

        {/* 手動実行カード */}
        <section className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <span>🚀</span>
            手動実行
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={handleRunDailyPlan}
              disabled={running}
              className="px-6 py-4 bg-gradient-to-r from-indigo-600/80 to-purple-600/80 hover:from-indigo-500 hover:to-purple-500 border border-indigo-500/30 rounded-lg font-medium transition-all disabled:opacity-50"
            >
              <div className="text-lg mb-1">📋 日次プラン生成</div>
              <div className="text-sm text-slate-300">Research → Plan → Trade を一括実行</div>
            </button>

            <button
              onClick={handleRunMonitor}
              disabled={running}
              className="px-6 py-4 bg-gradient-to-r from-cyan-600/80 to-blue-600/80 hover:from-cyan-500 hover:to-blue-500 border border-cyan-500/30 rounded-lg font-medium transition-all disabled:opacity-50"
            >
              <div className="text-lg mb-1">📡 監視実行</div>
              <div className="text-sm text-slate-300">エントリー条件 & ポジション監視</div>
            </button>
          </div>
        </section>

        {/* エラーログ */}
        {status?.errors && status.errors.length > 0 && (
          <section className="bg-slate-900/50 border border-red-500/30 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-red-400">
              <span>⚠️</span>
              エラーログ (直近10件)
            </h2>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {status.errors.map((err, i) => (
                <div key={i} className="text-sm text-red-300 bg-red-500/10 rounded px-3 py-2 font-mono">
                  {err}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
