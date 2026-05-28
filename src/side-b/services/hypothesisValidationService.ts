/**
 * 仮説本格検証サービス (Step D-1)
 *
 * 旧 StrategistAgent (Phase 4c Step E) を置き換える決定論サービス。
 *
 * 設計変更 (Step D-1, Side-B Action 再設計):
 * - StrategistAgent は「BacktesterAgent 実行 + StatusManager 決定論判定 + LLM 解釈」だったが、
 *   昇格/棄却の判定はもともと StatusManager の決定論ロジックで完結しており、LLM は
 *   解釈の言語化 (best-effort) のみだった。
 * - 再設計方針 (Nekoさん 確定): confirmed/rejected は BT メトリクスで機械判定するため、
 *   LLM 解釈を撤廃し決定論サービスに一本化する。Action フローの戦略組成は HypothesisGenerator、
 *   評価は本サービス (= BT メトリクス機械判定) が担う。
 *
 * @see docs/diagnostics/side_b_agent_map_2026-05-27.html
 */

import type {
  ConsolidatedValidationReport,
} from '../models/edgeHypothesis';
import { edgeLedger as defaultEdgeLedger, type EdgeLedger } from '../ledger/EdgeLedger';
import { statusManager as defaultStatusManager, type StatusManager } from '../ledger/statusManager';
import { BacktesterAgent } from '../agents/BacktesterAgent';

export type PromotionVerdictType =
  | 'confirmed'
  | 'rejected'
  | 'insufficient_data'
  | 'not_testable';

export interface PromotionVerdict {
  verdict: PromotionVerdictType;
  hypothesisId: string;
  /** not_testable / insufficient_data の場合は undefined */
  report?: ConsolidatedValidationReport;
  /** 決定論的判定の理由群（棄却時は複数、通過時は空） */
  baseCriteriaReasons: string[];
  decidedAt: Date;
}

export interface HypothesisValidationOptions {
  /** 検証対象期間（既定: 直近1年） */
  period?: { start: string; end: string };
}

/**
 * テスト差し替え用の依存性注入。未指定時は既定の実装を使う。
 * 本サービスが実際に使うメソッドのみ Pick で要求 (= テスト mock が型契約を満たしやすく、
 * `as any` を避けられる)。
 */
export interface HypothesisValidationDeps {
  edgeLedger?: Pick<
    EdgeLedger,
    'get' | 'markTesting' | 'markNotTestable' | 'markConfirmedFull' | 'markRejectedFull'
  >;
  backtester?: Pick<BacktesterAgent, 'runFullValidation'>;
  statusManager?: Pick<StatusManager, 'canPromoteToConfirmedFull'>;
}

function buildVerdict(
  verdict: PromotionVerdictType,
  hypothesisId: string,
  report: ConsolidatedValidationReport | undefined,
  baseCriteriaReasons: string[],
): PromotionVerdict {
  return {
    verdict,
    hypothesisId,
    report,
    baseCriteriaReasons,
    decidedAt: new Date(),
  };
}

function defaultPeriod(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 1);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

/**
 * 仮説を本格検証し、confirmed / rejected / not_testable のいずれかに遷移させて
 * PromotionVerdict を返す。判定は BacktesterAgent の統合レポート + StatusManager の
 * 決定論ロジックのみで行う (LLM は使わない)。
 *
 * 前提:
 *   - hypothesis.status === 'screening_passed' (screening 通過)
 *   - hypothesis.screeningResult.screeningBacktestRunId が設定済み
 */
export async function validateHypothesis(
  hypothesisId: string,
  options: HypothesisValidationOptions = {},
  deps: HypothesisValidationDeps = {},
): Promise<PromotionVerdict> {
  const edgeLedger = deps.edgeLedger ?? defaultEdgeLedger;
  const backtester = deps.backtester ?? new BacktesterAgent();
  const statusManager = deps.statusManager ?? defaultStatusManager;

  const hypothesis = await edgeLedger.get(hypothesisId);
  if (!hypothesis) {
    throw new Error(`Hypothesis not found: ${hypothesisId}`);
  }

  const period = options.period ?? defaultPeriod();
  const screeningBacktestRunId = hypothesis.screeningResult?.screeningBacktestRunId;
  if (!screeningBacktestRunId) {
    const reason =
      'screeningBacktestRunId が無い (screening 未通過か、analysis-engine 経由の BT 実行失敗)';
    await edgeLedger.markNotTestable(hypothesisId, reason);
    return buildVerdict('not_testable', hypothesisId, undefined, [reason]);
  }

  // testing に遷移
  await edgeLedger.markTesting(hypothesisId);

  let report: ConsolidatedValidationReport;
  try {
    report = await backtester.runFullValidation(hypothesis, screeningBacktestRunId, period);
  } catch (err) {
    const reason = `BacktesterAgent 実行失敗: ${err instanceof Error ? err.message : String(err)}`;
    await edgeLedger.markNotTestable(hypothesisId, reason);
    return buildVerdict('not_testable', hypothesisId, undefined, [reason]);
  }

  const check = statusManager.canPromoteToConfirmedFull(hypothesis, report);

  if (check.ok) {
    await edgeLedger.markConfirmedFull(hypothesisId, report);
    return buildVerdict('confirmed', hypothesisId, report, check.reasons);
  }

  await edgeLedger.markRejectedFull(hypothesisId, check.reasons.join('; '), report);
  return buildVerdict('rejected', hypothesisId, report, check.reasons);
}
