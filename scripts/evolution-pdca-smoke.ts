/**
 * Critical-4 段階 4a.PDCA smoke / observability
 *
 * EvolutionLoop の最小 PDCA を 1 回だけ回し、結果を集計表示する診断スクリプト。
 *
 *   seed → surrogate fitness → top K → analysis-engine 正式 BT
 *     → EvolutionBacktestRun 永続化 → promotionCandidates 生成
 *
 * までが実環境で機能するかを確認する。formalBtPassed=0 件であっても、
 * どこで何件落ちたか (failureReason 分布) を観測できる状態にする。
 *
 * 使い方:
 *   DATABASE_URL=... ANALYSIS_ENGINE_URL=... \
 *     npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3
 *
 * 引数:
 *   --regime         (必須) 対象レジーム名 (例: breakout, trending_with_pullback)
 *   --top-k          (任意, 既定 3) 正式 BT に送る上限
 *   --period-start   (任意) BT 開始日 (YYYY-MM-DD)、省略時は -365 日
 *   --period-end     (任意) BT 終了日 (YYYY-MM-DD)、省略時は今日
 *   --help           ヘルプ表示
 *
 * 終了コード:
 *   0 = 正常終了 / `--help` 表示
 *   1 = 引数エラー (必須未指定 / 未知オプション)、または実行時例外
 *
 * 出力:
 *   - evolutionRunId
 *   - 1 generation 実行レポート (eliteIds / mutants / crossovers / promotionCandidates)
 *   - EvolutionBacktestRun 集計 (passed/failed 件数 + failureReason 分布 + generation 別)
 *   - 落ちた候補それぞれの failureReason を 1 件ずつ列挙
 *
 * 注意:
 *   - 本スクリプトは DB に書き込みを行う (EvolutionBacktestRun)。
 *     ScreeningBacktestRun には触らない。
 *   - analysis-engine への HTTP コールが発生する。timeout は client 側設定 (180s) を踏襲。
 */

import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'crypto';
import path from 'path';

import { CrossoverAgent } from '../src/side-b/agents/CrossoverAgent';
import { MutationAgent } from '../src/side-b/agents/MutationAgent';
import { DiversityEnforcer } from '../src/side-b/evolution/DiversityEnforcer';
import { EvolutionLoop, type GenerationReport } from '../src/side-b/evolution/EvolutionLoop';
import { StrategyPopulation } from '../src/side-b/evolution/StrategyPopulation';
import { SurrogateFitnessSimulator } from '../src/side-b/strategy_dsl/SurrogateFitnessSimulator';
import { evolutionBacktestRunRepository } from '../src/backend/repositories/evolutionBacktestRunRepository';
import { prisma } from '../src/backend/db/client';
import {
  MULTI_GENERATION_DEFAULTS,
  runMultiGenerationEvolutionV1,
} from '../src/side-b/evolution/multiGenerationRunner';

loadEnv();

interface CliArgs {
  regime: string;
  topK: number;
  periodStart: string;
  periodEnd: string;
  /** PR #106: 複数世代モード。未指定 / 1 は従来単世代経路、2 以上で multi-generation runner を使う。 */
  generations?: number;
  /** PR #107: Adaptive Repair / Mutation Budget v1 を有効化するか。 */
  adaptiveRepairBudget?: boolean;
  /** PR #108: Quality-Diversity Archive Lite v1 を有効化するか。 */
  qualityDiversityArchive?: boolean;
  /** PR #108: 各世代に注入する archive parent 上限。default 2。 */
  qdParentLimit?: number;
}

type ParseResult =
  | { kind: 'ok'; args: CliArgs }
  | { kind: 'help' }
  | { kind: 'error'; message: string };

function parseArgs(argv: readonly string[]): ParseResult {
  const out: Partial<CliArgs> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { kind: 'help' };
    if (a === '--regime') out.regime = argv[++i];
    else if (a === '--top-k') out.topK = parseInt(argv[++i], 10);
    else if (a === '--period-start') out.periodStart = argv[++i];
    else if (a === '--period-end') out.periodEnd = argv[++i];
    else if (a === '--generations') out.generations = parseInt(argv[++i], 10);
    else if (a === '--adaptive-repair-budget') out.adaptiveRepairBudget = true;
    else if (a === '--quality-diversity-archive') out.qualityDiversityArchive = true;
    else if (a === '--qd-parent-limit') out.qdParentLimit = parseInt(argv[++i], 10);
    else return { kind: 'error', message: `unknown argument: ${a}` };
  }
  if (!out.regime) return { kind: 'error', message: '--regime is required' };

  const today = new Date();
  const yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);

  return {
    kind: 'ok',
    args: {
      regime: out.regime,
      topK: Number.isFinite(out.topK) && (out.topK as number) > 0 ? (out.topK as number) : 3,
      periodStart: out.periodStart ?? yearAgo.toISOString().slice(0, 10),
      periodEnd: out.periodEnd ?? today.toISOString().slice(0, 10),
      generations:
        out.generations !== undefined && Number.isFinite(out.generations) && out.generations > 0
          ? out.generations
          : undefined,
      adaptiveRepairBudget: out.adaptiveRepairBudget,
      qualityDiversityArchive: out.qualityDiversityArchive,
      qdParentLimit:
        out.qdParentLimit !== undefined &&
        Number.isFinite(out.qdParentLimit) &&
        out.qdParentLimit > 0
          ? out.qdParentLimit
          : undefined,
    },
  };
}

function printHelp(): void {
  console.log(
    [
      'Usage: npx tsx scripts/evolution-pdca-smoke.ts --regime <regime> [options]',
      '',
      'Options:',
      '  --regime           (required) 対象レジーム名',
      '  --top-k            (default 3) 正式 BT に送る上限',
      '  --period-start     (default -365d) BT 開始日 YYYY-MM-DD',
      '  --period-end       (default today) BT 終了日 YYYY-MM-DD',
      `  --generations      (default 1) 連続実行世代数 (上限 ${MULTI_GENERATION_DEFAULTS.maxGenerations}、超過は clamp)`,
      '  --adaptive-repair-budget  multi-generation 時のみ。Adaptive Repair / Mutation Budget v1 を有効化',
      '  --quality-diversity-archive  multi-generation 時のみ。Quality-Diversity Archive Lite v1 を有効化',
      '  --qd-parent-limit  (default 2) archive から各世代へ注入する parent 数の上限',
      '  -h, --help         このヘルプ',
    ].join('\n'),
  );
}

/**
 * 1 世代分の GenerationReport を smoke 形式で出力する。
 * 単世代経路と multi-generation 経路の両方から共通利用する (= 表示形式の差を作らない)。
 */
function printGenerationReport(report: GenerationReport, opts: { elapsedMs?: number; label?: string } = {}): void {
  if (opts.label) console.log(`\n=== ${opts.label} ===`);
  console.log('\n=== generation report ===');
  console.log(JSON.stringify({
    regime: report.regime,
    eliteIds: report.eliteIds,
    mutantsReceived: report.mutantsReceived,
    crossoversReceived: report.crossoversReceived,
    addedToPopulation: report.addedToPopulation,
    formalBtVerifiedCandidates: report.formalBtVerifiedCandidates.length,
    promotionCandidates: report.promotionCandidates.length,
    lowDiversityBoost: report.lowDiversityBoost,
    errorCount: report.errors.length,
    elapsedMs: opts.elapsedMs,
  }, null, 2));

  if (report.errors.length > 0) {
    console.log('\n--- errors ---');
    for (const e of report.errors) console.log(`  ${e}`);
  }

  console.log('\n--- parentPoolSummary ---');
  console.log(JSON.stringify(report.parentPoolSummary, null, 2));

  console.log('\n--- formalBtCandidateSummary ---');
  console.log(JSON.stringify(report.formalBtCandidateSummary, null, 2));

  console.log('\n--- formal BT verify (in-memory) ---');
  for (const c of report.formalBtVerifiedCandidates) {
    const routeStr = c.route ? ` route=${c.route}` : '';
    if (c.formalBtPassed) {
      console.log(
        `  PASS dslId=${c.dslId}${routeStr} pf=${c.formalBtMetrics?.pf.toFixed(2)} ` +
          `winRate=${c.formalBtMetrics?.winRate.toFixed(2)} trades=${c.formalBtMetrics?.tradeCount}`,
      );
    } else {
      console.log(`  FAIL dslId=${c.dslId}${routeStr} reason=${c.formalBtFailureReason ?? '-'}`);
    }
  }

  console.log('\n--- repairHintSummary ---');
  console.log(JSON.stringify(report.repairHintSummary, null, 2));

  console.log('\n--- promotionGateSummary ---');
  console.log(JSON.stringify(report.promotionGateSummary, null, 2));

  console.log('\n--- repairOutcomeSummary ---');
  console.log(JSON.stringify(report.repairOutcomeSummary, null, 2));

  console.log('\n--- oosValidationSummary ---');
  console.log(JSON.stringify(report.oosValidationSummary, null, 2));

  console.log('\n--- oosAwarePromotionSummary ---');
  console.log(JSON.stringify(report.oosAwarePromotionSummary, null, 2));

  if (report.repairOutcomes.length > 0) {
    console.log('\n--- repairOutcome per child ---');
    for (const o of report.repairOutcomes) {
      const targets = o.targets.join(',') || '-';
      const pfDelta = o.deltas.pfDelta !== null ? o.deltas.pfDelta.toFixed(3) : '-';
      const tcDelta = o.deltas.tradeCountDelta !== null ? `${o.deltas.tradeCountDelta}` : '-';
      console.log(
        `  repairOutcome child=${o.childDslId} reason=${o.failureReason} target=${targets} ` +
          `status=${o.status} pfDelta=${pfDelta} tradeCountDelta=${tcDelta}`,
      );
    }
  }

  const failedWithHint = report.formalBtVerifiedCandidates.filter(
    (c) => !c.formalBtPassed && c.repairHint,
  );
  if (failedWithHint.length > 0) {
    console.log('\n--- repairHint per failed candidate ---');
    for (const c of failedWithHint) {
      const hint = c.repairHint;
      if (!hint) continue;
      const route = c.route ?? 'unknown';
      const targets = hint.actions.map((a) => a.target).join(',');
      console.log(
        `  repairHint candidate=${c.dslId} route=${route} reason=${hint.failureReason} ` +
          `severity=${hint.severity} target=${targets}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.kind === 'help') {
    printHelp();
    process.exit(0);
    return;
  }
  if (parsed.kind === 'error') {
    console.error(`[smoke] argument error: ${parsed.message}`);
    printHelp();
    process.exit(1);
    return;
  }
  const args = parsed.args;

  console.log('[smoke] 引数:', args);
  await prisma.$connect();

  const persistPath = path.join(process.cwd(), 'data', 'evolution', 'strategy-population.json');
  const population = new StrategyPopulation(persistPath);
  await population.load();

  const evolutionRunId = randomUUID();
  console.log(`[smoke] evolutionRunId=${evolutionRunId}`);

  const loop = new EvolutionLoop({
    population,
    adapter: new SurrogateFitnessSimulator(),
    mutationAgent: new MutationAgent(),
    crossoverAgent: new CrossoverAgent(),
    enforcer: new DiversityEnforcer(),
    defaultPeriod: { start: args.periodStart, end: args.periodEnd },
    formalBtTopK: args.topK,
    evolutionRunId,
    // 既定 repo (EvolutionBacktestRun への書き込み) を使う
  });

  // PR #106: --generations >= 2 で multi-generation runner を使う。未指定 / 1 は従来単世代経路。
  const useMultiGeneration =
    typeof args.generations === 'number' && args.generations >= 2;

  if (useMultiGeneration) {
    const runReport = await runMultiGenerationEvolutionV1({
      options: {
        generations: args.generations as number,
        regime: args.regime,
        adaptiveRepairBudget: args.adaptiveRepairBudget === true,
        qualityDiversityArchive: args.qualityDiversityArchive === true,
        qualityDiversityArchiveParentLimit: args.qdParentLimit,
      },
      runOneGeneration: async ({
        generationIndex,
        repairHintsForMutation,
        repairBaselinesForOutcome,
        mutationBudgetAllocation,
        qualityDiversityArchiveParents,
      }) => {
        const startedAt = Date.now();
        const r = await loop.runOneGeneration(args.regime, {
          repairHintsForMutation,
          repairBaselinesForOutcome,
          mutationBudgetAllocation,
          qualityDiversityArchiveParents,
        });
        const elapsedMs = Date.now() - startedAt;
        printGenerationReport(r, { elapsedMs, label: `Generation ${generationIndex + 1}` });
        return r;
      },
    });
    console.log('\n--- multiGenerationTrendSummary ---');
    console.log(JSON.stringify(runReport.trendSummary, null, 2));
    if (runReport.adaptiveRepairBudgetSummary) {
      // PR #107: Adaptive Repair / Mutation Budget v1 の summary。
      // - validation_confirmed / improved 観測を入力に next-generation の mutation 配分を
      //   bounded に調整した結果。productionEligibleChanged は不変条件で常に false。
      console.log('\n--- adaptiveRepairBudgetSummary ---');
      console.log(JSON.stringify(runReport.adaptiveRepairBudgetSummary, null, 2));
    }
    if (runReport.qualityDiversityArchiveSummary) {
      // PR #108: Quality-Diversity Archive Lite v1 の summary。
      // - 行動特性別 cell 単位で品質上位 1 件を保持。世代をまたいで保持し、少量を
      //   次世代 parent に注入することで多様性 floor を確保。
      // - 評価エンジンの代替ではなく、Surrogate Rescue Lane と並列。productionEligible は不変。
      console.log('\n--- qualityDiversityArchiveSummary ---');
      console.log(JSON.stringify(runReport.qualityDiversityArchiveSummary, null, 2));
    }
  } else {
    if (args.qualityDiversityArchive === true || args.adaptiveRepairBudget === true) {
      console.warn(
        '[smoke] WARNING: --quality-diversity-archive / --adaptive-repair-budget は ' +
          'multi-generation (--generations >= 2) でのみ機能します。単世代経路では無視されます。',
      );
    }
    const startedAt = Date.now();
    const report = await loop.runOneGeneration(args.regime);
    const elapsedMs = Date.now() - startedAt;
    printGenerationReport(report, { elapsedMs });
  }

  // DB から集計を読み戻して表示 (永続化が成功しているかの確認も兼ねる)
  console.log('\n=== EvolutionBacktestRun summary (from DB) ===');
  const summary = await evolutionBacktestRunRepository.summarizeByEvolutionRun(evolutionRunId);
  console.log(JSON.stringify(summary, null, 2));

  if (summary.totalCandidates === 0) {
    console.warn(
      '\n[smoke] WARNING: DB に候補が 1 件も保存されていません。' +
        ' surrogate 段階で 0 件だった (= 厳格 3 条件未達) 可能性が高い。',
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[smoke] FATAL:', e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
