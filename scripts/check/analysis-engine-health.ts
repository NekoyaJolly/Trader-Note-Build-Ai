/**
 * analysis-engine 接続性確認スクリプト (P0 サポート)
 *
 * 目的:
 * - Screening が全 `not_testable` (SO.C) に落ちている原因が **接続性そのもの**
 *   なのか、payload や Python 側ロジックの問題なのかを切り分けるための最小確認。
 * - `/health` 1 回 GET だけを行い、analysis-engine 側に書き込みは発生させない。
 *
 * 使い方:
 *   ANALYSIS_ENGINE_URL=https://... npx tsx scripts/check/analysis-engine-health.ts
 *   # または .env で ANALYSIS_ENGINE_URL を設定済みなら引数なしで OK
 *
 * 出力:
 *   - target URL (= 解決後の baseUrl)
 *   - GET /health の status / response.data 抜粋 (成功時)
 *   - 失敗時は AxiosError の status / code / message / response.data 先頭 200 文字を構造化出力
 *     (= P0 で ScreeningOrchestrator.buildBacktestErrorReason に入れた整形と同等)
 *
 * 削除条件:
 *   - analysis-engine 監視が Observer MVP (P1a) または専用 SRE ダッシュボードに統合された場合
 *   - Screening 全 not_testable バグが恒久解消し再発監視が不要になった場合
 *
 * @see docs/diagnostics/2026-05-18_g2_pipeline_audit.md §3.4 / §6.4 / §7 Hypothesis D
 */

import { config as loadEnv } from 'dotenv';
import axios from 'axios';
import { safeStringify } from '../../src/utils/safeStringify';

loadEnv();

// PR #240 Copilot review #2: `ScreeningOrchestrator.buildBacktestErrorReason` と
// 整形ロジックを一本化 (= 観測性の差分と二次例外リスクを排除)。本 script は scripts/
// 配下のため `unknown` を引数に取ることが許容される (AGENTS.md §2.1)。
// eslint-disable-next-line no-restricted-syntax -- catch 由来の任意型を整形する責務
function buildErrorReport(err: unknown): string {
    if (axios.isAxiosError(err)) {
        const parts: string[] = [];
        if (err.code) parts.push(`code=${err.code}`);
        const status = err.response?.status;
        if (status !== undefined) parts.push(`status=${status}`);
        if (err.message) parts.push(`message=${err.message}`);
        if (err.response?.data !== undefined && err.response?.data !== null) {
            parts.push(`body=${safeStringify(err.response.data).slice(0, 200)}`);
        }
        return parts.join(' / ');
    }
    if (err instanceof Error) {
        return `${err.name}: ${err.message || '(empty)'}`;
    }
    return String(err);
}

async function main(): Promise<void> {
    const baseUrl = process.env.ANALYSIS_ENGINE_URL || 'http://analysis-engine:8000';
    console.log('');
    console.log('========================================');
    console.log('  analysis-engine 接続性確認');
    console.log('========================================');
    console.log(`target: ${baseUrl}`);
    console.log('');

    try {
        const res = await axios.get(`${baseUrl}/health`, {
            timeout: 10_000,
            // production の Cloud Run などで認証ヘッダが必要な場合の対応余地を残す
            // (現状 analysis-engine /health は無認証で OK の前提)
        });
        // PR #240 Copilot review #2: 二次例外吸収を含めて safeStringify に統一
        const bodyStr = safeStringify(res.data);
        console.log('--- 成功 ---');
        console.log(`status: ${res.status}`);
        console.log(`body  : ${bodyStr.slice(0, 200)}`);
        console.log('');
        console.log('結論: analysis-engine は到達可能。Screening 失敗は接続性以外の要因 (payload / 認証 / Python 側ロジック等)。');
    } catch (err) {
        console.log('--- 失敗 ---');
        console.log(buildErrorReport(err));
        console.log('');
        console.log('結論: analysis-engine が応答していない。Screening 全 not_testable の直接原因がこれ。');
        process.exit(2);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
