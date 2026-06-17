"use client";

/**
 * Side-B オーケストレーション・フロー可視化ページ。
 *
 * エージェント=ノード/ハンドオフ=エッジ のグラフで「どの段が生きてる/詰まってるか」を一目で。
 * 状態系 UI の規約に従い auto-polling はせず、マウント時 1 回 fetch + 手動「更新」ボタンのみ。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { sideBApi, type OrchestrationFlowSnapshot, type FlowNodeStatus } from "@/lib/sideBApi";
import { OrchestrationFlowGraph } from "@/components/side-b/OrchestrationFlowGraph";

const STATUS_LABEL: Record<FlowNodeStatus, string> = {
  flowing: "稼働中",
  stale: "鈍化",
  dead: "停止",
  idle: "休止",
  unknown: "不明",
};
const STATUS_COLOR: Record<FlowNodeStatus, string> = {
  flowing: "text-green-400",
  stale: "text-amber-400",
  dead: "text-red-400",
  idle: "text-gray-400",
  unknown: "text-zinc-500",
};

export default function SideBFlowPage() {
  const [snapshot, setSnapshot] = useState<OrchestrationFlowSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await sideBApi.getOrchestrationFlow();
      setSnapshot(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "フロー取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  // auto-polling は廃止 (2026-05-31 規約)。マウント時 1 回のみ。
  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const counts = useMemo(() => {
    const c: Record<FlowNodeStatus, number> = { flowing: 0, stale: 0, dead: 0, idle: 0, unknown: 0 };
    snapshot?.nodes.forEach((n) => { c[n.status] += 1; });
    return c;
  }, [snapshot]);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">オーケストレーション・フロー</h1>
        {snapshot && (
          <span className="text-xs text-gray-400">
            {snapshot.marketOpen ? "🟢 FX開場中" : "⚪ FX閉場中"} ・ AI層: {snapshot.aiHealthStatus} ・ {new Date(snapshot.generatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} JST
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => void fetchData()}
          disabled={loading}
          className="text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded px-3 py-1.5 border border-gray-600"
        >
          {loading ? "取得中…" : "🔄 更新"}
        </button>
      </div>

      {/* 状態サマリ + 凡例 */}
      <div className="flex flex-wrap items-center gap-4 text-xs">
        {(Object.keys(STATUS_LABEL) as FlowNodeStatus[]).map((s) => (
          <span key={s} className={STATUS_COLOR[s]}>● {STATUS_LABEL[s]}: {counts[s]}</span>
        ))}
        <span className="text-gray-500">| エッジ赤 = ハンドオフ断絶</span>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-500 rounded-lg p-3 text-sm text-red-300">⚠️ {error}</div>
      )}

      {snapshot ? (
        <OrchestrationFlowGraph snapshot={snapshot} />
      ) : (
        !error && <div className="text-gray-400 text-sm py-10 text-center">{loading ? "読み込み中…" : "データなし"}</div>
      )}

      <p className="text-[11px] text-gray-500">
        ※ 各ノードの生死は対応するドメインテーブルの最終更新時刻から導出。直接信号のない段 (PDCA 等) は「不明」表示。
        手動更新のみ (自動ポーリングなし)。
      </p>
    </div>
  );
}
