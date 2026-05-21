/**
 * Screening 全 not_testable バグの真因実測スクリプト (P0)
 *
 * 目的:
 * - `EdgeHypothesis.status = 'not_testable'` の仮説について、`statusNote` (= reason)
 *   を 5 経路に分類して集計する。
 * - g2 audit (2026-05-18) §6.4 で「直近 80% が not_testable」と判明したが、5 経路
 *   (SO.A/B/C + SA.A/B) のどれが主因かは未測定。本スクリプトで主因経路を特定する。
 *
 * 5 経路と reason 文字列 prefix:
 *   - SO.A: '仮説に symbols が設定されていない'           (ScreeningOrchestrator.ts:158)
 *   - SO.B: 'OHLCV補完失敗: ...'                          (ScreeningOrchestrator.ts:166)
 *   - SO.C: 'analysis-engine BT 実行失敗: ...'             (ScreeningOrchestrator.ts:191)
 *   - SA.A: 'screeningBacktestRunId が無い ...'            (StrategistAgent.ts:106)
 *   - SA.B: 'BacktesterAgent 実行失敗: ...'                (StrategistAgent.ts:118)
 *
 * 使い方:
 *   DATABASE_URL=... npx tsx scripts/check/edge-hypothesis-not-testable-reasons.ts
 *
 * オプション:
 *   --since=YYYY-MM-DD  集計開始日 (default: 直近 30 日)
 *   --sample=N          各経路の代表 reason を N 件サンプル表示 (default: 3)
 *
 * 出力:
 *   - 期間内 not_testable 総数
 *   - 5 経路 + その他の分類別件数 + 比率
 *   - 各経路から N 件のサンプル (createdAt / hypothesisId 先頭 8 桁 / symbols / reason 先頭 200 文字)
 *   - 最多経路を「推奨アクション」として明示
 *
 * 削除条件:
 *   - Screening 全 not_testable バグ解消 + 同種バグの再発監視運用 (Observer MVP / P1a)
 *     が確立した場合、または Observer MVP 内に同等の集計機能が統合された場合
 *
 * @see docs/diagnostics/2026-05-18_g2_pipeline_audit.md §3.4 / §6.4
 * @see docs/diagnostics/2026-05-19_loops_flow_diagram.html (既知の不整合 §1)
 */

import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';

loadEnv();

interface CliArgs {
    sinceIso: string;
    sampleCount: number;
}

function parseArgs(): CliArgs {
    const args = process.argv.slice(2);
    let sinceIso: string | undefined;
    let sampleCount = 3;

    for (const arg of args) {
        if (arg.startsWith('--since=')) {
            sinceIso = arg.slice('--since='.length);
        } else if (arg.startsWith('--sample=')) {
            const n = parseInt(arg.slice('--sample='.length), 10);
            if (Number.isFinite(n) && n > 0) sampleCount = n;
        }
    }

    if (!sinceIso) {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        sinceIso = d.toISOString().split('T')[0];
    }
    return { sinceIso, sampleCount };
}

// 経路分類: reason prefix → 経路ラベル
const ROUTE_RULES: { label: string; description: string; matcher: (reason: string) => boolean }[] = [
    {
        label: 'SO.A',
        description: '仮説に symbols 未設定 (ScreeningOrchestrator.ts:158)',
        matcher: (r) => r.includes('仮説に symbols が設定されていない'),
    },
    {
        label: 'SO.B',
        description: 'OHLCV 補完失敗 (ScreeningOrchestrator.ts:166)',
        matcher: (r) => r.startsWith('OHLCV補完失敗'),
    },
    {
        label: 'SO.C',
        description: 'analysis-engine 通信エラー (ScreeningOrchestrator.ts:191)',
        matcher: (r) => r.startsWith('analysis-engine BT 実行失敗'),
    },
    {
        label: 'SA.A',
        description: 'screeningBacktestRunId 不在 (StrategistAgent.ts:106)',
        matcher: (r) => r.startsWith('screeningBacktestRunId が無い'),
    },
    {
        label: 'SA.B',
        description: 'BacktesterAgent 実行失敗 (StrategistAgent.ts:118)',
        matcher: (r) => r.startsWith('BacktesterAgent 実行失敗'),
    },
];

interface RouteAggregate {
    label: string;
    description: string;
    count: number;
    samples: { id: string; createdAt: Date; symbols: string[]; reason: string }[];
}

async function main(): Promise<void> {
    const { sinceIso, sampleCount } = parseArgs();
    const since = new Date(`${sinceIso}T00:00:00Z`);
    if (Number.isNaN(since.getTime())) {
        console.error(`不正な --since: ${sinceIso}`);
        process.exit(1);
    }

    const prisma = new PrismaClient();
    try {
        const rows = await prisma.edgeHypothesis.findMany({
            where: {
                status: 'not_testable',
                createdAt: { gte: since },
            },
            select: {
                id: true,
                createdAt: true,
                symbols: true,
                statusNote: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        console.log('');
        console.log('========================================');
        console.log(`  Screening not_testable 真因実測 (since=${sinceIso})`);
        console.log('========================================');
        console.log(`期間内 not_testable 仮説総数: ${rows.length}`);
        console.log('');

        if (rows.length === 0) {
            console.log('該当データなし。--since を伸ばすか、別 DB を確認してください。');
            return;
        }

        // 経路ごとに集計
        const aggregates: RouteAggregate[] = ROUTE_RULES.map((rule) => ({
            label: rule.label,
            description: rule.description,
            count: 0,
            samples: [],
        }));
        const unclassified: RouteAggregate = {
            label: 'OTHER',
            description: '5 経路のいずれにも当てはまらない (statusNote 空 or 未知 prefix)',
            count: 0,
            samples: [],
        };

        for (const row of rows) {
            const reason = row.statusNote ?? '';
            const ruleIdx = ROUTE_RULES.findIndex((rule) => rule.matcher(reason));
            const target = ruleIdx >= 0 ? aggregates[ruleIdx] : unclassified;
            target.count += 1;
            if (target.samples.length < sampleCount) {
                target.samples.push({
                    id: row.id,
                    createdAt: row.createdAt,
                    symbols: row.symbols,
                    reason,
                });
            }
        }

        // 集計表
        console.log('--- 経路別集計 ---');
        const total = rows.length;
        const printRow = (agg: RouteAggregate) => {
            const pct = total > 0 ? ((agg.count / total) * 100).toFixed(1) : '0.0';
            console.log(`  ${agg.label.padEnd(6)}  ${String(agg.count).padStart(5)}  ${pct.padStart(5)}%   ${agg.description}`);
        };
        for (const agg of aggregates) printRow(agg);
        printRow(unclassified);
        console.log('');

        // サンプル
        console.log('--- 経路ごとのサンプル ---');
        for (const agg of [...aggregates, unclassified]) {
            if (agg.count === 0) continue;
            console.log('');
            console.log(`[${agg.label}] ${agg.description}  (n=${agg.count})`);
            for (const s of agg.samples) {
                const sym = s.symbols.length > 0 ? s.symbols.join(',') : '(empty)';
                const reasonShort = s.reason.length > 200 ? s.reason.slice(0, 200) + '...' : s.reason;
                console.log(`  - ${s.createdAt.toISOString()}  id=${s.id.slice(0, 8)}  symbols=[${sym}]`);
                console.log(`    reason: ${reasonShort}`);
            }
        }
        console.log('');
        console.log('--- 推奨アクション ---');
        const top = [...aggregates, unclassified].sort((a, b) => b.count - a.count)[0];
        console.log(`最多経路: ${top.label} (${top.count}/${total} = ${((top.count / total) * 100).toFixed(1)}%)`);
        console.log(`次の修正対象: ${top.description}`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
