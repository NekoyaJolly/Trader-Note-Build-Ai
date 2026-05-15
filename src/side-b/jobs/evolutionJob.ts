/**
 * Evolution Job
 *
 * SideBScheduler 責務分離リファクタリング (PR-1) で sideBScheduler.ts から切り出した
 * 進化ループ系の業務処理。
 *
 * 移行元:
 * - sideBScheduler.ts の `runEvolutionNow()` (約 127 行)
 * - 同 `runEvolutionMultiGen()` (約 38 行)
 * - 同 `notifyPdcaEvolutionGeneration()` (約 20 行)
 * - 同 `runEvolutionCarryRetentionNow()` (約 18 行)
 * - 同 `parseStrictInt` / `parseStrictBool` / `readEvolutionEnvOverrides` (env 解釈 約 93 行)
 * - 同 `EVOLUTION_CARRY_RETENTION_DAYS` 定数
 *
 * 既存挙動互換のため、ログ文言・PDCA 通知 key・clamp 範囲・env 解釈の warning 文言は
 * すべて維持する。`evolutionMultiGen.test.ts` (22 ケース) と
 * `evolutionCarryRetention.test.ts` (5 ケース) を通すことが完了条件。
 *
 * 設計書: docs/side-b/sideb_scheduler_refactor_agent_prompt.md Phase 2
 */

import path from 'path';
import { randomUUID } from 'crypto';

import { pdcaLoop } from '../agent';
import { CrossoverAgent } from '../agents/CrossoverAgent';
import { MutationAgent } from '../agents/MutationAgent';
import { DiversityEnforcer } from '../evolution/DiversityEnforcer';
import { EvolutionLoop, type GenerationReport } from '../evolution/EvolutionLoop';
import { defaultOosBacktestRunner } from '../evolution/analysisEngineRobustnessAdapter';
import {
  MULTI_GENERATION_DEFAULTS,
  runMultiGenerationEvolutionV1,
  type MultiGenerationRunReport,
} from '../evolution/multiGenerationRunner';
import { evolutionInstanceCarryRepository } from '../../backend/repositories/evolutionInstanceCarryRepository';
import { generationReflectionAgent } from '../agents/GenerationReflectionAgent';
import { generationLessonRepository } from '../../backend/repositories/generationLessonRepository';
import { StrategyPopulation } from '../evolution/StrategyPopulation';
import { SurrogateFitnessSimulator } from '../strategy_dsl/SurrogateFitnessSimulator';

import type { SideBJobDeps, SideBJobName, SideBJobRunner } from './types';
import type { SideBSchedulerConfig } from './sideBScheduler';
// PR #159 Copilot review #3 対応: 純粋関数 / 定数を別ファイルに分離 (テスト軽量化)
import {
  EVOLUTION_CARRY_RETENTION_DAYS,
  DEFAULT_EVOLUTION_REGIMES,
  clampEvolutionGenerations,
} from './evolutionJobConfig';

// 再 export: 既存の import 互換維持 (`import { EVOLUTION_CARRY_RETENTION_DAYS } from './evolutionJob'` 等)
export {
  EVOLUTION_CARRY_RETENTION_DAYS,
  DEFAULT_EVOLUTION_REGIMES,
  readEvolutionEnvOverrides,
  clampEvolutionGenerations,
} from './evolutionJobConfig';

/**
 * EvolutionJob の戻り値型。
 *
 * sideBScheduler.ts の `runEvolutionNow()` 戻り値と完全互換を保つため、
 * フィールド名・型を変更しない。
 */
export interface EvolutionJobResult {
  regimeReports: number;
  errors: string[];
}

/**
 * EvolutionJob.runCarryRetention() の戻り値型。
 *
 * 旧 `runEvolutionCarryRetentionNow()` と完全互換。
 */
export interface EvolutionCarryRetentionResult {
  deleted: number;
  error?: string;
}

// 環境変数解釈ヘルパー (parseStrictInt / parseStrictBool / readEvolutionEnvOverrides) は
// `./evolutionJobConfig.ts` に分離 (PR #159 Copilot review #3 対応、テスト軽量化)。
// 本ファイルからは上記の re-export 経由で参照可能。

// ============================================================================
// EvolutionJob 本体
// ============================================================================

/**
 * 進化ループの実行を担当する Job。
 *
 * SideBScheduler から依存注入 (SideBJobDeps) を受け取り、Scheduler の private state
 * (errors[], log 経路) には直接触らない。Scheduler は本 Job のインスタンスを保持し、
 * `runEvolutionNow()` / `runEvolutionCarryRetentionNow()` を delegation する。
 */
export class EvolutionJob implements SideBJobRunner<SideBSchedulerConfig, EvolutionJobResult> {
  readonly name: SideBJobName = 'evolution';

  private readonly deps: SideBJobDeps;
  /**
   * 最終実行日時の更新を Scheduler 側に伝えるためのコールバック。
   * Scheduler の `lastEvolutionRun` フィールドを更新する。
   */
  private readonly onCompleted?: (completedAt: Date) => void;

  constructor(deps: SideBJobDeps, options: { onCompleted?: (completedAt: Date) => void } = {}) {
    this.deps = deps;
    this.onCompleted = options.onCompleted;
  }

  /**
   * 進化ループ本体。旧 `SideBScheduler.runEvolutionNow()` の中身を完全互換で実装。
   *
   * 戻り値形 `{ regimeReports: number; errors: string[] }` は変更しない。
   * 既存テスト `evolutionMultiGen.test.ts` が直接検証している。
   */
  async run(config: SideBSchedulerConfig): Promise<EvolutionJobResult> {
    const regimes = config.evolutionRegimes?.length
      ? config.evolutionRegimes
      : [...DEFAULT_EVOLUTION_REGIMES];
    const persistPath = path.join(process.cwd(), 'data', 'evolution', 'strategy-population.json');
    const population = new StrategyPopulation(persistPath);
    await population.load();

    const end = new Date();
    const start = new Date(end.getTime() - 365 * 24 * 60 * 60 * 1000);
    const defaultPeriod = {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };

    // Phase 5A: EdgeLedger への自動登録は撤廃（候補抽出のみ）
    // PR #110: 本番 scheduler では analysis-engine `/v1/oos-validation` を叩く
    //   `defaultOosBacktestRunner` を注入し、validation_candidate に対する OOS 観測を
    //   実データで動かす (= validation_confirmed / oos_passed / oos_failed が trend に出る)
    const loop = new EvolutionLoop({
      population,
      adapter: new SurrogateFitnessSimulator(),
      mutationAgent: new MutationAgent(),
      crossoverAgent: new CrossoverAgent(),
      enforcer: new DiversityEnforcer(),
      defaultPeriod,
      oosBacktestRunner: defaultOosBacktestRunner,
      // Phase B-2 (2026-05-09): cron 起動を跨いだ in-memory cache 復元を有効化。
      evolutionInstanceCarryRepo: evolutionInstanceCarryRepository,
      // STEP 5 段階 2 Phase C C-1 (2026-05-15): scheduler config の symbols[0] /
      // timeframe を novelty seed に伝播させる。これがないと seedDescriptor の
      // default `'EURUSD'` / `'15m'` で固定され、本番 XAU/USD 運用と乖離する。
      symbol: config.symbols[0],
      timeframe: config.timeframe,
    });

    // configOverride 経由で 0 や maxGenerations 超過の値が渡されたときの clamp。
    // PR #159 Copilot review #1 対応: NaN / Infinity も Job 入口で 1 に fallback。
    const rawGenerations = config.evolutionGenerations ?? 1;
    const generations = clampEvolutionGenerations(rawGenerations);
    if (generations !== rawGenerations) {
      this.deps.log(
        `[Evolution] 設定 evolutionGenerations=${rawGenerations} を [1, ${MULTI_GENERATION_DEFAULTS.maxGenerations}] に clamp して ${generations} で実行`,
      );
    }
    const useMultiGen = generations >= 2;
    const errors: string[] = [];
    let n = 0;
    this.deps.log(
      `[Evolution] 進化ループ開始: ${regimes.length} レジーム, ` +
        `期間 ${defaultPeriod.start}〜${defaultPeriod.end}, ` +
        `世代数=${generations} (${useMultiGen ? 'multi-gen' : 'single-gen'}), ` +
        `adaptive=${config.evolutionAdaptiveBudget} qd=${config.evolutionQDArchive}`,
    );

    for (let i = 0; i < regimes.length; i++) {
      const regime = regimes[i];
      try {
        if (useMultiGen) {
          const runReport = await this.runMultiGen(loop, regime, generations, config);
          // multi-gen runner の trend summary をログに残す + 個別 generation report も流す
          for (const g of runReport.generations) {
            n++;
            if (g.report) {
              this.deps.log(
                `[Evolution] regime=${regime} gen=${g.generationIndex + 1}/${generations} ` +
                  `elites=${g.report.eliteIds.length} mut=${g.report.mutantsReceived} ` +
                  `cross=${g.report.crossoversReceived} ` +
                  `candidates=${g.report.promotionCandidates.length} ` +
                  `divBoost=${g.report.lowDiversityBoost} status=${g.status}`,
              );
              if (g.report.errors.length > 0) errors.push(...g.report.errors);
              // Phase E (2026-05-09): 各世代終了時に PDCA に通知して実 loop の thinking log に記録。
              // 例外は飲んで世代結果に影響させない。
              this.notifyPdcaEvolutionGeneration(
                regime,
                g.generationIndex,
                generations,
                g.report,
              );
            } else {
              this.deps.log(
                `[Evolution] regime=${regime} gen=${g.generationIndex + 1}/${generations} ` +
                  `status=${g.status} error=${g.errorMessage ?? 'unknown'}`,
              );
              if (g.errorMessage) errors.push(`${regime} gen ${g.generationIndex + 1}: ${g.errorMessage}`);
            }
          }
          this.deps.log(
            `[Evolution] regime=${regime} multi-gen trend: ` +
              `formalBtPassed=[${runReport.trendSummary.formalBtPassedByGeneration.join(',')}] ` +
              `validationConfirmed=[${runReport.trendSummary.validationConfirmedByGeneration.join(',')}] ` +
              `repairImproved=[${runReport.trendSummary.repairOutcomeImprovedByGeneration.join(',')}] ` +
              `stoppedEarly=${runReport.trendSummary.stoppedEarly}` +
              (runReport.trendSummary.stopReason ? ` reason=${runReport.trendSummary.stopReason}` : ''),
          );
        } else {
          // 後方互換: 単世代経路 (= evolutionGenerations === 1)
          const report = await loop.runOneGeneration(regime);
          n++;
          this.deps.log(
            `[Evolution] regime=${regime} elites=${report.eliteIds.length} ` +
              `mut=${report.mutantsReceived} cross=${report.crossoversReceived} ` +
              `candidates=${report.promotionCandidates.length} divBoost=${report.lowDiversityBoost}`,
          );
          if (report.errors.length > 0) errors.push(...report.errors);
          // Phase E (2026-05-09): 単世代経路でも PDCA に世代完了通知を送る (= multi-gen と同じ経路)。
          this.notifyPdcaEvolutionGeneration(regime, 0, 1, report);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${regime}: ${msg}`);
        this.deps.addError(`[Evolution] ${regime} 失敗: ${msg}`);
        // PDCAループに失敗を通知して学習ログに残す
        try {
          pdcaLoop.notifyEvolutionFailed(regime, msg);
        } catch { /* PDCAループ未起動時は無視 */ }
      }
      if (i < regimes.length - 1) {
        await new Promise((r) => setTimeout(r, 30_000));
      }
    }

    this.onCompleted?.(new Date());
    this.deps.log(`[Evolution] 進化ループ完了: レジーム×世代の合計実行=${n}件`);
    return { regimeReports: n, errors };
  }

  /**
   * multi-generation runner 経由の 1 regime 実行。
   *
   * `runMultiGenerationEvolutionV1` に loop.runOneGeneration を adapter で渡し、
   * 世代間で tradesByDslId / RepairHint / RepairOutcome baseline を引き継ぐ。
   * QD-Archive / Adaptive Budget は config で個別に切り替え可能。
   *
   * Phase D-1b (2026-05-09): GenerationReflectionAgent + lesson 永続化を本番 multi-gen に inject。
   */
  private async runMultiGen(
    loop: EvolutionLoop,
    regime: string,
    generations: number,
    config: SideBSchedulerConfig,
  ): Promise<MultiGenerationRunReport> {
    // Phase D-1b: lesson 永続化用 evolutionRunId を生成し、runner options で明示的に渡す。
    // PR #145 Copilot review #5 対応: 旧設計 (= wrapper repo で UUID を上書き) は wrapper を
    // 通さない呼び出しで誤った evolutionRunId が永続化されるリスクがあった。runner options で
    // 渡す形に統一して型 / 引数で事故を防ぐ。
    const evolutionRunId = randomUUID();

    return await runMultiGenerationEvolutionV1({
      options: {
        generations,
        regime,
        adaptiveRepairBudget: config.evolutionAdaptiveBudget,
        qualityDiversityArchive: config.evolutionQDArchive,
        qualityDiversityArchiveParentLimit: config.evolutionQDParentLimit,
        // 世代間引き継ぎは default ON のまま (= Filter Evolution M2/M3 が成立する条件)
        // Phase D-1b: GenerationReflectionAgent + lesson repo + evolutionRunId の 3 点を inject。
        generationReflectionAgent,
        generationLessonRepo: generationLessonRepository,
        evolutionRunIdForLessons: evolutionRunId,
      },
      runOneGeneration: async ({
        repairHintsForMutation,
        repairBaselinesForOutcome,
        mutationBudgetAllocation,
        qualityDiversityArchiveParents,
      }) =>
        loop.runOneGeneration(regime, {
          repairHintsForMutation,
          repairBaselinesForOutcome,
          mutationBudgetAllocation,
          qualityDiversityArchiveParents,
        }),
    });
  }

  /**
   * Filter Evolution Phase E (2026-05-09): 進化ループ世代完了を PDCA に通知。
   *
   * GenerationReport から最低限の集計値を抜粋して PDCA loop の通知 hook に渡す。
   * pdcaLoop 側の `notifyEvolutionGenerationComplete` で thinking log に記録される。
   *
   * 例外は飲んで世代結果に影響させない (= 通知失敗で進化ループが停止しないよう保護)。
   *
   * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.E.1
   */
  private notifyPdcaEvolutionGeneration(
    regime: string,
    generationIndex: number,
    generationsTotal: number,
    report: GenerationReport,
  ): void {
    try {
      const formalBtPassed = report.formalBtVerifiedCandidates.filter((c) => c.formalBtPassed).length;
      pdcaLoop.notifyEvolutionGenerationComplete(regime, {
        generationIndex,
        generationsTotal,
        promotionCandidates: report.promotionCandidates.length,
        validationConfirmed: report.oosAwarePromotionSummary.validationConfirmed,
        formalBtPassed,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.deps.addError(`[Phase E] PDCA 通知失敗: regime=${regime} gen=${generationIndex} error=${msg}`);
    }
  }

  /**
   * Filter Evolution Phase B-3 (2026-05-09): EvolutionInstanceCarry retention 実行。
   *
   * 14 日より古い carry 行を `evolutionInstanceCarryRepository.deleteOlderThan()` で削除し、
   * 削除件数 > 0 のときは `console.info` で本番 (NODE_ENV=production) でも Cloud Logging に
   * 残るログを出す (PR #142 Copilot review #1: `this.log()` は production で no-op のため不適)。
   *
   * 例外は飲んで全体クリーンアップを止めない (= 他種データ削除はそのまま継続)。
   * 例外時は `deps.addError` でスケジューラエラーリストに記録する。
   *
   * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.B.4
   *
   * テスト: `evolutionCarryRetention.test.ts` (5 ケース) でログ文言と挙動を厳密に検証。
   */
  async runCarryRetention(): Promise<EvolutionCarryRetentionResult> {
    try {
      const carryDeleted = await evolutionInstanceCarryRepository.deleteOlderThan(
        EVOLUTION_CARRY_RETENTION_DAYS,
      );
      if (carryDeleted > 0) {
        console.info(
          `[SideBScheduler] [Phase B-3] EvolutionInstanceCarry retention: ${carryDeleted} 件削除 ` +
            `(${EVOLUTION_CARRY_RETENTION_DAYS} 日より古い行)`,
        );
      }
      return { deleted: carryDeleted };
    } catch (carryErr) {
      const carryMsg = carryErr instanceof Error ? carryErr.message : String(carryErr);
      this.deps.addError(`[Phase B-3] EvolutionInstanceCarry retention 失敗: ${carryMsg}`);
      return { deleted: 0, error: carryMsg };
    }
  }
}
