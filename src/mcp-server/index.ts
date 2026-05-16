#!/usr/bin/env node
/**
 * Side-B AI Trade MCP Server
 *
 * AIエージェントが自律的にPDCAサイクルを回すためのMCPサーバー。
 * stdio 形式で通信し、以下の4つのツールを提供する:
 *
 * 1. get_market_ohlcv    — 相場データ取得
 * 2. create_trade_plan   — トレード計画作成
 * 3. execute_virtual_trade — 仮想トレード実行
 * 4. search_past_notes   — 過去ノート検索
 *
 * @see docs/side-b/
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ── 既存サービス・リポジトリ ──
import { MarketDataService } from '../services/marketDataService';
import { PlanRepository, type CreatePlanInput } from '../side-b/repositories/planRepository';
import {
    createTradeFromPlan,
} from '../side-b/services/virtualTradeService';
import {
    findAITradeNotes,
    findAITradeNotesBySymbol,
    findRecentAITradeNotes,
} from '../side-b/repositories/aiNoteRepository';
import type { AITradeNote } from '../side-b/models/aiTradeNote';
import { prisma } from '../backend/db/client';

// ===========================================
// サーバー初期化
// ===========================================

const server = new McpServer(
    {
        name: 'side-b-trade-server',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
        },
    },
);

// サービスインスタンス
const marketDataService = new MarketDataService();
const planRepository = new PlanRepository();

// ===========================================
// Tool 1: get_market_ohlcv（相場確認）
// ===========================================

server.tool(
    'get_market_ohlcv',
    '指定した通貨ペアと時間足のOHLCVデータを取得する。AIはこのデータを分析して相場状況を把握する。',
    {
        symbol: z.string().describe('通貨ペア（例: "BTC/USD", "EUR/USD", "XAU/USD"）'),
        timeframe: z
            .enum(['1min', '5min', '15min', '30min', '1h', '4h', '1day'])
            .default('15min')
            .describe('時間足'),
        limit: z
            .number()
            .int()
            .min(1)
            .max(500)
            .default(100)
            .describe('取得するローソク足の本数（1〜500、デフォルト: 100）'),
    },
    async ({ symbol, timeframe, limit }) => {
        try {
            // timeframe を内部形式に変換
            const internalTimeframe = convertTimeframeToInternal(timeframe);
            const data = await marketDataService.getHistoricalData(symbol, internalTimeframe, limit);

            if (!data || data.length === 0) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({
                                success: false,
                                error: `${symbol} (${timeframe}) のデータが見つかりません。シンボルまたは時間足を確認してください。`,
                            }),
                        },
                    ],
                };
            }

            // AIが扱いやすい形式に整形
            const ohlcv = data.map((d) => ({
                timestamp: d.timestamp.toISOString(),
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
                volume: d.volume,
                indicators: d.indicators ?? {},
            }));

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            symbol,
                            timeframe,
                            count: ohlcv.length,
                            data: ohlcv,
                        }),
                    },
                ],
            };
        } catch (error) {
            return formatError('get_market_ohlcv', error);
        }
    },
);

// ===========================================
// Tool 2: create_trade_plan（戦略立案）
// ===========================================

server.tool(
    'create_trade_plan',
    'トレード計画を作成して保存する。AI自身の分析に基づいてエントリー・利確・損切りのシナリオを定義する。',
    {
        researchId: z.string().describe('紐づくリサーチのID'),
        targetDate: z.string().describe('対象日（ISO 8601 形式: "2026-02-10"）'),
        symbol: z.string().describe('通貨ペア（例: "BTC/USD"）'),
        marketAnalysis: z
            .object({
                regime: z
                    .enum(['trending_up', 'trending_down', 'ranging', 'volatile', 'unknown'])
                    .describe('市場レジーム'),
                keyLevels: z
                    .object({
                        resistance: z.array(z.number()).describe('レジスタンスライン'),
                        support: z.array(z.number()).describe('サポートライン'),
                    })
                    .describe('主要価格レベル'),
                summary: z.string().describe('市場分析の要約'),
            })
            .describe('市場分析データ'),
        scenarios: z
            .array(
                z.object({
                    id: z.string().describe('シナリオID（UUID推奨）'),
                    direction: z.enum(['long', 'short']).describe('方向'),
                    priority: z
                        .enum(['primary', 'secondary', 'alternative'])
                        .default('primary')
                        .describe('優先度'),
                    entry: z
                        .object({
                            price: z.number().describe('エントリー価格'),
                            condition: z.string().describe('エントリー条件の説明'),
                        })
                        .describe('エントリー条件'),
                    stopLoss: z
                        .object({
                            price: z.number().describe('ストップロス価格'),
                            reason: z.string().optional().describe('SL設定の根拠'),
                        })
                        .describe('損切り設定'),
                    takeProfit: z
                        .object({
                            price: z.number().describe('テイクプロフィット価格'),
                            reason: z.string().optional().describe('TP設定の根拠'),
                        })
                        .describe('利確設定'),
                    rationale: z.string().describe('このシナリオの根拠'),
                    confidence: z.number().min(0).max(1).optional().describe('確信度（0〜1）'),
                }),
            )
            .min(1)
            .describe('トレードシナリオ（1つ以上）'),
        overallConfidence: z.number().min(0).max(1).optional().describe('全体の確信度'),
        warnings: z.array(z.string()).optional().describe('注意事項'),
        aiModel: z.string().optional().describe('使用したAIモデル名'),
    },
    async ({
        researchId,
        targetDate,
        symbol,
        marketAnalysis,
        scenarios,
        overallConfidence,
        warnings,
        aiModel,
    }) => {
        try {
            const input: CreatePlanInput = {
                researchId,
                targetDate: new Date(targetDate),
                symbol,
                marketAnalysis: marketAnalysis as CreatePlanInput['marketAnalysis'],
                scenarios: scenarios as CreatePlanInput['scenarios'],
                overallConfidence,
                warnings,
                aiModel,
            };

            const plan = await planRepository.create(input);

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            message: `トレードプランを作成しました (ID: ${plan.id})`,
                            plan: {
                                id: plan.id,
                                symbol: plan.symbol,
                                targetDate: plan.targetDate,
                                scenarioCount: plan.scenarios.length,
                                overallConfidence: plan.overallConfidence,
                                createdAt: plan.createdAt,
                            },
                        }),
                    },
                ],
            };
        } catch (error) {
            return formatError('create_trade_plan', error);
        }
    },
);

// ===========================================
// Tool 3: execute_virtual_trade（仮想トレード実行）
// ===========================================

server.tool(
    'execute_virtual_trade',
    '保存されたトレードプランに基づいて仮想トレードを実行する。プランのシナリオに従い、エントリー待ちの注文を作成する。',
    {
        planId: z.string().describe('実行するプランのID'),
        scenarioId: z
            .string()
            .optional()
            .describe('実行するシナリオのID（省略時: 最初のシナリオ）'),
    },
    async ({ planId, scenarioId }) => {
        try {
            const result = await createTradeFromPlan(planId, scenarioId);

            if (!result.success) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({
                                success: false,
                                error: result.error,
                            }),
                        },
                    ],
                };
            }

            const trade = result.trade!;
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            message: `仮想トレードを作成しました (ID: ${trade.id})`,
                            trade: {
                                id: trade.id,
                                symbol: trade.symbol,
                                direction: trade.direction,
                                status: trade.status,
                                plannedEntry: trade.plannedEntry,
                                stopLoss: trade.stopLoss,
                                takeProfit: trade.takeProfit,
                                createdAt: trade.createdAt,
                            },
                        }),
                    },
                ],
            };
        } catch (error) {
            return formatError('execute_virtual_trade', error);
        }
    },
);

// ===========================================
// Tool 4: search_past_notes（振り返り）
// ===========================================

server.tool(
    'search_past_notes',
    '過去のAIトレードノートを検索・参照する。勝敗や通貨ペアで絞り込み、過去の学びを活かした戦略立案に使う。',
    {
        symbol: z.string().optional().describe('通貨ペアでフィルター（例: "BTC/USD"）'),
        outcome: z
            .enum(['win', 'loss', 'breakeven'])
            .optional()
            .describe('トレード結果でフィルター'),
        from: z.string().optional().describe('開始日（ISO 8601 形式: "2026-01-01"）'),
        to: z.string().optional().describe('終了日（ISO 8601 形式: "2026-02-10"）'),
        limit: z.number().int().min(1).max(100).default(20).describe('取得件数（最大100）'),
    },
    async ({ symbol, outcome, from, to, limit }) => {
        try {
            // シンボル指定のみの場合は専用メソッドを使う
            if (symbol && !outcome && !from && !to) {
                const notes = await findAITradeNotesBySymbol(symbol, limit);
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({
                                success: true,
                                query: { symbol, limit },
                                count: notes.length,
                                notes: notes.map(formatNote),
                            }),
                        },
                    ],
                };
            }

            // フィルター付き検索
            if (symbol || outcome || from || to) {
                const result = await findAITradeNotes({
                    symbol,
                    outcome,
                    from,
                    to,
                    limit,
                });
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({
                                success: true,
                                query: { symbol, outcome, from, to, limit },
                                count: result.notes.length,
                                total: result.total,
                                notes: result.notes.map(formatNote),
                            }),
                        },
                    ],
                };
            }

            // フィルターなし → 最近のノートを取得
            const notes = await findRecentAITradeNotes(limit);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            query: { limit },
                            count: notes.length,
                            notes: notes.map(formatNote),
                        }),
                    },
                ],
            };
        } catch (error) {
            return formatError('search_past_notes', error);
        }
    },
);

// ===========================================
// ヘルパー関数
// ===========================================

/**
 * timeframe を MarketDataService の内部形式に変換
 */
function convertTimeframeToInternal(tf: string): string {
    const map: Record<string, string> = {
        '1min': '1min',
        '5min': '5min',
        '15min': '15m',
        '30min': '30min',
        '1h': '1h',
        '4h': '4h',
        '1day': '1day',
    };
    return map[tf] ?? tf;
}

/**
 * AITradeNote をAIに渡しやすい形式にフォーマット
 */
function formatNote(note: AITradeNote) {
    return {
        id: note.id,
        date: note.date,
        symbol: note.symbol,
        direction: note.direction,
        outcome: note.result.outcome,
        pnlPips: note.result.pnlPips,
        pnlPercentage: note.result.pnlPercentage,
        riskRewardActual: note.result.riskRewardActual,
        holdingDuration: note.result.holdingDuration,
        learnings: note.learnings,
        planEvaluation: note.planEvaluation,
    };
}

/**
 * エラーレスポンスを統一フォーマットで返す
 */
/**
 * エラーレスポンスを統一フォーマットで返す。
 * catch ハンドラからの呼び出しを想定しており、入力型は本質的に「型不明」のため
 * 型ガードでメッセージ抽出する設計上 unknown を受ける必要がある。
 */
// eslint-disable-next-line no-restricted-syntax -- catch ハンドラからのエラー値を narrow する責務上 unknown を受ける
function formatError(toolName: string, error: unknown) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    const stack = error instanceof Error ? error.stack : undefined;

    console.error(`[MCP] ${toolName} error:`, message);
    if (stack) console.error(stack);

    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify({
                    success: false,
                    error: message,
                    tool: toolName,
                }),
            },
        ],
        isError: true,
    };
}

// ===========================================
// サーバー起動
// ===========================================

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[MCP] Side-B Trade Server started (stdio mode)');
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.error('[MCP] Shutting down...');
    await prisma.$disconnect();
    await server.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.error('[MCP] Shutting down...');
    await prisma.$disconnect();
    await server.close();
    process.exit(0);
});

main().catch((error) => {
    console.error('[MCP] Fatal error:', error);
    process.exit(1);
});
