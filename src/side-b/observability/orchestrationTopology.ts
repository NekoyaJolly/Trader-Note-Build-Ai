/**
 * Side-B オーケストレーションのトポロジ定義 (静的)。
 *
 * 目的: 「10+ エージェントが個々に機能しているか分からない」を解消するため、エージェント=ノード /
 * ハンドオフ=エッジ のグラフを 1 箇所に定義する。各ノードには「生死」を測るドメイン信号
 * (`signal`) と期待 cadence を持たせ、orchestrationFlowService がライブ状態を導出する。
 *
 * 設計メモ: run ledger (AgentRun) は ADK フラグ ON 時かつ一部 job しか書かないため、状態は
 * できるだけ各段のドメインテーブル (ResearchOutput / AITradePlan / EdgeHypothesis / ...) の
 * 最終更新時刻から導出する。直接信号が無いノード (PDCA など) は正直に 'unknown' を出す。
 */

/** 各ノードのライブ状態を測る信号の種類。service 側が対応する最終活動時刻を解決する。 */
export type FlowSignalKey =
  | 'top_level' // AgentRun kind='top_level_orchestrator'
  | 'research' // ResearchOutput.createdAt
  | 'plan' // AITradePlan.createdAt
  | 'virtual_trade' // VirtualTrade.createdAt
  | 'trade_exit' // VirtualTrade.exitedAt (監視→決済)
  | 'discovery' // EdgeHypothesis (source: discovery)
  | 'hypothesis' // EdgeHypothesis (source: ai_generated 等)
  | 'screening' // EdgeHypothesis statusUpdatedAt (status=testing/screening*)
  | 'validation' // EdgeHypothesis (confirmed/rejected) statusUpdatedAt
  | 'evolution' // EvolutionBacktestRun.createdAt
  | 'edge_confirmed' // EdgeHypothesis (status=confirmed)
  | 'materialization' // TradeNote.createdAt (Side-A)
  | 'ai_layer' // aiHealth snapshot (横断)
  | 'none'; // 直接信号なし (PDCA 等) → unknown

export type FlowNodeGroup = 'decision' | 'pipeline' | 'evolution' | 'gate' | 'hub' | 'cross';

export interface FlowNodeDef {
  readonly id: string;
  readonly label: string;
  readonly group: FlowNodeGroup;
  readonly signal: FlowSignalKey;
  /** 期待される稼働間隔 (ms)。null = イベント駆動で固定 cadence なし。 */
  readonly expectedCadenceMs: number | null;
  /** 市場開場に依存する段か (閉場中の無活動を dead でなく idle と扱うため)。 */
  readonly marketDependent: boolean;
  /** ノードが期待する入力/出力の短い説明 (ハンドオフ妥当性の人間向け表示)。 */
  readonly produces: string;
}

export interface FlowEdgeDef {
  readonly from: string;
  readonly to: string;
  readonly label: string;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const FLOW_NODES: readonly FlowNodeDef[] = [
  { id: 'top_level_orchestrator', label: 'Top-Level Orchestrator', group: 'decision', signal: 'top_level', expectedCadenceMs: 4 * HOUR, marketDependent: false, produces: '次に回すループの判断' },
  { id: 'research', label: 'Research', group: 'pipeline', signal: 'research', expectedCadenceMs: 4 * HOUR, marketDependent: true, produces: 'ResearchOutput (市場分析)' },
  { id: 'plan', label: 'Plan', group: 'pipeline', signal: 'plan', expectedCadenceMs: 4 * HOUR, marketDependent: true, produces: 'AITradePlan (シナリオ)' },
  { id: 'virtual_trade', label: 'Virtual Trade', group: 'pipeline', signal: 'virtual_trade', expectedCadenceMs: null, marketDependent: true, produces: '仮想トレード (pending)' },
  { id: 'trade_monitoring', label: 'Trade Monitoring', group: 'pipeline', signal: 'trade_exit', expectedCadenceMs: HOUR, marketDependent: true, produces: '建玉の open/close 遷移' },
  { id: 'discovery', label: 'Discovery', group: 'evolution', signal: 'discovery', expectedCadenceMs: DAY, marketDependent: false, produces: 'ノートからの仮説/レンズ示唆' },
  { id: 'hypothesis_generator', label: 'Hypothesis Gen', group: 'evolution', signal: 'hypothesis', expectedCadenceMs: DAY, marketDependent: false, produces: 'EdgeHypothesis (unverified)' },
  { id: 'screening', label: 'Screening', group: 'evolution', signal: 'screening', expectedCadenceMs: DAY, marketDependent: false, produces: 'screening 判定 (testing/rejected)' },
  { id: 'full_validation', label: 'Full Validation', group: 'evolution', signal: 'validation', expectedCadenceMs: DAY, marketDependent: false, produces: 'confirmed/rejected 判定' },
  { id: 'evolution', label: 'Evolution', group: 'evolution', signal: 'evolution', expectedCadenceMs: DAY, marketDependent: false, produces: 'EvolutionBacktestRun (候補)' },
  { id: 'edge_ledger', label: 'Edge Ledger', group: 'gate', signal: 'edge_confirmed', expectedCadenceMs: null, marketDependent: false, produces: 'confirmed エッジ (決定論ゲート)' },
  { id: 'materialization', label: 'Materialization → Side-A', group: 'gate', signal: 'materialization', expectedCadenceMs: null, marketDependent: false, produces: 'TradeNote (Side-A)' },
  { id: 'pdca', label: 'PDCA Loop', group: 'hub', signal: 'none', expectedCadenceMs: null, marketDependent: false, produces: '状態機械 (in-memory・直接信号なし)' },
  { id: 'ai_layer', label: 'AI Layer (LLM)', group: 'cross', signal: 'ai_layer', expectedCadenceMs: null, marketDependent: false, produces: '全エージェント共有の LLM 呼び出し' },
] as const;

export const FLOW_EDGES: readonly FlowEdgeDef[] = [
  { from: 'top_level_orchestrator', to: 'research', label: 'dispatch' },
  { from: 'top_level_orchestrator', to: 'discovery', label: 'dispatch' },
  { from: 'top_level_orchestrator', to: 'screening', label: 'dispatch' },
  { from: 'top_level_orchestrator', to: 'full_validation', label: 'dispatch' },
  { from: 'top_level_orchestrator', to: 'evolution', label: 'dispatch' },
  { from: 'research', to: 'plan', label: 'ResearchOutput' },
  { from: 'plan', to: 'virtual_trade', label: 'シナリオ→発注' },
  { from: 'virtual_trade', to: 'trade_monitoring', label: '建玉' },
  { from: 'trade_monitoring', to: 'discovery', label: '決済ノート' },
  { from: 'discovery', to: 'hypothesis_generator', label: '仮説素材' },
  { from: 'hypothesis_generator', to: 'screening', label: 'unverified' },
  { from: 'screening', to: 'full_validation', label: 'testing' },
  { from: 'full_validation', to: 'edge_ledger', label: 'confirmed 判定' },
  { from: 'evolution', to: 'edge_ledger', label: '候補' },
  { from: 'edge_ledger', to: 'materialization', label: '昇格' },
  // PDCA はハブとして主要段から notify を受ける
  { from: 'plan', to: 'pdca', label: 'notify' },
  { from: 'trade_monitoring', to: 'pdca', label: 'notify' },
  { from: 'full_validation', to: 'pdca', label: 'notify' },
  { from: 'evolution', to: 'pdca', label: 'notify' },
] as const;
