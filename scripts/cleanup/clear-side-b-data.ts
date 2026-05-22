/**
 * Side-B 系 DB データの一括クリア (2026-05-22 Nekoさん 判断)
 *
 * 目的:
 * Phase B 主要 3 PR (#245 OHLCV / #246 Evolution seed / #247 Scheduler) のマージで
 * hardcode 排除が完了したため、旧 hardcode 期に生成された全 Side-B データ
 * (仮説 / 進化結果 / AI 出力 / ノート 等) を一括クリアして、Phase B 修正後の生成物
 * だけで運用観察できる状態に戻す。
 *
 * Nekoさん 判断 (2026-05-22): 「ユーザー閲覧の場所も信頼できる情報自体ほとんど
 * 有用的ではない (= 分かりにくい)」のため、AI ノートを含む Side-B 全テーブルを
 * TRUNCATE して綺麗な状態で再開する。
 *
 * 対象テーブル (FK 削除順序、子 → 親):
 *   1. AgentRunStep → AgentRun (= ADK trace 履歴)
 *   2. WalkForwardSplit → WalkForwardRun
 *   3. AINoteSummary
 *   4. AITradeNote → VirtualTrade → AITradePlan → ResearchOutput / MarketResearch
 *   5. VirtualPortfolio
 *   6. StrategyBacktestEvent / StrategyBacktestResult → StrategyBacktestRun
 *   7. ScreeningBacktestRun
 *   8. MonteCarloRun
 *   9. EvolutionBacktestRun
 *  10. GenerationLesson
 *  11. EvolutionInstanceCarry
 *  12. EdgeHypothesis
 *  13. AgentRestructureProposal
 *  14. StrategyDraft
 *
 * **保持対象** (= Strategy 系 = ユーザー定義の戦略エンティティ本体):
 *   - Strategy / StrategyVersion / StrategyNote / StrategyAlert / StrategyAlertLog
 *   - StrategyComparisonSession / StrategyComparisonResult / StrategyCorrelation
 *   - PortfolioOptimization
 *   - User / Watchlist / 他の Side-A 系
 *
 * 使い方:
 *   # DRY_RUN (= 削除予定件数のみ表示、実 DELETE しない、default)
 *   DATABASE_URL=... npx tsx scripts/cleanup/clear-side-b-data.ts
 *
 *   # 実 DELETE
 *   DATABASE_URL=... npx tsx scripts/cleanup/clear-side-b-data.ts --apply
 *
 * 出力例:
 *   [DRY_RUN] AgentRunStep        : 削除予定 0 件
 *   [DRY_RUN] AgentRun            : 削除予定 0 件
 *   ...
 *   [DRY_RUN] EdgeHypothesis      : 削除予定 756 件
 *   合計削除予定: 3790 件
 *   実 DELETE するには --apply を付けて再実行
 */

import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';

loadEnv();

interface CliArgs {
  apply: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let apply = false;
  for (const arg of args) {
    if (arg === '--apply') apply = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`usage: npx tsx scripts/cleanup/clear-side-b-data.ts [--apply]`);
      console.log(`       (default: DRY_RUN モード、削除予定件数のみ表示)`);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return { apply };
}

interface DeleteTarget {
  table: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delegate: any;
  note?: string;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const mode = args.apply ? 'APPLY' : 'DRY_RUN';
  const prisma = new PrismaClient();

  // FK 削除順序 (子 → 親、各エントリは独立した deleteMany 呼び出し)
  const targets: DeleteTarget[] = [
    // === Run Ledger (= ADK trace) ===
    { table: 'AgentRunStep', delegate: prisma.agentRunStep, note: 'AgentRun の子' },
    { table: 'AgentRun', delegate: prisma.agentRun, note: 'ADK trace 履歴' },
    // === WalkForward 系 ===
    { table: 'WalkForwardSplit', delegate: prisma.walkForwardSplit, note: 'WalkForwardRun の子' },
    { table: 'WalkForwardRun', delegate: prisma.walkForwardRun },
    // === AI ノート系 (上から子) ===
    { table: 'AINoteSummary', delegate: prisma.aINoteSummary, note: 'AITradeNote 集約' },
    { table: 'AITradeNote', delegate: prisma.aITradeNote, note: 'VirtualTrade の子' },
    { table: 'VirtualTrade', delegate: prisma.virtualTrade, note: 'AITradePlan の子' },
    { table: 'AITradePlan', delegate: prisma.aITradePlan, note: 'ResearchOutput/MarketResearch の子' },
    { table: 'ResearchOutput', delegate: prisma.researchOutput },
    { table: 'MarketResearch', delegate: prisma.marketResearch, note: 'Phase D 削除予定 (現状 0 行想定)' },
    { table: 'VirtualPortfolio', delegate: prisma.virtualPortfolio, note: 'default 残高 100k で再作成想定' },
    // === 戦略 BT 系 (子 → 親) ===
    { table: 'StrategyBacktestEvent', delegate: prisma.strategyBacktestEvent, note: 'StrategyBacktestRun の子' },
    { table: 'StrategyBacktestResult', delegate: prisma.strategyBacktestResult, note: 'StrategyBacktestRun の子' },
    { table: 'StrategyBacktestRun', delegate: prisma.strategyBacktestRun, note: 'Strategy 本体は残す' },
    // === スクリーニング / モンテカルロ ===
    { table: 'ScreeningBacktestRun', delegate: prisma.screeningBacktestRun, note: 'EdgeHypothesis 参照 (shadow FK)' },
    { table: 'MonteCarloRun', delegate: prisma.monteCarloRun },
    // === 進化 BT 系 ===
    { table: 'EvolutionBacktestRun', delegate: prisma.evolutionBacktestRun },
    { table: 'GenerationLesson', delegate: prisma.generationLesson },
    { table: 'EvolutionInstanceCarry', delegate: prisma.evolutionInstanceCarry },
    // === 仮説 / メタ進化 / 戦略下書き ===
    { table: 'EdgeHypothesis', delegate: prisma.edgeHypothesis, note: '仮説本体、最後に削除' },
    { table: 'AgentRestructureProposal', delegate: prisma.agentRestructureProposal },
    { table: 'StrategyDraft', delegate: prisma.strategyDraft },
  ];

  console.log(`\n=== Side-B Data Clear (${mode}) ===\n`);
  if (mode === 'DRY_RUN') {
    console.log(`(削除予定件数のみ表示。実 DELETE には --apply を付けて再実行)\n`);
  } else {
    console.log(`⚠️ APPLY モード: 実際に DELETE します。\n`);
  }

  let totalDeleted = 0;
  try {
    for (const t of targets) {
      const before = await t.delegate.count();
      const noteStr = t.note ? `  (${t.note})` : '';

      if (mode === 'DRY_RUN') {
        console.log(
          `[DRY_RUN] ${t.table.padEnd(28)}: 削除予定 ${String(before).padStart(7)} 件${noteStr}`,
        );
        totalDeleted += before;
      } else {
        const result = await t.delegate.deleteMany({});
        const after = await t.delegate.count();
        console.log(
          `[APPLY]   ${t.table.padEnd(28)}: 削除 ${String(result.count).padStart(7)} 件 (残 ${after} 件)${noteStr}`,
        );
        totalDeleted += result.count;
        if (after !== 0) {
          console.warn(`  ⚠️ ${t.table} に削除残あり (FK 制約違反の可能性、要調査)`);
        }
      }
    }

    console.log(`\n合計${mode === 'APPLY' ? '削除' : '削除予定'}: ${totalDeleted} 件\n`);

    if (mode === 'DRY_RUN') {
      console.log(`実 DELETE するには --apply を付けて再実行してください。\n`);
    } else {
      console.log(`✅ クリア完了。Phase B 修正後の生成物のみで運用観察を開始できます。\n`);
    }
  } catch (err) {
    console.error('クリア失敗:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('main 失敗:', err);
  process.exit(1);
});
