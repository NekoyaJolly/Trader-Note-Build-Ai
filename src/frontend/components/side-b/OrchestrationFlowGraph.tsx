"use client";

/**
 * Side-B オーケストレーションのノードグラフ可視化。
 *
 * エージェント=ノード / ハンドオフ=エッジ。各ノードは生死 (flowing/stale/dead/idle/unknown)
 * で色分けし、エッジは flowing(緑)/broken(赤=ハンドオフ断絶)/stale(琥珀)/idle/unknown(灰) で表現。
 * 「10+ エージェントの個々が機能しているか」を一目で把握するための図。手動更新前提。
 */

import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  OrchestrationFlowSnapshot,
  FlowNodeStatus,
  FlowEdgeStatus,
} from "@/lib/sideBApi";

/** ノードの x/y 配置 (パイプライン順の手動レイアウト)。react-flow は fitView でパン/ズーム可。 */
const NODE_POSITIONS: Record<string, { x: number; y: number }> = {
  top_level_orchestrator: { x: 0, y: 40 },
  research: { x: 230, y: 40 },
  plan: { x: 460, y: 40 },
  virtual_trade: { x: 690, y: 40 },
  trade_monitoring: { x: 920, y: 40 },
  discovery: { x: 1150, y: 40 },
  hypothesis_generator: { x: 1380, y: 40 },
  screening: { x: 1610, y: 40 },
  full_validation: { x: 1840, y: 40 },
  edge_ledger: { x: 2070, y: 40 },
  materialization: { x: 2300, y: 40 },
  evolution: { x: 1840, y: 200 },
  pdca: { x: 920, y: 230 },
  ai_layer: { x: 0, y: 230 },
};

const NODE_STATUS_STYLE: Record<FlowNodeStatus, { bg: string; border: string; label: string }> = {
  flowing: { bg: "#052e1a", border: "#16a34a", label: "稼働中" },
  stale: { bg: "#2e2305", border: "#d97706", label: "鈍化" },
  dead: { bg: "#2e0808", border: "#dc2626", label: "停止" },
  idle: { bg: "#1f2937", border: "#6b7280", label: "休止(閉場等)" },
  unknown: { bg: "#171717", border: "#52525b", label: "不明(信号なし)" },
};

const EDGE_STATUS_COLOR: Record<FlowEdgeStatus, string> = {
  flowing: "#16a34a",
  broken: "#dc2626",
  stale: "#d97706",
  idle: "#6b7280",
  unknown: "#52525b",
};

function relativeAge(ms: number | null): string {
  if (ms == null) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return "未来?";
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}

export function OrchestrationFlowGraph({ snapshot }: { snapshot: OrchestrationFlowSnapshot }) {
  const nodes: Node[] = useMemo(
    () =>
      snapshot.nodes.map((n) => {
        const style = NODE_STATUS_STYLE[n.status];
        return {
          id: n.id,
          position: NODE_POSITIONS[n.id] ?? { x: 0, y: 0 },
          data: {
            label: (
              <div style={{ textAlign: "left", lineHeight: 1.3 }}>
                <div style={{ fontWeight: 700, fontSize: 12 }}>{n.label}</div>
                <div style={{ fontSize: 10, color: style.border }}>● {style.label}</div>
                <div style={{ fontSize: 9, color: "#a1a1aa" }}>{relativeAge(n.lastActivityMs)}</div>
                <div style={{ fontSize: 9, color: "#71717a", maxWidth: 150, whiteSpace: "normal" }}>{n.produces}</div>
              </div>
            ),
          },
          style: {
            background: style.bg,
            border: `2px ${n.status === "unknown" ? "dashed" : "solid"} ${style.border}`,
            borderRadius: 8,
            color: "#e5e7eb",
            width: 168,
            padding: 8,
          },
        };
      }),
    [snapshot.nodes],
  );

  const edges: Edge[] = useMemo(
    () =>
      snapshot.edges.map((e, i) => {
        const color = EDGE_STATUS_COLOR[e.status];
        return {
          id: `${e.from}-${e.to}-${i}`,
          source: e.from,
          target: e.to,
          label: e.label,
          animated: e.status === "flowing",
          style: { stroke: color, strokeWidth: e.status === "broken" ? 2.5 : 1.5 },
          labelStyle: { fill: "#a1a1aa", fontSize: 9 },
          labelBgStyle: { fill: "#0a0a0a" },
        };
      }),
    [snapshot.edges],
  );

  return (
    <div style={{ width: "100%", height: 560 }} className="rounded-lg border border-gray-800 bg-[#0a0a0a]">
      <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.2} proOptions={{ hideAttribution: true }}>
        <Background color="#27272a" gap={20} />
        <Controls />
        <MiniMap pannable zoomable nodeColor={(n) => {
          const status = snapshot.nodes.find((x) => x.id === n.id)?.status ?? "unknown";
          return NODE_STATUS_STYLE[status].border;
        }} />
      </ReactFlow>
    </div>
  );
}
