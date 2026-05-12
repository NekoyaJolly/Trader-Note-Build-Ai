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

/**
 * EvolutionInstanceCarry の保持日数 (= 14 日より古い行を retention で削除)。
 * 旧 sideBScheduler.ts の module private 定数を移植。
 */
export const EVOLUTION_CARRY_RETENTION_DAYS = 14;

/**
 * 進化ループのデフォルト対象レジーム。
 *
 * SideBScheduler.DEFAULT_CONFIG.evolutionRegimes はこの定数を spread する形で参照する
 * (= 依存方向: scheduler → evolutionJob、循環なし)。
 *
 * configOverride で空配列が渡されたケースの fallback としても本 Job 内で参照する
 * (`EvolutionJob.run()` 冒頭、旧 sideBScheduler.ts L1024-1026 の挙動互換)。
 */
export const DEFAULT_EVOLUTION_REGIMES = [
  'trending_with_pullback',
  'breakout',
  'consolidation',
  'reversal',
] as const;

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

// ============================================================================
// 環境変数解釈ヘルパー (旧 sideBScheduler.ts L243-266 を移植)
// ============================================================================

/**
 * 環境変数値が「整数表現の文字列」であることを厳密に検証する。
 *
 * `parseInt` だと '2abc' / '2.9' / '  2 ' を 2 として受理してしまう。本関数は
 * trim 後に `^-?\d+$` 全体一致でなければ null を返し、設定ミスを silent fail
 * させない (PR #138 Copilot review で指摘された運用事故防止)。
 */
function parseStrictInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * 環境変数値を `'true' | 'false'` で厳密に判定する。
 *
 * trim + toLowerCase 後に 'true' / 'false' でなければ null (= 想定外文字列、warning 対象)。
 */
function parseStrictBool(raw: string): boolean | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return null;
}

/**
 * 環境変数から Evolution 関連の設定 override を読み取る。
 *
 * 対応 env:
 * - `EVOLUTION_GENERATIONS` (1〜MULTI_GENERATION_DEFAULTS.maxGenerations の整数)
 * - `EVOLUTION_ADAPTIVE_BUDGET` ('true' | 'false')
 * - `EVOLUTION_QD_ARCHIVE` ('true' | 'false')
 * - `EVOLUTION_QD_PARENT_LIMIT` (>=0 の整数)
 * - `AUTO_EVOLUTION` ('true' | 'false', Filter Evolution 観察フェーズ用)
 *
 * 不正値は warning を出力した上で無視 (= DEFAULT_CONFIG が使われる)。
 *
 * 旧 sideBScheduler.ts の `readEvolutionEnvOverrides()` をそのまま移植。
 * warning 文言は `evolutionMultiGen.test.ts` で検証されているため変更不可。
 */
export function readEvolutionEnvOverrides(): Partial<SideBSchedulerConfig> {
  const out: Partial<SideBSchedulerConfig> = {};

  const gensRaw = process.env.EVOLUTION_GENERATIONS;
  if (gensRaw !== undefined && gensRaw !== '') {
    const parsed = parseStrictInt(gensRaw);
    if (
      parsed !== null &&
      parsed >= 1 &&
      parsed <= MULTI_GENERATION_DEFAULTS.maxGenerations
    ) {
      out.evolutionGenerations = parsed;
    } else {
      console.warn(
        `[SideBScheduler] EVOLUTION_GENERATIONS=${gensRaw} は不正値 (1〜${MULTI_GENERATION_DEFAULTS.maxGenerations} の整数のみ)、無視します`,
      );
    }
  }

  const adaptiveRaw = process.env.EVOLUTION_ADAPTIVE_BUDGET;
  if (adaptiveRaw !== undefined && adaptiveRaw !== '') {
    const parsed = parseStrictBool(adaptiveRaw);
    if (parsed === null) {
      console.warn(
        `[SideBScheduler] EVOLUTION_ADAPTIVE_BUDGET=${adaptiveRaw} は不正値 ('true' | 'false' のみ)、無視します`,
      );
    } else {
      out.evolutionAdaptiveBudget = parsed;
    }
  }

  const qdRaw = process.env.EVOLUTION_QD_ARCHIVE;
  if (qdRaw !== undefined && qdRaw !== '') {
    const parsed = parseStrictBool(qdRaw);
    if (parsed === null) {
      console.warn(
        `[SideBScheduler] EVOLUTION_QD_ARCHIVE=${qdRaw} は不正値 ('true' | 'false' のみ)、無視します`,
      );
    } else {
      out.evolutionQDArchive = parsed;
    }
  }

  const qdLimitRaw = process.env.EVOLUTION_QD_PARENT_LIMIT;
  if (qdLimitRaw !== undefined && qdLimitRaw !== '') {
    const parsed = parseStrictInt(qdLimitRaw);
    if (parsed !== null && parsed >= 0) {
      out.evolutionQDParentLimit = parsed;
    } else {
      console.warn(
        `[SideBScheduler] EVOLUTION_QD_PARENT_LIMIT=${qdLimitRaw} は不正値 (>=0 の整数のみ)、無視します`,
      );
    }
  }

  // Filter Evolution 観察フェーズ (2026-05-09): AUTO_EVOLUTION で evolution cron の自動起動を制御。
  // - true で `startEvolutionJob` が動き 24h ごと `runEvolutionNow` が走る (= LLM コスト発生)
  // - DEFAULT_CONFIG.autoEvolution は false なので、本番で観察データを蓄積するには true 設定が必須
  const autoEvolutionRaw = process.env.AUTO_EVOLUTION;
  if (autoEvolutionRaw !== undefined && autoEvolutionRaw !== '') {
    const parsed = parseStrictBool(autoEvolutionRaw);
    if (parsed === null) {
      console.warn(
        `[SideBScheduler] AUTO_EVOLUTION=${autoEvolutionRaw} は不正値 ('true' | 'false' のみ)、無視します`,
      );
    } else {
      out.autoEvolution = parsed;
    }
  }

  return out;
}

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
   * `evolutionGenerations` を [1, MULTI_GENERATION_DEFAULTS.maxGenerations] に clamp する。
   *
   * configOverride 経由で 0 や maxGenerations 超過の値が渡されると runner 側で
   * clamp される一方で scheduler のログ表示や useMultiGen 判定がズレるため、
   * Job 入口で必ず clamp する (PR #138 Copilot review #4)。
   */
  static clampGenerations(raw: number): number {
    return Math.max(
      1,
      Math.min(MULTI_GENERATION_DEFAULTS.maxGenerations, Math.floor(raw)),
    );
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
    });

    // configOverride 経由で 0 や maxGenerations 超過の値が渡されたときの clamp。
    const rawGenerations = config.evolutionGenerations ?? 1;
    const generations = EvolutionJob.clampGenerations(rawGenerations);
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
