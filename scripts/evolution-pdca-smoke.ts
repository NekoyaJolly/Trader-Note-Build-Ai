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
import { EvolutionLoop } from '../src/side-b/evolution/EvolutionLoop';
import { StrategyPopulation } from '../src/side-b/evolution/StrategyPopulation';
import { SurrogateFitnessSimulator } from '../src/side-b/strategy_dsl/SurrogateFitnessSimulator';
import { evolutionBacktestRunRepository } from '../src/backend/repositories/evolutionBacktestRunRepository';
import { prisma } from '../src/backend/db/client';

loadEnv();

interface CliArgs {
  regime: string;
  topK: number;
  periodStart: string;
  periodEnd: string;
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
      '  -h, --help         このヘルプ',
    ].join('\n'),
  );
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

  const startedAt = Date.now();
  const report = await loop.runOneGeneration(args.regime);
  const elapsedMs = Date.now() - startedAt;

  console.log('\n=== 1 generation report ===');
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
    elapsedMs,
  }, null, 2));

  if (report.errors.length > 0) {
    console.log('\n--- errors ---');
    for (const e of report.errors) console.log(`  ${e}`);
  }

  // PR #95: 親個体プール v1 のソース別取得 + fallback 状態
  // PR #98: edge_* ソース統合後は edgeHypothesisConversion 内訳も含む
  console.log('\n--- parentPoolSummary ---');
  console.log(JSON.stringify(report.parentPoolSummary, null, 2));

  // PR #96: Surrogate Rescue Lane の選抜結果 (route 別件数 + kill / 重複排除 / fallback)
  console.log('\n--- formalBtCandidateSummary ---');
  console.log(JSON.stringify(report.formalBtCandidateSummary, null, 2));

  // formalBtVerifiedCandidates の各 failureReason を出す (DB に行く前のメモリ上の情報)
  // PR #97: rescue route 名 (= novelty / low_drawdown / trade_count / near_miss / normal_pass) も併記
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

  // PR #100: FailureReason → RepairHint v1 集計 + 失敗候補ごとの short log。
  // mutation の修復方針が deterministic に観測できることを確認する用途。
  console.log('\n--- repairHintSummary ---');
  console.log(JSON.stringify(report.repairHintSummary, null, 2));

  // PR #101: PromotionGate / EvolutionCandidateStage v1 集計。
  // rescue / formal_bt_passed / repairable / repair_excluded の状態が混ざらず
  // 観測できることを確認する用途。productionEligible は v1 では常に 0。
  console.log('\n--- promotionGateSummary ---');
  console.log(JSON.stringify(report.promotionGateSummary, null, 2));

  // PR #102: RepairHint Outcome Telemetry v1 集計。
  // 前世代の failed candidate を baseline として、当世代 mutation child の formal BT 結果と
  // 比較して improved / worsened / unchanged / unknown を観測する。
  // 単世代 smoke では trace を持つ child が形成されないため、attempted=0 が通常。
  console.log('\n--- repairOutcomeSummary ---');
  console.log(JSON.stringify(report.repairOutcomeSummary, null, 2));

  // PR #103: OOS / Walk-forward v1 集計。
  // validation_candidate に上がった候補に対する未知期間評価を観測する。
  // smoke では oosBacktestRunner を渡していないので status=not_evaluated になる
  // (= 観測経路は壊れていないことを確認、production 昇格には絶対に使わない)。
  console.log('\n--- oosValidationSummary ---');
  console.log(JSON.stringify(report.oosValidationSummary, null, 2));

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
