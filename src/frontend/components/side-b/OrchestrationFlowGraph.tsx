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

/**
 * ノードの x/y 配置。横一直線 (幅2300×高160≒14:1) だと fitView が極端にズームアウトしてノードが
 * 豆粒になるため、パイプラインを 2 段に折り返した serpentine 配置にしてアスペクト比を ~2.5:1 に
 * 圧縮し、fitView 時のノードを読めるサイズにする。row1 (trade) は左→右、row2 (edge/検証) は
 * discovery の下から右→左に折り返す。row3 は補助ノード (evolution/pdca/ai_layer)。
 */
const COL = 210;
const NODE_POSITIONS: Record<string, { x: number; y: number }> = {
  // row1 (y=40): 取引パイプライン 左→右
  top_level_orchestrator: { x: 0 * COL, y: 40 },
  research: { x: 1 * COL, y: 40 },
  plan: { x: 2 * COL, y: 40 },
  virtual_trade: { x: 3 * COL, y: 40 },
  trade_monitoring: { x: 4 * COL, y: 40 },
  discovery: { x: 5 * COL, y: 40 },
  // row2 (y=210): エッジ/検証パイプライン discovery の下から右→左に折り返す
  hypothesis_generator: { x: 5 * COL, y: 210 },
  screening: { x: 4 * COL, y: 210 },
  full_validation: { x: 3 * COL, y: 210 },
  edge_ledger: { x: 2 * COL, y: 210 },
  materialization: { x: 1 * COL, y: 210 },
  // row3 (y=380): 補助 (evolution は edge_ledger へ / pdca はハブ / ai_layer は横断)
  evolution: { x: 3 * COL, y: 380 },
  pdca: { x: 4 * COL, y: 380 },
  ai_layer: { x: 5 * COL, y: 380 },
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
    <div style={{ width: "100%", height: "72vh", minHeight: 520 }} className="rounded-lg border border-gray-800 bg-[#0a0a0a]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        // 折り返しレイアウトで box が ~2.5:1 になったので padding を確保しつつ、maxZoom で
        // 寄りすぎ・minZoom で引きすぎを抑える (ノードが読めるレンジに収める)。
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.3}
        maxZoom={1.5}
        // colorMode=dark で Controls / MiniMap を含めダークテーマ化 (白抜け解消)。
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#27272a" gap={20} />
        <Controls />
        <MiniMap
          pannable
          zoomable
          maskColor="rgba(0,0,0,0.6)"
          style={{ backgroundColor: "#0a0a0a" }}
          nodeColor={(n) => {
            const status = snapshot.nodes.find((x) => x.id === n.id)?.status ?? "unknown";
            return NODE_STATUS_STYLE[status].border;
          }}
        />
      </ReactFlow>
    </div>
  );
}
