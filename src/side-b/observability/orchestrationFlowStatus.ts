/**
 * オーケストレーション各ノード/エッジのライブ状態を算出する純粋関数群。
 *
 * DB/ネットワーク非依存にして単体テスト対象にする (証拠ベース。偽 green を出さないことが最重要)。
 * 状態は「最終活動時刻 (lastActivityMs)」「期待 cadence」「現在時刻」「市場開閉」から導出する。
 */

export type FlowStatus = 'flowing' | 'stale' | 'dead' | 'idle' | 'unknown';

/** cadence の何倍まで「新鮮 (flowing)」とみなすか。 */
const STALE_FACTOR = 2;
/** cadence の何倍を超えたら「死んでる (dead)」とみなすか。 */
const DEAD_FACTOR = 6;
/** cadence 不明 (イベント駆動) ノードの既定しきい値。 */
const DEFAULT_FLOWING_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_DEAD_MS = 7 * 24 * 60 * 60 * 1000; // 7d

export interface NodeStatusInput {
  /** その段の信号が存在するか (false=直接観測手段なし → unknown)。 */
  readonly hasSignal: boolean;
  /** 最終活動時刻 (ms epoch)。信号はあるが活動記録なしの場合 null。 */
  readonly lastActivityMs: number | null;
  /** 期待稼働間隔 (ms)。null=イベント駆動。 */
  readonly expectedCadenceMs: number | null;
  readonly nowMs: number;
  /** 市場開場に依存する段か。 */
  readonly marketDependent: boolean;
  /** 現在 FX 市場が開場しているか。 */
  readonly marketOpen: boolean;
}

/**
 * ノードの状態を導出する。
 * - 信号なし → unknown (偽の green を出さない)
 * - 活動記録なし → 市場依存で閉場中なら idle、期待 cadence があれば dead、無ければ unknown
 * - 活動あり → 経過時間と cadence しきい値で flowing / stale / dead。市場依存×閉場中は stale/dead を idle に緩和。
 */
export function deriveNodeStatus(input: NodeStatusInput): FlowStatus {
  if (!input.hasSignal) return 'unknown';

  const flowingThreshold =
    input.expectedCadenceMs != null ? input.expectedCadenceMs * STALE_FACTOR : DEFAULT_FLOWING_MS;
  const deadThreshold =
    input.expectedCadenceMs != null ? input.expectedCadenceMs * DEAD_FACTOR : DEFAULT_DEAD_MS;

  if (input.lastActivityMs == null) {
    if (input.marketDependent && !input.marketOpen) return 'idle';
    return input.expectedCadenceMs != null ? 'dead' : 'unknown';
  }

  const age = input.nowMs - input.lastActivityMs;
  if (age <= flowingThreshold) return 'flowing';

  // しきい値超過。市場依存で閉場中なら「止まってて当然」= idle。
  if (input.marketDependent && !input.marketOpen) return 'idle';
  return age <= deadThreshold ? 'stale' : 'dead';
}

/**
 * エッジ (ハンドオフ) の状態を上流/下流ノードの状態から導出する。
 * - どちらか unknown → unknown
 * - 上流が flowing なのに下流が dead/stale → broken (ハンドオフが伝播していない疑い)
 * - 下流が flowing → flowing
 * - どちらか idle → idle
 * - それ以外 → stale
 */
export type EdgeStatus = 'flowing' | 'broken' | 'idle' | 'stale' | 'unknown';

export function deriveEdgeStatus(fromStatus: FlowStatus, toStatus: FlowStatus): EdgeStatus {
  if (fromStatus === 'unknown' || toStatus === 'unknown') return 'unknown';
  if (fromStatus === 'flowing' && (toStatus === 'dead' || toStatus === 'stale')) return 'broken';
  if (toStatus === 'flowing') return 'flowing';
  if (fromStatus === 'idle' || toStatus === 'idle') return 'idle';
  return 'stale';
}

/**
 * FX 市場がおおむね開場しているかの簡易判定 (UTC)。
 * FX は日曜 22:00 UTC 頃〜金曜 22:00 UTC 頃。厳密な祝日は見ず、週末クローズのみ反映する
 * (idle 判定を「閉場中は止まってて当然」に使う程度の粒度で十分なため)。
 */
export function isForexLikelyOpen(nowMs: number): boolean {
  const d = new Date(nowMs);
  const day = d.getUTCDay(); // 0=Sun .. 6=Sat
  const hour = d.getUTCHours();
  if (day === 6) return false; // 土曜は終日クローズ
  if (day === 0 && hour < 22) return false; // 日曜 22:00 UTC まではクローズ
  if (day === 5 && hour >= 22) return false; // 金曜 22:00 UTC 以降はクローズ
  return true;
}
