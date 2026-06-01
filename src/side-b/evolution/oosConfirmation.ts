/**
 * OOS-aware 昇格判定（applyOosAwarePromotion）の結果を、EvolutionBacktestRun に
 * 永続化する形（EvolutionOosResultData）へ変換する純粋ヘルパー。
 *
 * 目的:
 *   OOS/WF 検証は計算されていたが「補助 summary として並列出力」されるだけで、
 *   候補ごとに永続化されず UI/API に出ていなかった（= in-sample 合格のみが見えていた）。
 *   ここで候補単位の確証結果を作り、リポジトリに渡して永続化・可視化できるようにする。
 *
 * 方針:
 *   - validation_candidate（= 正式BT in-sample 合格）以外は OOS 対象外のため出力しない。
 *   - confirmed=true は finalStage === 'validation_confirmed'（OOS/WF も通過した「OOS確証」）。
 *   - formalBtPassed の意味論は変えない（本結果は観測の可視化用に並列保持する）。
 */

import type { OosAwarePromotionDecision } from './promotionGatePolicy';
import type { OosValidationResult } from './oosValidationResultMapper';
import type { EvolutionOosResultData } from '../../backend/repositories/evolutionBacktestRunRepository';

/**
 * OOS-aware decision + OOS 観測メトリクスを candidateId / dslId で引ける Map に変換する。
 * 永続化側は candidateId（= dslId）で lookup する。
 */
export function buildOosResultByCandidate(
  decisions: ReadonlyArray<OosAwarePromotionDecision>,
  oosResults: ReadonlyArray<OosValidationResult>,
): Map<string, EvolutionOosResultData> {
  // OOS メトリクス（pf / winRate）を candidateId / dslId 両方で引けるようにする。
  const metricsByKey = new Map<string, OosValidationResult>();
  for (const r of oosResults) {
    if (!metricsByKey.has(r.candidateId)) metricsByKey.set(r.candidateId, r);
    if (r.dslId && !metricsByKey.has(r.dslId)) metricsByKey.set(r.dslId, r);
  }

  const out = new Map<string, EvolutionOosResultData>();
  for (const d of decisions) {
    // validation_candidate（正式BT合格）以外は OOS 評価対象外 → 永続化しない。
    if (d.baseStage !== 'validation_candidate') continue;

    const metrics =
      metricsByKey.get(d.candidateId) ?? (d.dslId ? metricsByKey.get(d.dslId) : undefined);

    const data: EvolutionOosResultData = {
      confirmed: d.finalStage === 'validation_confirmed',
      finalStage: d.finalStage,
      oosStatus: d.oosStatus,
      oosPf: metrics?.oosMetrics?.pf ?? null,
      oosWinRate: metrics?.oosMetrics?.winRate ?? null,
    };
    out.set(d.candidateId, data);
    if (d.dslId) out.set(d.dslId, data);
  }
  return out;
}
