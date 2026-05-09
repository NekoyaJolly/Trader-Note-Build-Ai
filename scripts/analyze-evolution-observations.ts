/**
 * Filter Evolution 観察スクリプト (Phase Obs-A、2026-05-09)
 *
 * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §3.3
 *
 * Phase A〜E + B-3 + D-1a/D-1b 完了後の本番運用観察フェーズで使う集計スクリプト。
 * 本番 DB を直接読んで以下を Markdown 形式で標準出力に集計する:
 *
 *   1. EvolutionBacktestRun サマリ (= 直近 N 日の世代実行履歴)
 *      - route 別 (mutation / crossover / novelty / edge_hypothesis) の formalBtPassed 率
 *      - candidateId prefix で route を判別
 *      - mutation vs crossover の比較 (= 撤廃判断材料)
 *
 *   2. Win Rate Lift 分布 (= EvolutionBacktestRun.trades から集計)
 *      - candidate 単位の勝率分布
 *      - 親子比較が可能な行で Lift 中央値
 *
 *   3. EvolutionInstanceCarry 蓄積状況 (= cron 起動 × regime 単位)
 *      - 直近 N 日の carry 行数
 *      - Phase B-2 動作確認 (= cron 跨ぎ復元が機能しているか)
 *
 *   4. GenerationLesson 集計 (= Phase D-1b 動作確認)
 *      - category 分布
 *      - 最新 lesson 5 件サンプル
 *
 * 使い方:
 *   DATABASE_URL=... npx tsx scripts/analyze-evolution-observations.ts [--days 7] [--regime breakout]
 *
 * 引数:
 *   --days <N>       (default 7) 集計期間 (= 過去 N 日)
 *   --regime <name>  (optional) 特定 regime のみフィルタ
 *   --help           ヘルプ
 *
 * 終了コード:
 *   0 = 正常終了
 *   1 = 引数エラー / DB 接続失敗
 *
 * 注意:
 *   - 本スクリプトは DB を読み取るだけで書き込みは行わない (= 観察専用)。
 *   - Win Rate Lift の集計は `src/shared/statistics/winRateLift.ts` の helper を使う。
 *   - candidateId prefix の判定は EvolutionLoop / mutationAgent の命名規則に依存する。
 */

import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';

import {
  computeWinRateLift,
  type WinRateLiftTrade,
} from '../src/shared/statistics/winRateLift';

loadEnv();

// =================================================================
// 引数パース
// =================================================================

interface CliArgs {
  days: number;
  regime: string | null;
  showHelp: boolean;
}

function parseArgs(argv: string[]): CliArgs | { error: string } {
  const out: CliArgs = { days: 7, regime: null, showHelp: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.showHelp = true;
    else if (a === '--days') {
      const next = argv[++i];
      const n = parseInt(next, 10);
      if (!Number.isFinite(n) || n < 1 || n > 90) {
        return { error: `--days は 1-90 の整数。受け取った値: ${next}` };
      }
      out.days = n;
    } else if (a === '--regime') {
      out.regime = argv[++i] ?? null;
      if (!out.regime) return { error: '--regime には regime 名を指定してください' };
    } else {
      return { error: `未知オプション: ${a}` };
    }
  }
  return out;
}

function printHelp(): void {
  console.log(`Filter Evolution 観察スクリプト (Phase Obs-A)

使い方:
  DATABASE_URL=... npx tsx scripts/analyze-evolution-observations.ts [options]

オプション:
  --days <N>       集計期間 (= 過去 N 日、default 7、範囲 1-90)
  --regime <name>  regime フィルタ (= 'breakout' / 'reversal' 等、省略時は全 regime)
  --help / -h      このヘルプ

出力:
  Markdown 形式で標準出力に集計結果を書き出す。
  - EvolutionBacktestRun route 別 pass 率 (= mutation vs crossover 比較)
  - Win Rate Lift 分布 (= filter 効果観測)
  - EvolutionInstanceCarry 蓄積状況 (= Phase B-2 動作確認)
  - GenerationLesson category 分布 (= Phase D-1b 動作確認)
`);
}

// =================================================================
// candidateId prefix → route 分類
// =================================================================

type Route = 'crossover' | 'mutation' | 'novelty' | 'edge_hypothesis' | 'other';

/**
 * candidateId prefix から route を分類する。
 *
 * PR #146 Copilot review #1 対応: 現行 MutationAgent (`MutationAgent.ts:263`) は `mut-` prefix を
 * 生成するが、過去スモーク / 旧実装で `mutation-` 始まりの id も DB に残っている可能性がある。
 * 両方の prefix を mutation 扱いにすることで、観察データの集計漏れを防ぐ。
 *
 * 各 prefix の定義元:
 *   - `x-`: CrossoverAgent.ts:157 (`x-${randomUUID()}`)
 *   - `mut-`: MutationAgent.ts:263 (現行、`mut-${randomUUID()}`)
 *   - `mutation-`: 旧 / smoke seed (= mutation-anomaly-short-... 形式)
 *   - `novelty-`: seedDescriptor.ts:376 (`novelty-${kind}-${regime}-${uuid}`)
 *   - `edge-hypothesis-`: EdgeLedger 由来
 */
function classifyRoute(candidateId: string): Route {
  if (candidateId.startsWith('x-')) return 'crossover';
  if (candidateId.startsWith('mut-') || candidateId.startsWith('mutation-')) return 'mutation';
  if (candidateId.startsWith('novelty-')) return 'novelty';
  if (candidateId.startsWith('edge-hypothesis-')) return 'edge_hypothesis';
  return 'other';
}

/**
 * regime 指定時に十分なサンプルを集めるためのクエリ件数上限。
 *
 * PR #146 Copilot review #2/#3 対応: regime 指定時は JS 側 filter で激減することを考慮し、
 * regime 未指定の `take=5000` よりさらに大きい上限を使う。これでも `--days 90` × 全 regime の
 * 想定件数 22500 を下回るが、実用上は regime 指定 + 期間 14 日程度で運用するため十分。
 *
 * 期間 14 日 × 5 regime × 50 候補/世代 = 約 3500、`take=10000` で余裕を持たせる。
 */
const QUERY_TAKE_LIMIT_REGIME_FILTERED = 10_000;
const QUERY_TAKE_LIMIT_DEFAULT = 5_000;

// =================================================================
// EvolutionBacktestRun 集計
// =================================================================

interface BtRunSummary {
  totalRows: number;
  byRoute: Record<Route, { total: number; passed: number; failed: number }>;
  byGeneration: Array<{ generation: number; total: number; passed: number }>;
}

async function summarizeBacktestRuns(
  prisma: PrismaClient,
  daysAgo: number,
  regime: string | null,
): Promise<BtRunSummary> {
  const cutoff = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  // PR #146 Copilot review #2 対応: regime 指定時は JS 側 filter で激減するため、上限を 2 倍に。
  // dslSnapshot.regimeTarget は JSON path query が Prisma 6 で複雑なので broad に取得 + JS filter。
  const takeLimit = regime ? QUERY_TAKE_LIMIT_REGIME_FILTERED : QUERY_TAKE_LIMIT_DEFAULT;
  const rows = await prisma.evolutionBacktestRun.findMany({
    where: { createdAt: { gte: cutoff } },
    select: {
      candidateId: true,
      generation: true,
      formalBtPassed: true,
      dslSnapshot: true,
    },
    take: takeLimit,
    orderBy: { createdAt: 'desc' },
  });

  // regime フィルタ (JS 側)
  const filtered = regime
    ? rows.filter((r) => {
        // dslSnapshot は Json、regimeTarget を読む
        const snap = r.dslSnapshot;
        if (snap === null || typeof snap !== 'object' || Array.isArray(snap)) return false;
        const rt = (snap as Record<string, unknown>).regimeTarget;
        return typeof rt === 'string' && rt === regime;
      })
    : rows;

  const byRoute: BtRunSummary['byRoute'] = {
    crossover: { total: 0, passed: 0, failed: 0 },
    mutation: { total: 0, passed: 0, failed: 0 },
    novelty: { total: 0, passed: 0, failed: 0 },
    edge_hypothesis: { total: 0, passed: 0, failed: 0 },
    other: { total: 0, passed: 0, failed: 0 },
  };
  const genMap = new Map<number, { total: number; passed: number }>();

  for (const r of filtered) {
    const route = classifyRoute(r.candidateId);
    byRoute[route].total += 1;
    if (r.formalBtPassed) byRoute[route].passed += 1;
    else byRoute[route].failed += 1;

    const gen = genMap.get(r.generation) ?? { total: 0, passed: 0 };
    gen.total += 1;
    if (r.formalBtPassed) gen.passed += 1;
    genMap.set(r.generation, gen);
  }

  const byGeneration = Array.from(genMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([generation, v]) => ({ generation, ...v }));

  return { totalRows: filtered.length, byRoute, byGeneration };
}

function pct(n: number, d: number): string {
  if (d === 0) return '–';
  return `${((n / d) * 100).toFixed(1)}%`;
}

function printBtRunSummary(s: BtRunSummary, daysAgo: number, regime: string | null): void {
  console.log(`\n## 1. EvolutionBacktestRun サマリ (直近 ${daysAgo} 日${regime ? `, regime=${regime}` : ', 全 regime'})\n`);
  console.log(`- **総候補数**: ${s.totalRows} 行`);
  if (s.totalRows === 0) {
    console.log(`- ⚠ 行なし — Phase A の \`EVOLUTION_GENERATIONS=2\` が反映されていない / cron 未起動の可能性`);
    return;
  }

  console.log(`\n### 1.1 Route 別 formalBtPassed 率 (= mutation 撤廃判断の主データ)\n`);
  console.log(`| Route | total | passed | failed | pass率 |`);
  console.log(`|---|---:|---:|---:|---:|`);
  const routes: Route[] = ['crossover', 'mutation', 'novelty', 'edge_hypothesis', 'other'];
  for (const r of routes) {
    const v = s.byRoute[r];
    console.log(`| ${r} | ${v.total} | ${v.passed} | ${v.failed} | ${pct(v.passed, v.total)} |`);
  }

  // PR #146 Copilot review #4 対応: 劣化検知目的なので **新しい 10 世代** を表示する。
  // byGeneration は generation 昇順なので末尾を slice + 表示用に降順反転して見やすく。
  console.log(`\n### 1.2 Generation 別 pass 率 (= 直近 10 世代、新しい順で劣化検知)\n`);
  console.log(`| Generation | total | passed | pass率 |`);
  console.log(`|---:|---:|---:|---:|`);
  const recentGens = s.byGeneration.slice(-10).reverse();
  for (const g of recentGens) {
    console.log(`| ${g.generation} | ${g.total} | ${g.passed} | ${pct(g.passed, g.total)} |`);
  }
  if (s.byGeneration.length > 10) {
    console.log(`\n(全 ${s.byGeneration.length} 世代中、直近 10 世代を表示)`);
  }
}

// =================================================================
// Win Rate Lift 分布 (= EvolutionBacktestRun.trades から計算)
// =================================================================

interface LiftDistribution {
  totalCandidates: number;
  withTrades: number;
  computableLifts: number;
  notComputable: number;
  liftValues: number[];
  liftMedian: number | null;
  liftP25: number | null;
  liftP75: number | null;
  byRoute: Record<Route, { count: number; liftMedian: number | null }>;
}

interface BtRunWithTrades {
  candidateId: string;
  generation: number;
  evolutionRunId: string;
  formalBtPassed: boolean;
  trades: WinRateLiftTrade[] | null;
  dslSnapshot: unknown;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * 線形補間 (= type 7 / R-7 / Excel `PERCENTILE.INC` と同等) ベースの quantile 計算。
 *
 * PR #146 Copilot review #5 対応: 旧実装は `Math.floor(q * length)` で「length=4, q=0.75 → idx=3 (= 最大値)」
 * のように一般的な percentile 定義とズレていた。`(n-1) * q` で position を計算し、
 * 整数部 + 小数部で線形補間する形に修正。意思決定材料 (= P25 / P75) の正確性を担保する。
 */
function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  if (q < 0 || q > 1) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  const fraction = pos - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction;
}

async function summarizeWinRateLift(
  prisma: PrismaClient,
  daysAgo: number,
  regime: string | null,
): Promise<LiftDistribution> {
  const cutoff = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  // PR #146 Copilot review #3 対応: regime 指定時の filter 漏れ防止のため take 上限を引き上げる。
  const takeLimit = regime ? QUERY_TAKE_LIMIT_REGIME_FILTERED : QUERY_TAKE_LIMIT_DEFAULT;
  const rows = await prisma.evolutionBacktestRun.findMany({
    where: { createdAt: { gte: cutoff } },
    select: {
      candidateId: true,
      generation: true,
      evolutionRunId: true,
      formalBtPassed: true,
      trades: true,
      dslSnapshot: true,
    },
    take: takeLimit,
    orderBy: { createdAt: 'desc' },
  });

  const filteredRaw = regime
    ? rows.filter((r) => {
        const snap = r.dslSnapshot;
        if (snap === null || typeof snap !== 'object' || Array.isArray(snap)) return false;
        const rt = (snap as Record<string, unknown>).regimeTarget;
        return typeof rt === 'string' && rt === regime;
      })
    : rows;

  // trades を WinRateLiftTrade[] に narrow
  const filtered: BtRunWithTrades[] = filteredRaw.map((r) => {
    const tradesNarrow = (() => {
      if (r.trades === null || !Array.isArray(r.trades)) return null;
      const out: WinRateLiftTrade[] = [];
      for (const t of r.trades) {
        if (
          t !== null &&
          typeof t === 'object' &&
          !Array.isArray(t) &&
          'entryTime' in t &&
          'outcome' in t
        ) {
          const obj = t as Record<string, unknown>;
          if (
            typeof obj.entryTime === 'string' &&
            (obj.outcome === 'win' || obj.outcome === 'loss' || obj.outcome === 'timeout')
          ) {
            out.push({ entryTime: obj.entryTime, outcome: obj.outcome });
          }
        }
      }
      return out;
    })();
    return {
      candidateId: r.candidateId,
      generation: r.generation,
      evolutionRunId: r.evolutionRunId,
      formalBtPassed: r.formalBtPassed,
      trades: tradesNarrow,
      dslSnapshot: r.dslSnapshot,
    };
  });

  // PR #146 Copilot review #6 対応: 親子マップは `(evolutionRunId, candidateId)` 複合キー。
  // edge-hypothesis / novelty seed は cron を跨いで同じ DSL id が再登場しうるため、
  // 単一キーだと別 evolutionRunId の親 trades を誤って拾うリスクがある。
  // 子の evolutionRunId と一致する親だけを参照する形にする。
  const compositeKey = (runId: string, candId: string): string => `${runId}::${candId}`;
  const tradesByCompositeKey = new Map<string, WinRateLiftTrade[]>();
  for (const r of filtered) {
    if (r.trades && r.trades.length > 0) {
      tradesByCompositeKey.set(compositeKey(r.evolutionRunId, r.candidateId), r.trades);
    }
  }

  // 親 ID は dslSnapshot.parentIds[0] から取得し、同 evolutionRunId の親のみ参照
  const liftValues: number[] = [];
  const liftByRoute: Record<Route, number[]> = {
    crossover: [],
    mutation: [],
    novelty: [],
    edge_hypothesis: [],
    other: [],
  };
  let withTrades = 0;
  let notComputable = 0;
  for (const r of filtered) {
    if (!r.trades || r.trades.length === 0) continue;
    withTrades += 1;
    const snap = r.dslSnapshot;
    if (snap === null || typeof snap !== 'object' || Array.isArray(snap)) {
      notComputable += 1;
      continue;
    }
    const parentIds = (snap as Record<string, unknown>).parentIds;
    if (!Array.isArray(parentIds) || parentIds.length === 0) {
      notComputable += 1;
      continue;
    }
    const parentId = parentIds[0];
    if (typeof parentId !== 'string') {
      notComputable += 1;
      continue;
    }
    // 子の evolutionRunId と一致する親 trades のみ参照 (= cron 跨ぎ汚染防止)
    const parentTrades = tradesByCompositeKey.get(compositeKey(r.evolutionRunId, parentId));
    if (!parentTrades || parentTrades.length === 0) {
      notComputable += 1;
      continue;
    }

    const liftResult = computeWinRateLift({
      parentTrades,
      childTrades: r.trades,
    });
    if (liftResult.notComputable) {
      notComputable += 1;
      continue;
    }
    liftValues.push(liftResult.lift);
    liftByRoute[classifyRoute(r.candidateId)].push(liftResult.lift);
  }

  const byRoute: LiftDistribution['byRoute'] = {
    crossover: { count: liftByRoute.crossover.length, liftMedian: median(liftByRoute.crossover) },
    mutation: { count: liftByRoute.mutation.length, liftMedian: median(liftByRoute.mutation) },
    novelty: { count: liftByRoute.novelty.length, liftMedian: median(liftByRoute.novelty) },
    edge_hypothesis: { count: liftByRoute.edge_hypothesis.length, liftMedian: median(liftByRoute.edge_hypothesis) },
    other: { count: liftByRoute.other.length, liftMedian: median(liftByRoute.other) },
  };

  return {
    totalCandidates: filtered.length,
    withTrades,
    computableLifts: liftValues.length,
    notComputable,
    liftValues,
    liftMedian: median(liftValues),
    liftP25: quantile(liftValues, 0.25),
    liftP75: quantile(liftValues, 0.75),
    byRoute,
  };
}

function fmtNum(n: number | null): string {
  return n === null ? '–' : n.toFixed(3);
}

function printLiftDistribution(d: LiftDistribution, daysAgo: number, regime: string | null): void {
  // PR #146 Copilot review #7 対応: regime フィルタ時に見出しに regime を明示し、
  // 上流ヘッダだけに依存しない自己完結型の表示にする。
  const regimeLabel = regime ? `, regime=${regime}` : ', 全 regime';
  console.log(`\n## 2. Win Rate Lift 分布 (直近 ${daysAgo} 日${regimeLabel})\n`);
  console.log(`- **総候補数**: ${d.totalCandidates}`);
  console.log(`- **trades あり**: ${d.withTrades} (Phase B-1 で永続化された行)`);
  console.log(`- **Lift 計算可能**: ${d.computableLifts}`);
  console.log(`- **計算不能**: ${d.notComputable} (= 親 trades なし / parentIds なし / period mismatch 等)`);

  if (d.computableLifts === 0) {
    console.log(`- ⚠ Lift 計算可能な候補がゼロ — Phase B-2 carry state が cron 跨ぎで復元されていない可能性`);
    return;
  }

  console.log(`\n### 2.1 Lift 全体分布\n`);
  console.log(`| 統計値 | Lift |`);
  console.log(`|---|---:|`);
  console.log(`| 中央値 | ${fmtNum(d.liftMedian)} |`);
  console.log(`| 25 percentile | ${fmtNum(d.liftP25)} |`);
  console.log(`| 75 percentile | ${fmtNum(d.liftP75)} |`);
  if (d.liftMedian !== null && d.liftMedian > 1.0) {
    console.log(`\n✅ **Lift 中央値 > 1.0** = filter が勝率改善している証拠 (= 設計書 §3.3 観測条件 2)`);
  } else if (d.liftMedian !== null) {
    console.log(`\n⚠ Lift 中央値 ≤ 1.0 = filter 効果が見えていない / safety guard で弾かれている`);
  }

  console.log(`\n### 2.2 Route 別 Lift (= mutation 撤廃判断材料)\n`);
  console.log(`| Route | 件数 | Lift 中央値 |`);
  console.log(`|---|---:|---:|`);
  const routes: Route[] = ['crossover', 'mutation', 'novelty', 'edge_hypothesis', 'other'];
  for (const r of routes) {
    const v = d.byRoute[r];
    console.log(`| ${r} | ${v.count} | ${fmtNum(v.liftMedian)} |`);
  }

  // mutation 撤廃判断のヒント
  const mLift = d.byRoute.mutation.liftMedian;
  const xLift = d.byRoute.crossover.liftMedian;
  if (mLift !== null && xLift !== null) {
    console.log(`\n### 2.3 mutation 撤廃判断ヒント\n`);
    if (mLift <= 1.0 && xLift > 1.0) {
      console.log(`- 🔻 **mutation Lift 中央値 ${mLift.toFixed(3)} ≤ 1.0、crossover ${xLift.toFixed(3)} > 1.0**`);
      console.log(`  → 設計書 §3.4 (A) **完全撤廃** 候補。crossover + Python 最適化に集約検討。`);
    } else if (mLift > 1.0 && mLift < xLift) {
      console.log(`- 📉 mutation も時々 Lift > 1.0 を出すが crossover ほどではない`);
      console.log(`  → 設計書 §3.4 (B) **repair 専用に縮退** 候補。`);
    } else if (mLift >= xLift) {
      console.log(`- 🎯 mutation の方が Lift 中央値が高い (= 構造変異の貢献あり)`);
      console.log(`  → 設計書 §3.4 (C) **構造変異専用** 候補、または現状維持。`);
    } else {
      console.log(`- データ不足で判断保留。さらに観察期間を延ばす。`);
    }
  }
}

// =================================================================
// EvolutionInstanceCarry 蓄積状況
// =================================================================

interface CarrySummary {
  totalRows: number;
  byRegime: Array<{ regime: string; rows: number; latestRecordedAt: Date | null }>;
  oldestRecordedAt: Date | null;
  newestRecordedAt: Date | null;
}

async function summarizeCarryState(
  prisma: PrismaClient,
  daysAgo: number,
  regime: string | null,
): Promise<CarrySummary> {
  const cutoff = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const rows = await prisma.evolutionInstanceCarry.findMany({
    where: {
      recordedAt: { gte: cutoff },
      ...(regime ? { regime } : {}),
    },
    select: {
      regime: true,
      recordedAt: true,
    },
    take: 5000,
    orderBy: { recordedAt: 'desc' },
  });

  const byRegimeMap = new Map<string, { rows: number; latestRecordedAt: Date | null }>();
  let oldest: Date | null = null;
  let newest: Date | null = null;
  for (const r of rows) {
    const cur = byRegimeMap.get(r.regime) ?? { rows: 0, latestRecordedAt: null };
    cur.rows += 1;
    if (cur.latestRecordedAt === null || r.recordedAt > cur.latestRecordedAt) {
      cur.latestRecordedAt = r.recordedAt;
    }
    byRegimeMap.set(r.regime, cur);
    if (oldest === null || r.recordedAt < oldest) oldest = r.recordedAt;
    if (newest === null || r.recordedAt > newest) newest = r.recordedAt;
  }
  const byRegime = Array.from(byRegimeMap.entries())
    .sort((a, b) => b[1].rows - a[1].rows)
    .map(([reg, v]) => ({ regime: reg, ...v }));
  return { totalRows: rows.length, byRegime, oldestRecordedAt: oldest, newestRecordedAt: newest };
}

function printCarrySummary(s: CarrySummary, daysAgo: number): void {
  console.log(`\n## 3. EvolutionInstanceCarry 蓄積状況 (直近 ${daysAgo} 日)\n`);
  console.log(`- **総行数**: ${s.totalRows} 行 (Phase B-2 動作確認)`);
  if (s.totalRows === 0) {
    console.log(`- ⚠ 行なし — Phase A multi-gen が動いていない可能性 (= \`EVOLUTION_GENERATIONS\` 未設定)`);
    return;
  }
  console.log(`- **最古**: ${s.oldestRecordedAt?.toISOString() ?? '–'}`);
  console.log(`- **最新**: ${s.newestRecordedAt?.toISOString() ?? '–'}`);
  console.log(`\n| Regime | 行数 | 最新 recordedAt |`);
  console.log(`|---|---:|---|`);
  for (const r of s.byRegime) {
    console.log(`| ${r.regime} | ${r.rows} | ${r.latestRecordedAt?.toISOString() ?? '–'} |`);
  }
}

// =================================================================
// GenerationLesson 集計
// =================================================================

interface LessonSummary {
  totalRows: number;
  byCategory: Array<{ category: string; count: number }>;
  recentSamples: Array<{
    regime: string;
    generation: number;
    category: string;
    lesson: string;
    confidence: number | null;
    recordedAt: Date;
  }>;
}

async function summarizeLessons(
  prisma: PrismaClient,
  daysAgo: number,
  regime: string | null,
): Promise<LessonSummary> {
  const cutoff = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const rows = await prisma.generationLesson.findMany({
    where: {
      recordedAt: { gte: cutoff },
      ...(regime ? { regime } : {}),
    },
    orderBy: { recordedAt: 'desc' },
    take: 1000,
  });

  const catMap = new Map<string, number>();
  for (const r of rows) {
    catMap.set(r.category, (catMap.get(r.category) ?? 0) + 1);
  }
  const byCategory = Array.from(catMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }));

  const recentSamples = rows.slice(0, 5).map((r) => ({
    regime: r.regime,
    generation: r.generation,
    category: r.category,
    lesson: r.lesson,
    confidence: r.confidence,
    recordedAt: r.recordedAt,
  }));

  return { totalRows: rows.length, byCategory, recentSamples };
}

function printLessonSummary(s: LessonSummary, daysAgo: number): void {
  console.log(`\n## 4. GenerationLesson 集計 (直近 ${daysAgo} 日)\n`);
  console.log(`- **総行数**: ${s.totalRows} 行 (Phase D-1b 動作確認)`);
  if (s.totalRows === 0) {
    console.log(`- ⚠ 行なし — Phase D-1b の GenerationReflectionAgent が動いていない可能性`);
    return;
  }

  console.log(`\n### 4.1 Category 分布\n`);
  console.log(`| Category | 件数 |`);
  console.log(`|---|---:|`);
  for (const c of s.byCategory) {
    console.log(`| ${c.category} | ${c.count} |`);
  }

  console.log(`\n### 4.2 最新 lesson サンプル (5 件)\n`);
  for (const sample of s.recentSamples) {
    const conf = sample.confidence !== null ? sample.confidence.toFixed(2) : '–';
    console.log(
      `- [${sample.regime} gen=${sample.generation} ${sample.category} confidence=${conf}] ` +
        `${sample.lesson.slice(0, 200)} (${sample.recordedAt.toISOString()})`,
    );
  }
}

// =================================================================
// main
// =================================================================

async function main(): Promise<void> {
  const argResult = parseArgs(process.argv);
  if ('error' in argResult) {
    console.error(`引数エラー: ${argResult.error}`);
    process.exit(1);
  }
  const args = argResult;
  if (args.showHelp) {
    printHelp();
    process.exit(0);
  }

  const prisma = new PrismaClient();
  try {
    console.log(`# Filter Evolution 観察結果 (実行: ${new Date().toISOString()})\n`);
    console.log(`- 集計期間: 過去 ${args.days} 日`);
    if (args.regime) console.log(`- regime フィルタ: ${args.regime}`);
    else console.log(`- regime: 全 regime`);

    const btSummary = await summarizeBacktestRuns(prisma, args.days, args.regime);
    printBtRunSummary(btSummary, args.days, args.regime);

    const liftDist = await summarizeWinRateLift(prisma, args.days, args.regime);
    printLiftDistribution(liftDist, args.days, args.regime);

    const carrySummary = await summarizeCarryState(prisma, args.days, args.regime);
    printCarrySummary(carrySummary, args.days);

    const lessonSummary = await summarizeLessons(prisma, args.days, args.regime);
    printLessonSummary(lessonSummary, args.days);

    console.log(`\n---\n*生成: scripts/analyze-evolution-observations.ts (Phase Obs-A)*`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('実行時エラー:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
