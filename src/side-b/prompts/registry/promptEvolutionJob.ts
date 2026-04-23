/**
 * Phase 6: 月次プロンプト進化ジョブ
 *
 * §3.1.4 の実装:
 *   1. 各エージェントの experimental プロンプトの成績を評価
 *   2. 明確に active を上回るものがあれば昇格候補としてレポート
 *   3. PromptMutationAgent で新実験案を 3 個生成
 *   4. 昇格候補の自動実行は行わない(人間承認フロー = approveCli.ts 経由)
 *
 * autoTriggerPromptEvolution=false が既定。
 * 手動実行は runPromptEvolutionNow() から。
 */

import { PromptRegistry, GLOBAL_AGENT_NAME } from './PromptRegistry';
import type { PromptVersion } from './types';
import { PromptMutationAgent, type RecentFailure } from '../../agents/PromptMutationAgent';

/** 1 エージェント分の進化ジョブ結果。 */
export interface AgentEvolutionReport {
  agentName: string;
  activeId?: string;
  activeAvgScore?: number;
  /** 人間承認待ちの昇格候補(active を有意に上回る experimentals) */
  promotionCandidates: Array<{
    id: string;
    version: string;
    avgScore: number;
    usageCount: number;
    ratio: number;
  }>;
  /** 即時中止(reject)に回された experimental の ID 一覧 */
  rejectedIds: string[];
  /** 新規に登録された experimental の ID 一覧 */
  newExperimentalIds: string[];
  errors: string[];
}

export interface PromptEvolutionResult {
  ranAt: Date;
  reports: AgentEvolutionReport[];
}

export interface PromptEvolutionOptions {
  registry?: PromptRegistry;
  mutationAgent?: PromptMutationAgent;
  /** 昇格候補の判定倍率(既定 1.15、active の avgScore より 15% 以上高いと候補) */
  promotionRatio?: number;
  /** 昇格候補として計上するための最小 usageCount(統計的信頼) */
  minUsageForPromotion?: number;
  /** 生成する新 experimental の数(エージェントあたり、既定 3) */
  proposalsPerAgent?: number;
  /** 直近失敗サンプル取得関数(未指定なら空)。実装は呼び出し側が差し込む。 */
  fetchRecentFailures?: (agentName: string) => Promise<RecentFailure[]>;
  /** バージョン文字列生成関数(テスト用)。既定はタイムスタンプベース。 */
  makeVersion?: (agentName: string, proposalIndex: number) => string;
}

function defaultMakeVersion(_agentName: string, proposalIndex: number): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `mut-${ts}-${proposalIndex}`;
}

/**
 * 全エージェントについて進化サイクルを 1 回実行する。
 *
 * 注意:
 * - 昇格候補は **レポート** として返すだけで、自動では昇格させない(人間承認フロー)
 * - 成績不振の experimental は `registry.reject()` を自動発火
 * - 新 experimental は `status='experimental'` で登録
 */
export async function runPromptEvolutionCycle(
  options: PromptEvolutionOptions = {},
): Promise<PromptEvolutionResult> {
  const registry = options.registry ?? new PromptRegistry();
  const mutationAgent = options.mutationAgent ?? new PromptMutationAgent();
  const promotionRatio = options.promotionRatio ?? 1.15;
  const minUsageForPromotion = options.minUsageForPromotion ?? 20;
  const proposalsPerAgent = options.proposalsPerAgent ?? 3;
  const makeVersion = options.makeVersion ?? defaultMakeVersion;
  const fetchRecentFailures = options.fetchRecentFailures ?? (async () => []);

  const allAgentNames = await registry.listAgents();
  // Phase 6.7a: __global__ はグローバルルール専用で進化サイクル対象外
  const agentNames = allAgentNames.filter((n) => n !== GLOBAL_AGENT_NAME);
  const reports: AgentEvolutionReport[] = [];

  for (const agentName of agentNames) {
    const report: AgentEvolutionReport = {
      agentName,
      promotionCandidates: [],
      rejectedIds: [],
      newExperimentalIds: [],
      errors: [],
    };
    try {
      const active = await registry.getActive(agentName);
      if (!active) {
        report.errors.push('active プロンプトが存在しないため進化サイクルをスキップ');
        reports.push(report);
        continue;
      }
      report.activeId = active.id;
      report.activeAvgScore = active.avgScore;

      const experimentals = await registry.getExperimental(agentName);

      // 1. 昇格候補 / 即時中止の判定
      for (const e of experimentals) {
        if (e.usageCount < minUsageForPromotion) continue;
        // 成績不振 → reject
        if (active.avgScore > 0 && e.avgScore < active.avgScore * 0.7) {
          try {
            await registry.reject(
              e.id,
              `avgScore=${e.avgScore.toFixed(3)} < active=${active.avgScore.toFixed(3)} * 0.7 (usage=${e.usageCount})`,
            );
            report.rejectedIds.push(e.id);
          } catch (err) {
            report.errors.push(`reject 失敗 ${e.id}: ${fmtErr(err)}`);
          }
          continue;
        }
        // 昇格候補
        const ratio = active.avgScore > 0 ? e.avgScore / active.avgScore : 0;
        if (ratio >= promotionRatio) {
          report.promotionCandidates.push({
            id: e.id,
            version: e.version,
            avgScore: e.avgScore,
            usageCount: e.usageCount,
            ratio,
          });
        }
      }

      // 2. 新 experimental の生成(LLM)
      const failures = await fetchRecentFailures(agentName);
      const proposals = await mutationAgent.proposeImprovements({
        agentName,
        currentPrompt: active as PromptVersion,
        recentPerformance: {
          avgScore: active.avgScore,
          recentFailures: failures,
        },
        count: proposalsPerAgent,
      });

      for (let i = 0; i < proposals.length; i++) {
        const p = proposals[i]!;
        try {
          const registered = await registry.register({
            agentName,
            version: makeVersion(agentName, i),
            content: p.content,
            parentVersionId: active.id,
            createdBy: 'mutation',
            status: 'experimental',
            notes: p.notes,
          });
          report.newExperimentalIds.push(registered.id);
        } catch (err) {
          report.errors.push(`register 失敗 (proposal ${i}): ${fmtErr(err)}`);
        }
      }
    } catch (err) {
      report.errors.push(`サイクル失敗: ${fmtErr(err)}`);
    }
    reports.push(report);
  }

  return { ranAt: new Date(), reports };
}

function fmtErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
