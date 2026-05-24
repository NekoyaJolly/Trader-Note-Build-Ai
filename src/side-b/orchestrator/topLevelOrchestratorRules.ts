/**
 * Top-Level Orchestrator 禁止事項 7 ルール (Phase B+ 2026-05-24)
 *
 * 設計書: `docs/architecture/TOP_LEVEL_ORCHESTRATOR_DESIGN.md` §1.4
 *
 * 純粋関数のみで構成 (= 副作用なし・I/O なし)。各 check は input 由来の値を
 * 受け取って `{ blocked: bool, blockedActions: Set, reason }` を返す。
 *
 * これら 7 ルールは LLM 判断の **前後で機械的に enforce** される:
 *   - 入力収集時 (= 強制 'wait' / blockedActions 抽出): #1 / #3 / #4 / #6
 *   - LLM 判断結果受領後: #2
 *   - 出力直後: #7 (= ADK trace 記録、別 module で実装)
 *
 * 連続 3 fatal / 連打 / 競合 / 肥大化 を LLM 裁量に頼らず機械的に防ぐことで、
 * 旧 AgentLoop の轍 (= 自走暴走) と BabyAGI hallucination loop の轍を回避する。
 */

import type { TopLevelAction } from './topLevelOrchestrator';

// ==========================================
// 入力型 (= Rules 評価に必要な最小情報、Orchestrator 本体から渡される)
// ==========================================

export interface RuleEvaluationInput {
  /** 直近 24h の AgentRun (= Top-Level Orchestrator 自身の履歴) */
  recentAgentRuns: Array<{
    finishedAt: Date | null;
    status: 'running' | 'completed' | 'failed' | 'blocked';
    /** Top-Level Orchestrator の AgentRun かどうか (= agentName でフィルタ済前提) */
    isFatal: boolean;
  }>;
  /** EdgeHypothesis の status 別件数 */
  edgeLedgerByStatus: Record<string, number>;
  /** 今この瞬間 (= now、testable にするため引数化) */
  now: Date;
}

export interface RuleEvaluationResult {
  /** true なら 'wait' に強制 (= LLM 呼び出しすらしない) */
  strictBlocked: boolean;
  /** strictBlocked の理由 (= 日本語、log 用) */
  strictBlockedReason?: string;
  /** LLM が選択不可な action の集合 (= LLM 入力に渡す blockedActions) */
  blockedActions: Set<TopLevelAction>;
  /** blockedActions に入れた理由の map (= log 用) */
  blockedReasons: Record<string, string>;
}

// ==========================================
// 個別ルール (= 純粋関数)
// ==========================================

/**
 * Rule #1: 連続 3 サイクル fatal error → 強制 'wait'
 *
 * 旧 AgentLoop / BabyAGI の轍を踏まないため、連続失敗時は自動停止する。
 * recentAgentRuns は時系列降順 (= 直近 first) を前提。
 */
export function checkConsecutiveFatalErrors(
  recentAgentRuns: RuleEvaluationInput['recentAgentRuns'],
): { blocked: boolean; reason?: string } {
  if (recentAgentRuns.length < 3) {
    return { blocked: false };
  }
  // 直近 3 件すべて fatal なら blocked
  const last3 = recentAgentRuns.slice(0, 3);
  const allFatal = last3.every((r) => r.isFatal);
  if (allFatal) {
    return {
      blocked: true,
      reason: '連続 3 サイクル fatal error 検出、Top-Level Orchestrator を一時停止します',
    };
  }
  return { blocked: false };
}

/**
 * Rule #2: LLM 推定トークン > 100k → 強制 'wait' (= LLM 判断結果受領後の check)
 *
 * 旧 AgentLoop の文脈肥大の轍を踏まないため、Top-Level Orchestrator が
 * 大量トークンを消費しそうなら停止する。本判定は LLM 呼び出し後に行う
 * (= 実消費後の usage を見るのが理想だが、簡易版は事前推定)。
 */
export function checkLlmTokenBudget(estimatedTokens: number): {
  blocked: boolean;
  reason?: string;
} {
  const LIMIT = 100_000;
  if (estimatedTokens > LIMIT) {
    return {
      blocked: true,
      reason: `LLM トークン推定 ${estimatedTokens} > ${LIMIT}、Top-Level Orchestrator を停止します`,
    };
  }
  return { blocked: false };
}

/**
 * Rule #3: 1h に 4 回以上起動 → 強制 'wait'
 *
 * 連打 / 暴走を防ぐ。recentAgentRuns の **finishedAt** から 1h 以内の件数を数える
 * (PR #248 Copilot review #12 対応: コメントと実装を finishedAt 基準で統一)。
 * `running` 中 (= finishedAt=null) の run はここではカウントされない (= 競合は
 * 別 rule #6 で別途強制 'wait' される)。
 * デフォルト上限は env `TOP_LEVEL_ORCHESTRATOR_RATE_LIMIT_PER_HOUR` で可変 (default 3、
 * = 4 回目以降を拒否)。
 */
export function checkRateLimit(
  recentAgentRuns: RuleEvaluationInput['recentAgentRuns'],
  now: Date,
  limitPerHour: number = 3,
): { blocked: boolean; reason?: string } {
  const oneHourAgoMs = now.getTime() - 60 * 60 * 1000;
  // finishedAt 基準で直近 1h に完了した run の件数を数える (PR #248 Copilot review #12)。
  // finishedAt=null (= running 中) は別 rule #6 (checkManualJobRunning) で扱うため、
  // ここではカウントしない。
  const recentCount = recentAgentRuns.filter(
    (r) => r.finishedAt && r.finishedAt.getTime() >= oneHourAgoMs,
  ).length;
  if (recentCount >= limitPerHour) {
    return {
      blocked: true,
      reason: `直近 1h 起動回数 ${recentCount} >= ${limitPerHour}、連打防止で 'wait' に切替`,
    };
  }
  return { blocked: false };
}

/**
 * Rule #4: EdgeHypothesis 1000 件超で滞留 → 'create_hypothesis' を blockedActions に
 *
 * 仮説肥大化を防ぐ。LLM 自身に「既存処理 (= advance_validation / run_evolution) を
 * 優先せよ」と促す。strictBlocked にはしない (= LLM 判断は許可、選択肢だけ絞る)。
 */
export function checkEdgeHypothesisCapacity(
  edgeLedgerByStatus: Record<string, number>,
): { blocked: boolean; reason?: string } {
  const total = Object.values(edgeLedgerByStatus).reduce((sum, n) => sum + n, 0);
  const LIMIT = 1000;
  if (total > LIMIT) {
    return {
      blocked: true,
      reason: `EdgeHypothesis 合計 ${total} > ${LIMIT}、'create_hypothesis' を不可リストに追加 (= 既存処理優先)`,
    };
  }
  return { blocked: false };
}

/**
 * Rule #6: 手動実行が進行中 (= AgentRun に running 状態あり) → 強制 'wait'
 *
 * Orchestrator 自身の running を含めるかは呼出側で制御 (= recentAgentRuns には
 * 自身を含めない前提)。手動実行と Orchestrator 並走時の競合を防ぐ。
 */
export function checkManualJobRunning(
  recentAgentRuns: RuleEvaluationInput['recentAgentRuns'],
): { blocked: boolean; reason?: string } {
  const hasRunning = recentAgentRuns.some((r) => r.status === 'running');
  if (hasRunning) {
    return {
      blocked: true,
      reason: "手動実行 / 別 Job が running 中、競合防止で 'wait' に切替",
    };
  }
  return { blocked: false };
}

// ==========================================
// 統合評価 (= 上記ルールをまとめて実行)
// ==========================================

/**
 * 入力時点 (= LLM 呼び出し前) の禁止事項を全て評価する。
 *
 * - #1 / #3 / #6 は strictBlocked (= 強制 'wait')
 * - #4 は blockedActions に追加 (= LLM 判断は許可、選択肢だけ絞る)
 * - #2 / #7 は本関数では評価しない (= LLM 呼び出し後 / 出力直後)
 */
export function evaluateInputRules(
  input: RuleEvaluationInput,
  rateLimitPerHour: number = 3,
): RuleEvaluationResult {
  const blockedActions = new Set<TopLevelAction>();
  const blockedReasons: Record<string, string> = {};

  // #1: 連続 3 fatal
  const r1 = checkConsecutiveFatalErrors(input.recentAgentRuns);
  if (r1.blocked) {
    return {
      strictBlocked: true,
      strictBlockedReason: r1.reason,
      blockedActions,
      blockedReasons,
    };
  }

  // #6: 手動 running
  const r6 = checkManualJobRunning(input.recentAgentRuns);
  if (r6.blocked) {
    return {
      strictBlocked: true,
      strictBlockedReason: r6.reason,
      blockedActions,
      blockedReasons,
    };
  }

  // #3: 連打防止
  const r3 = checkRateLimit(input.recentAgentRuns, input.now, rateLimitPerHour);
  if (r3.blocked) {
    return {
      strictBlocked: true,
      strictBlockedReason: r3.reason,
      blockedActions,
      blockedReasons,
    };
  }

  // #4: 仮説肥大化 (= blockedActions のみ、strictBlocked にしない)
  const r4 = checkEdgeHypothesisCapacity(input.edgeLedgerByStatus);
  if (r4.blocked && r4.reason) {
    blockedActions.add('create_hypothesis');
    blockedReasons['create_hypothesis'] = r4.reason;
  }

  return { strictBlocked: false, blockedActions, blockedReasons };
}
