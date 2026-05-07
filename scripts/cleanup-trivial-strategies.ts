#!/usr/bin/env npx tsx
/**
 * StrategyPopulation の汚染戦略を一括 pruning するスクリプト。
 *
 * 背景 (post-Phase 5A):
 *   2026-05-07 の本番 smoke で `validationConfirmed=0` の真因を分析した結果、
 *   StrategyPopulation の永続化ファイル (`data/evolution/strategy-population.json`)
 *   に以下の **汚染個体** が大量に残っていることが判明:
 *   - `close > 0` / `volume > 0` 等の数学的に常時 true な leaf
 *   - `lens: 'dow_theory'` / `lens: 'current_analysis'` 等の未対応 lens
 *
 *   これら汚染個体を mutation/crossover の親として継承するため、新指標
 *   (PR #117 で追加した ema/sma/macd/bb 等) に進化が向かわない。
 *
 *   schema レベルでの trivial 弾き (本コミット同梱) は **今後の汚染を予防** する
 *   が、既に永続化された汚染個体は別途削除する必要がある。
 *
 * 削除条件 (= mutation 親プールから除外する個体):
 *   1. trigger group 内に `ConditionSchema.safeParse` が **fail** する leaf を含む
 *      (= 数学的常時 true / value-compareTarget 排他違反 / 期間系 params 整数性違反 等)
 *   2. trigger group 内に **非対応 lens** (= ohlcv / rsi / atr 以外) の leaf を含む
 *
 * 使い方:
 *   npx tsx scripts/cleanup-trivial-strategies.ts          # dry-run
 *   npx tsx scripts/cleanup-trivial-strategies.ts --apply  # 実書き換え
 *
 * 安全性:
 *   - dry-run がデフォルト。`--apply` を渡さない限り何も書かない
 *   - 書き換え前に `.bak` バックアップを作成
 *   - 個体ごとに削除理由を出力
 */

import { promises as fs } from 'fs';
import path from 'path';

import {
  ConditionSchema,
  type ConditionGroup,
  type StrategyDSL,
} from '../src/side-b/strategy_dsl/schema';

/** Side-A の SUPPORTED_LENS_FEATURE_MAP と整合する許容 lens (Python 評価器も同等)。 */
const SUPPORTED_LENS_NAMES = new Set(['ohlcv', 'rsi', 'atr']);

interface PopulationFile {
  version: 1;
  populations: Record<string, StrategyDSL[]>;
}

interface PruneReason {
  type: 'schema_fail' | 'unsupported_lens';
  detail: string;
}

function findPruneReason(group: ConditionGroup | undefined): PruneReason | null {
  if (!group) return null;
  for (const c of group.conditions) {
    if ('logic' in c) {
      const nested = findPruneReason(c);
      if (nested) return nested;
    } else {
      // 1. ConditionSchema (trivial / 排他性 / 整数性 等を含む) で fail なら削除
      const result = ConditionSchema.safeParse(c);
      if (!result.success) {
        const issue = result.error.issues[0];
        return {
          type: 'schema_fail',
          detail: `${c.lens}.${c.feature} ${c.op} ${JSON.stringify(c.value)}: ${issue.message}`,
        };
      }
      // 2. 非対応 lens (= 評価器が動かない) なら削除
      if (!SUPPORTED_LENS_NAMES.has(c.lens)) {
        return {
          type: 'unsupported_lens',
          detail: `${c.lens}.${c.feature} (= 評価器対象外、常に false 評価される)`,
        };
      }
    }
  }
  return null;
}

function extractTrigger(strategy: StrategyDSL): ConditionGroup | undefined {
  const entry = strategy.entry as { trigger?: ConditionGroup; triggerConditions?: ConditionGroup };
  return entry.trigger ?? entry.triggerConditions;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const filePath = path.join(process.cwd(), 'data', 'evolution', 'strategy-population.json');

  console.log(`[cleanup-trivial-strategies] file: ${filePath}`);
  console.log(`[cleanup-trivial-strategies] mode: ${apply ? 'APPLY (書き換える)' : 'DRY-RUN (--apply で実行)'}`);

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    console.error(`[cleanup-trivial-strategies] ERROR: ファイル読み込み失敗 (${(err as Error).message})`);
    process.exit(1);
  }

  let data: PopulationFile;
  try {
    data = JSON.parse(raw) as PopulationFile;
  } catch (err) {
    console.error(`[cleanup-trivial-strategies] ERROR: JSON parse 失敗 (${(err as Error).message})`);
    process.exit(1);
  }

  if (data.version !== 1) {
    console.error(`[cleanup-trivial-strategies] ERROR: 未対応 version=${data.version}`);
    process.exit(1);
  }

  let totalRemoved = 0;
  let totalKept = 0;
  const reasonCounts: Record<string, number> = { schema_fail: 0, unsupported_lens: 0 };

  for (const [regime, strategies] of Object.entries(data.populations)) {
    const filtered: StrategyDSL[] = [];
    let regimeRemoved = 0;
    for (const s of strategies) {
      const trigger = extractTrigger(s);
      const reason = findPruneReason(trigger);
      if (reason) {
        regimeRemoved++;
        totalRemoved++;
        reasonCounts[reason.type]++;
        console.log(`  [regime=${regime}] REMOVE id=${s.id} (${reason.type}): ${reason.detail}`);
      } else {
        filtered.push(s);
        totalKept++;
      }
    }
    if (apply) {
      data.populations[regime] = filtered;
    }
    if (regimeRemoved > 0) {
      console.log(
        `[regime=${regime}] removed=${regimeRemoved}, kept=${strategies.length - regimeRemoved}`,
      );
    }
  }

  console.log(`\n[cleanup-trivial-strategies] summary:`);
  console.log(`  total removed: ${totalRemoved}`);
  console.log(`    - schema_fail (trivial / 排他違反 / 整数性 等): ${reasonCounts.schema_fail}`);
  console.log(`    - unsupported_lens (ohlcv/rsi/atr 以外): ${reasonCounts.unsupported_lens}`);
  console.log(`  total kept: ${totalKept}`);

  if (apply) {
    const backupPath = `${filePath}.bak.${Date.now()}`;
    await fs.writeFile(backupPath, raw, 'utf-8');
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`\n[cleanup-trivial-strategies] APPLIED.`);
    console.log(`  backup: ${backupPath}`);
    console.log(`  written: ${filePath}`);
  } else {
    console.log(`\n[cleanup-trivial-strategies] dry-run only. 実行する場合は --apply を渡す。`);
  }
}

main().catch((err) => {
  console.error('[cleanup-trivial-strategies] FAILED:', err);
  process.exit(1);
});
