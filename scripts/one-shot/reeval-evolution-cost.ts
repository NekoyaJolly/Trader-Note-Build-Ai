/**
 * 目的: #303(コスト配線)以前に「コスト0」で合格した既存進化候補を、シンボル別コスト(往復スプレッド)
 *       込みで再評価する。結果は既存履歴を壊さず、新しい evolutionRunId の新規行として追加する。
 *       過学習・極小SL候補がコストを乗せると何件 PF<1 / トレード不足で落ちるかを実データで把握する。
 * 実行条件: 本番 DATABASE_URL + ANALYSIS_ENGINE_URL に接続できる環境 (= .env が本番を指す手元)。
 *           analysis-engine が起動しており screening-backtest を受けられること。
 * 実行コマンド:
 *   npx tsx scripts/one-shot/reeval-evolution-cost.ts            # 既定 limit=500 (ユニーク候補)
 *   npx tsx scripts/one-shot/reeval-evolution-cost.ts --limit 20 # 小さく試す
 *   npx tsx scripts/one-shot/reeval-evolution-cost.ts --dry-run  # DBに書かず集計だけ
 * 作成日: 2026-06-01
 * 削除予定: 2026-07-31
 * 削除条件: 再評価を1回実施し結果を確認したら、本ファイルと scripts/README.md §3 の行を同時に削除する。
 */

import 'dotenv/config';
import { randomUUID } from 'crypto';
import { StrategyDSLSchema } from '../../src/side-b/strategy_dsl/schema';
import { dslToBacktestNotePayload } from '../../src/side-b/strategy_dsl/dslToBacktestNotePayload';
import { defaultParameterValues } from '../../src/side-b/strategy_dsl/dslParameterUtils';
import {
  getExecutionCostProfile,
  getPipSize,
} from '../../src/side-b/strategy_dsl/executionSimulation';
import { runScreeningBacktest } from '../../src/backend/services/analysisEngineClient';
import {
  evolutionBacktestRunRepository,
  type EvolutionBacktestRunInsertData,
} from '../../src/backend/repositories/evolutionBacktestRunRepository';
import { normalizeCTraderSymbol } from '../../src/utils/symbolNormalization';
import { normalizeTimeframe } from '../../src/side-b/constants/timeframes';
import { VALIDATION_THRESHOLDS } from '../../src/side-b/config/validationThresholds';

// 正式BTの合格基準は EvolutionLoop と同値に揃える。
const FORMAL_BT_MIN_PF = 1.0;
const FORMAL_BT_MIN_TRADES = VALIDATION_THRESHOLDS.common.minTradeCount;

// analysis-engine への同時実行数 (負荷を抑えつつ多少並列化)。
const CONCURRENCY = 3;

function parseArgs(argv: string[]): { limit: number; dryRun: boolean } {
  let limit = 500;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit' && argv[i + 1]) {
      limit = Math.max(1, parseInt(argv[i + 1], 10) || 500);
      i++;
    } else if (argv[i] === '--dry-run') {
      dryRun = true;
    }
  }
  return { limit, dryRun };
}

interface ReevalOutcome {
  candidateId: string;
  symbol: string;
  repassed: boolean;
  reason: string | null;
  pf: number | null;
  tradeCount: number | null;
  row: EvolutionBacktestRunInsertData | null;
}

async function reevalOne(
  candidate: Awaited<ReturnType<typeof evolutionBacktestRunRepository.findRecentFormalBtPassed>>[number],
  reevalRunId: string,
): Promise<ReevalOutcome> {
  const base = {
    candidateId: candidate.candidateId,
    symbol: '',
    repassed: false,
    reason: null as string | null,
    pf: null as number | null,
    tradeCount: null as number | null,
    row: null as EvolutionBacktestRunInsertData | null,
  };

  const parsed = StrategyDSLSchema.safeParse(candidate.dslSnapshot);
  if (!parsed.success) {
    return { ...base, reason: `DSL schema 検証失敗: ${parsed.error.message}` };
  }
  const dsl = parsed.data;
  const symbol = normalizeCTraderSymbol(dsl.symbol);
  const timeframe = normalizeTimeframe(dsl.timeframe);
  base.symbol = symbol;

  // 評価期間は evolutionJob と同じ「過去365日」。
  const end = new Date();
  const start = new Date(end.getTime() - 365 * 24 * 60 * 60 * 1000);

  const resolvedParams = defaultParameterValues(dsl);
  const notePayload = dslToBacktestNotePayload(dsl, resolvedParams);
  const costProfile = getExecutionCostProfile(symbol);

  try {
    const response = await runScreeningBacktest({
      hypothesisId: dsl.id,
      symbol,
      timeframe,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      notePayload,
      config: {
        initialCapital: 10_000,
        leverage: 1,
        tradingCost: 0,
        spreadPips: costProfile.roundTripCostPips,
        pipSize: getPipSize(symbol),
      },
    });

    const pf = response.summary.pf;
    const tradeCount = response.summary.tradeCount;
    const winRate = response.summary.winRate;

    let repassed = true;
    let reason: string | null = null;
    if (tradeCount < FORMAL_BT_MIN_TRADES) {
      repassed = false;
      reason = `tradeCount ${tradeCount} < ${FORMAL_BT_MIN_TRADES}`;
    } else if (!Number.isFinite(pf) || pf < FORMAL_BT_MIN_PF) {
      repassed = false;
      reason = `pf ${pf} < ${FORMAL_BT_MIN_PF}`;
    }

    const row: EvolutionBacktestRunInsertData = {
      evolutionRunId: reevalRunId,
      generation: candidate.generation,
      candidateId: candidate.candidateId,
      candidateHash: candidate.candidateHash,
      dslSnapshot: dsl,
      surrogateScore: candidate.surrogateScore,
      formalBtPassed: repassed,
      formalBtMetrics: { pf, winRate, tradeCount },
      formalBtFailureReason: reason,
      engine: 'analysis-engine',
      engineVersion: response.engineVersion,
      trades: response.trades.map((t) => ({
        entryTime: t.entryTime,
        side: t.side,
        pnl: t.pnl,
        outcome: t.outcome,
      })),
    };

    return { ...base, repassed, reason, pf, tradeCount, row };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...base, reason: `analysis-engine BT 失敗: ${msg}` };
  }
}

async function main(): Promise<void> {
  const { limit, dryRun } = parseArgs(process.argv.slice(2));
  const reevalRunId = randomUUID();

  console.log('=== 進化候補 コスト込み再評価 (one-shot) ===');
  console.log(`limit(ユニーク候補)=${limit} dryRun=${dryRun}`);
  console.log(`新 evolutionRunId = ${reevalRunId}`);

  const candidates = await evolutionBacktestRunRepository.findRecentFormalBtPassed(limit);
  console.log(`再評価対象 (formalBtPassed=true, candidateHash 重複除去後): ${candidates.length} 件`);

  const outcomes: ReevalOutcome[] = [];
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((c) => reevalOne(c, reevalRunId)));
    outcomes.push(...results);
    console.log(`  進捗 ${Math.min(i + CONCURRENCY, candidates.length)}/${candidates.length}`);
  }

  const rows = outcomes.map((o) => o.row).filter((r): r is EvolutionBacktestRunInsertData => r !== null);
  const repassed = outcomes.filter((o) => o.repassed).length;
  const refailed = outcomes.filter((o) => o.row !== null && !o.repassed).length;
  const errored = outcomes.filter((o) => o.row === null).length;

  console.log('--- 集計 ---');
  console.log(`再評価完了: ${rows.length} 件 (エラー ${errored} 件)`);
  console.log(`コスト込みで合格維持: ${repassed} 件 / 不合格に転落: ${refailed} 件`);

  if (dryRun) {
    console.log('[dry-run] DB へは書き込みません。');
  } else if (rows.length > 0) {
    const saved = await evolutionBacktestRunRepository.createMany(rows);
    console.log(`DB に新規行として保存: ${saved.length} 件 (evolutionRunId=${reevalRunId})`);
  }

  console.log('DONE');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED', e);
    process.exit(1);
  });
