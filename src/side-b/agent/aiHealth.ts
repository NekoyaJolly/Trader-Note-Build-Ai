/**
 * AI 呼び出しの健全性シグナル (health signal)。
 *
 * 背景 (2026-06-18): Side-B の AI 層がプロバイダのクォータ枯渇/レート制限で全 429 になっても、
 * 各エージェントは catch して null を返し、ループは「completed・候補0」と*正常に見える*ログを
 * 出すため、「その場では動いてる風→翌日には全然動いてない」が繰り返し起きていた。
 *
 * そこで全 AI 呼び出しの単一計測点 (choke point) である `AIProvider.chat()` で成否を記録し、
 * 「最後に AI が成功した時刻」「直近の失敗率」「連続失敗数」を 1 つの health 状態として
 * 可視化＋閾値超でアラートする。失敗を黙殺させないための基盤。
 *
 * 本モジュールは DB/ネットワーク非依存の純粋ロジック (classify + in-memory レジストリ) とし、
 * 単体テスト対象にする。永続化や通知は呼び出し側 (endpoint / scheduler) が担う。
 */

/** 失敗理由の分類。アラートやダッシュボードで「なぜ落ちたか」を一目で分かるようにする。 */
export type AiCallReason =
  | 'quota' // クォータ/クレジット枯渇 (例: OpenAI insufficient_quota / OpenRouter key limit)
  | 'rate_limit' // 純粋なレート制限 (バックオフで回復しうる)
  | 'auth' // 認証/権限 (401/403)
  | 'server' // プロバイダ側 5xx
  | 'timeout' // タイムアウト
  | 'network' // 接続失敗 (fetch throw)
  | 'bad_response' // 2xx だが形式不正
  | 'other';

export type AiHealthStatus = 'ok' | 'degraded' | 'down' | 'idle';

export interface AiCallRecord {
  at: string; // ISO8601 (UTC)
  ok: boolean;
  model: string;
  status: number | null; // HTTP status (network 失敗時 null)
  reason: AiCallReason | null; // ok のとき null
}

export interface AiHealthSnapshot {
  status: AiHealthStatus;
  total: number;
  success: number;
  failuresByReason: Record<AiCallReason, number>;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: AiCallReason | null;
  lastFailureModel: string | null;
  lastFailureSnippet: string | null;
  recent: AiCallRecord[];
}

// 連続失敗がこの数に達したら「down」とみなしアラートする。
const DOWN_CONSECUTIVE_THRESHOLD = 5;
// recent ウィンドウ内の失敗率がこれを超えたら「degraded」。
const DEGRADED_FAILURE_RATE = 0.5;
// degraded 判定に必要な最小サンプル数 (少数の失敗で過敏にならないため)。
const MIN_SAMPLES_FOR_DEGRADED = 4;
// recent に保持する最大件数。
const RECENT_WINDOW = 50;

const ALL_REASONS: readonly AiCallReason[] = [
  'quota',
  'rate_limit',
  'auth',
  'server',
  'timeout',
  'network',
  'bad_response',
  'other',
];

/**
 * HTTP status + レスポンス本文から失敗理由を分類する (純粋関数)。
 * status=null は fetch 自体が throw した接続失敗 (network)。
 */
export function classifyAiFailure(status: number | null, body: string): AiCallReason {
  if (status === null) return 'network';
  if (status === 429) {
    // 429 でも「クォータ枯渇 (回復に課金が必要)」と「レート制限 (バックオフで回復)」は別物。
    // 本文で判別する: OpenAI=insufficient_quota / OpenRouter=key limit exceeded / billing 文言。
    if (/insufficient_quota|exceeded your current quota|key limit exceeded|billing|out of credits/i.test(body)) {
      return 'quota';
    }
    return 'rate_limit';
  }
  if (status === 401 || status === 403) {
    // 403 でも OpenRouter のキー上限超過はクォータ系。
    if (/key limit exceeded|quota|billing|credit/i.test(body)) return 'quota';
    return 'auth';
  }
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'server';
  return 'other';
}

function emptyReasonCounts(): Record<AiCallReason, number> {
  const out = {} as Record<AiCallReason, number>;
  for (const r of ALL_REASONS) out[r] = 0;
  return out;
}

interface MutableState {
  total: number;
  success: number;
  failuresByReason: Record<AiCallReason, number>;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: AiCallReason | null;
  lastFailureModel: string | null;
  lastFailureSnippet: string | null;
  recent: AiCallRecord[];
}

const state: MutableState = {
  total: 0,
  success: 0,
  failuresByReason: emptyReasonCounts(),
  consecutiveFailures: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastFailureReason: null,
  lastFailureModel: null,
  lastFailureSnippet: null,
  recent: [],
};

function pushRecent(rec: AiCallRecord): void {
  state.recent.push(rec);
  if (state.recent.length > RECENT_WINDOW) {
    state.recent.splice(0, state.recent.length - RECENT_WINDOW);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

/** AI 呼び出し成功を記録する。 */
export function recordAiSuccess(input: { model: string }): void {
  state.total += 1;
  state.success += 1;
  state.consecutiveFailures = 0;
  state.lastSuccessAt = nowIso();
  pushRecent({ at: state.lastSuccessAt, ok: true, model: input.model, status: 200, reason: null });
}

/** AI 呼び出し失敗を記録する。連続失敗が閾値に達した瞬間にアラートログを出す。 */
export function recordAiFailure(input: { status: number | null; body: string; model: string }): void {
  const reason = classifyAiFailure(input.status, input.body);
  state.total += 1;
  state.failuresByReason[reason] += 1;
  state.consecutiveFailures += 1;
  state.lastFailureAt = nowIso();
  state.lastFailureReason = reason;
  state.lastFailureModel = input.model;
  state.lastFailureSnippet = input.body.slice(0, 200);
  pushRecent({ at: state.lastFailureAt, ok: false, model: input.model, status: input.status, reason });

  // 黙殺させない: 失敗は必ず構造化ログに出す。
  console.warn(
    `[AIHealth] fail reason=${reason} status=${input.status ?? 'null'} model=${input.model} consecutive=${state.consecutiveFailures}`,
  );
  // 連続失敗が閾値に「到達した瞬間」だけ大きくアラート (毎回は出さない)。
  if (state.consecutiveFailures === DOWN_CONSECUTIVE_THRESHOLD) {
    console.error(
      `[AIHealth][ALERT] AI 層が DOWN の可能性: 連続 ${state.consecutiveFailures} 失敗 reason=${reason} model=${input.model}. ` +
        `最後の成功=${state.lastSuccessAt ?? 'なし'}. 直近本文=${state.lastFailureSnippet ?? ''}`,
  );
  }
}

function computeStatus(s: MutableState): AiHealthStatus {
  if (s.total === 0) return 'idle';
  if (s.consecutiveFailures >= DOWN_CONSECUTIVE_THRESHOLD) return 'down';
  if (s.recent.length >= MIN_SAMPLES_FOR_DEGRADED) {
    const fails = s.recent.filter((r) => !r.ok).length;
    if (fails / s.recent.length >= DEGRADED_FAILURE_RATE) return 'degraded';
  }
  return 'ok';
}

/** 現在の health 状態のスナップショットを返す (endpoint / 監視から参照)。 */
export function getAiHealthSnapshot(): AiHealthSnapshot {
  return {
    status: computeStatus(state),
    total: state.total,
    success: state.success,
    failuresByReason: { ...state.failuresByReason },
    consecutiveFailures: state.consecutiveFailures,
    lastSuccessAt: state.lastSuccessAt,
    lastFailureAt: state.lastFailureAt,
    lastFailureReason: state.lastFailureReason,
    lastFailureModel: state.lastFailureModel,
    lastFailureSnippet: state.lastFailureSnippet,
    recent: [...state.recent],
  };
}

/** テスト用にレジストリを初期化する。 */
export function resetAiHealth(): void {
  state.total = 0;
  state.success = 0;
  state.failuresByReason = emptyReasonCounts();
  state.consecutiveFailures = 0;
  state.lastSuccessAt = null;
  state.lastFailureAt = null;
  state.lastFailureReason = null;
  state.lastFailureModel = null;
  state.lastFailureSnippet = null;
  state.recent = [];
}
