/**
 * オーケストレーション flow のライブ状態を組み立てる service。
 *
 * 各ノードの「最後に有効な出力を出した時刻」をドメインテーブルから success-aware に取得し
 * (例: top_level は status='succeeded' の最新のみ = 失敗連発なら dead を出す)、純関数
 * deriveNodeStatus / deriveEdgeStatus で状態を算出する。run ledger の網羅に依存しない。
 */

import { prisma } from '../../backend/db/client';
import { getAiHealthSnapshot, type AiHealthStatus } from '../agent/aiHealth';
import { FLOW_NODES, FLOW_EDGES, type FlowSignalKey } from './orchestrationTopology';
import {
  deriveNodeStatus,
  deriveEdgeStatus,
  isForexLikelyOpen,
  type FlowStatus,
  type EdgeStatus,
} from './orchestrationFlowStatus';

export interface FlowNodeView {
  id: string;
  label: string;
  group: string;
  status: FlowStatus;
  lastActivityMs: number | null;
  produces: string;
}

export interface FlowEdgeView {
  from: string;
  to: string;
  label: string;
  status: EdgeStatus;
}

export interface OrchestrationFlowSnapshot {
  nodes: FlowNodeView[];
  edges: FlowEdgeView[];
  marketOpen: boolean;
  aiHealthStatus: AiHealthStatus;
  generatedAt: string;
}

function tsOrNull(row: { ts: Date | null } | null): number | null {
  return row?.ts ? row.ts.getTime() : null;
}

/**
 * 各 FlowSignalKey の「最終活動時刻 (ms)」を解決する。ai_layer / none は時刻を持たない
 * (それぞれ aiHealth / 信号なし で別途扱う) ため null を返す。
 */
async function resolveLastActivity(): Promise<Record<FlowSignalKey, number | null>> {
  const [
    topLevel,
    research,
    plan,
    virtualTrade,
    tradeExit,
    discovery,
    hypothesis,
    screening,
    validation,
    evolution,
    edgeConfirmed,
    materialization,
  ] = await Promise.all([
    prisma.agentRun.findFirst({ where: { kind: 'top_level_orchestrator', status: 'succeeded' }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }),
    prisma.researchOutput.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.aITradePlan.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.virtualTrade.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.virtualTrade.findFirst({ where: { exitedAt: { not: null } }, orderBy: { exitedAt: 'desc' }, select: { exitedAt: true } }),
    prisma.edgeHypothesis.findFirst({ where: { source: 'discovery' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.edgeHypothesis.findFirst({ where: { source: 'ai_generated' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.edgeHypothesis.findFirst({ where: { status: { in: ['screening_passed', 'testing', 'rejected', 'not_testable'] } }, orderBy: { statusUpdatedAt: 'desc' }, select: { statusUpdatedAt: true } }),
    prisma.edgeHypothesis.findFirst({ where: { status: { in: ['confirmed', 'rejected'] } }, orderBy: { statusUpdatedAt: 'desc' }, select: { statusUpdatedAt: true } }),
    prisma.evolutionBacktestRun.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.edgeHypothesis.findFirst({ where: { status: 'confirmed' }, orderBy: { statusUpdatedAt: 'desc' }, select: { statusUpdatedAt: true } }),
    prisma.tradeNote.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ]);

  return {
    top_level: tsOrNull(topLevel ? { ts: topLevel.startedAt } : null),
    research: tsOrNull(research ? { ts: research.createdAt } : null),
    plan: tsOrNull(plan ? { ts: plan.createdAt } : null),
    virtual_trade: tsOrNull(virtualTrade ? { ts: virtualTrade.createdAt } : null),
    trade_exit: tsOrNull(tradeExit ? { ts: tradeExit.exitedAt } : null),
    discovery: tsOrNull(discovery ? { ts: discovery.createdAt } : null),
    hypothesis: tsOrNull(hypothesis ? { ts: hypothesis.createdAt } : null),
    screening: tsOrNull(screening ? { ts: screening.statusUpdatedAt } : null),
    validation: tsOrNull(validation ? { ts: validation.statusUpdatedAt } : null),
    evolution: tsOrNull(evolution ? { ts: evolution.createdAt } : null),
    edge_confirmed: tsOrNull(edgeConfirmed ? { ts: edgeConfirmed.statusUpdatedAt } : null),
    materialization: tsOrNull(materialization ? { ts: materialization.createdAt } : null),
    ai_layer: null,
    none: null,
  };
}

/** aiHealth の status を flow の FlowStatus にマップする。 */
function aiHealthToFlowStatus(s: AiHealthStatus): FlowStatus {
  switch (s) {
    case 'ok':
      return 'flowing';
    case 'degraded':
      return 'stale';
    case 'down':
      return 'dead';
    case 'idle':
      return 'unknown'; // まだ 1 度も呼ばれていない = 観測不能
  }
}

export async function getOrchestrationFlow(nowMs: number = Date.now()): Promise<OrchestrationFlowSnapshot> {
  const lastActivity = await resolveLastActivity();
  const aiHealth = getAiHealthSnapshot();
  const marketOpen = isForexLikelyOpen(nowMs);

  const nodes: FlowNodeView[] = FLOW_NODES.map((def) => {
    let status: FlowStatus;
    let lastActivityMs: number | null = null;

    if (def.signal === 'ai_layer') {
      status = aiHealthToFlowStatus(aiHealth.status);
      lastActivityMs = aiHealth.lastSuccessAt ? new Date(aiHealth.lastSuccessAt).getTime() : null;
    } else if (def.signal === 'none') {
      status = deriveNodeStatus({ hasSignal: false, lastActivityMs: null, expectedCadenceMs: null, nowMs, marketDependent: false, marketOpen });
    } else {
      lastActivityMs = lastActivity[def.signal];
      status = deriveNodeStatus({
        hasSignal: true,
        lastActivityMs,
        expectedCadenceMs: def.expectedCadenceMs,
        nowMs,
        marketDependent: def.marketDependent,
        marketOpen,
      });
    }

    return { id: def.id, label: def.label, group: def.group, status, lastActivityMs, produces: def.produces };
  });

  const statusById = new Map<string, FlowStatus>(nodes.map((n) => [n.id, n.status]));
  const edges: FlowEdgeView[] = FLOW_EDGES.map((e) => ({
    from: e.from,
    to: e.to,
    label: e.label,
    status: deriveEdgeStatus(statusById.get(e.from) ?? 'unknown', statusById.get(e.to) ?? 'unknown'),
  }));

  return {
    nodes,
    edges,
    marketOpen,
    aiHealthStatus: aiHealth.status,
    generatedAt: new Date(nowMs).toISOString(),
  };
}
