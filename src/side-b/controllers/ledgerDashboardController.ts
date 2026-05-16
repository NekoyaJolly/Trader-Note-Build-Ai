/**
 * Phase 4d: 台帳ダッシュボード・統計・ヘルス API
 *
 * @see docs/design/phase_4d_specification.md §4.5 §4.7
 */

import type { Request, Response } from 'express';
import type { ParsedQs } from 'qs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../backend/db/client';
import {
    edgeLedger as defaultEdgeLedger,
    type EdgeLedger,
} from '../ledger/EdgeLedger';
import { pythonBridge } from '../validation/python_bridge';

/**
 * Express の `req.query` 各フィールドが取りうる型 (`ParsedQs[string]` と同等)。
 * string / 配列 / ネストされた ParsedQs / undefined を含む。
 */
type QueryValue =
    | undefined
    | string
    | ParsedQs
    | (string | ParsedQs)[];

function toPositiveInt(raw: QueryValue, fallback: number, max?: number): number {
    if (typeof raw !== 'string') return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    if (max !== undefined) return Math.min(max, parsed);
    return parsed;
}

export class LedgerDashboardController {
    constructor(private readonly ledger: EdgeLedger = defaultEdgeLedger) {}

    /**
     * GET /api/side-b/stats/overview
     */
    overview = async (_req: Request, res: Response): Promise<void> => {
        try {
            const stats = await this.ledger.getStats();
            const now = new Date();
            const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
            const prevWeekStart = new Date(now.getTime() - 14 * 24 * 3600 * 1000);

            const [newHypothesesThisWeek, confirmedThisWeek, confirmedPrevWeek] =
                await Promise.all([
                    prisma.edgeHypothesis.count({
                        where: { createdAt: { gte: weekAgo } },
                    }),
                    prisma.edgeHypothesis.count({
                        where: {
                            status: 'confirmed',
                            statusUpdatedAt: { gte: weekAgo },
                        },
                    }),
                    prisma.edgeHypothesis.count({
                        where: {
                            status: 'confirmed',
                            statusUpdatedAt: {
                                gte: prevWeekStart,
                                lt: weekAgo,
                            },
                        },
                    }),
                ]);

            const lastCompleted = await prisma.edgeHypothesis.findFirst({
                where: {
                    status: { in: ['confirmed', 'rejected'] },
                    lastTestedAt: { not: null },
                },
                orderBy: { lastTestedAt: 'desc' },
                select: { lastTestedAt: true },
            });

            const validationAttemptsWeek = await prisma.edgeHypothesis.count({
                where: {
                    lastTestedAt: { gte: weekAgo },
                },
            });
            const validationSuccessWeek = await prisma.edgeHypothesis.count({
                where: {
                    status: 'confirmed',
                    lastTestedAt: { gte: weekAgo },
                },
            });
            const recentValidationSuccessRate =
                validationAttemptsWeek > 0
                    ? validationSuccessWeek / validationAttemptsWeek
                    : null;

            res.json({
                success: true,
                totalHypotheses: stats.totalCount,
                byStatus: stats.byStatus,
                confirmedCount: stats.byStatus.confirmed,
                newHypothesesThisWeek,
                confirmedThisWeek,
                confirmedPrevWeek,
                confirmedGrowthRate:
                    confirmedPrevWeek > 0
                        ? (confirmedThisWeek - confirmedPrevWeek) / confirmedPrevWeek
                        : null,
                lastValidationCompletedAt: lastCompleted?.lastTestedAt?.toISOString() ?? null,
                recentValidationSuccessRate,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[LedgerDashboardController] overview 失敗:', err);
            res.status(500).json({ success: false, error: message });
        }
    };

    /**
     * GET /api/side-b/stats/time-series?period=monthly&limit=12
     */
    timeSeries = async (req: Request, res: Response): Promise<void> => {
        const period =
            typeof req.query.period === 'string' && req.query.period === 'daily'
                ? 'daily'
                : 'monthly';
        const limit = toPositiveInt(req.query.limit, 12, 36);
        try {
            const rows =
                period === 'daily'
                    ? await prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
              SELECT date_trunc('day', "statusUpdatedAt") AS bucket,
                     count(*)::bigint AS count
              FROM "EdgeHypothesis"
              WHERE status = 'confirmed'
              GROUP BY 1
              ORDER BY 1 DESC
              LIMIT ${limit}
            `
                    : await prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
              SELECT date_trunc('month', "statusUpdatedAt") AS bucket,
                     count(*)::bigint AS count
              FROM "EdgeHypothesis"
              WHERE status = 'confirmed'
              GROUP BY 1
              ORDER BY 1 DESC
              LIMIT ${limit}
            `;
            const points = [...rows]
                .reverse()
                .map((r) => ({
                    periodStart: r.bucket.toISOString(),
                    confirmedCount: Number(r.count),
                }));
            res.json({ success: true, period, points });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[LedgerDashboardController] timeSeries 失敗:', err);
            res.status(500).json({ success: false, error: message });
        }
    };

    /**
     * GET /api/side-b/stats/by-category
     */
    byCategory = async (_req: Request, res: Response): Promise<void> => {
        try {
            const grouped = await prisma.edgeHypothesis.groupBy({
                by: ['category'],
                where: { status: 'confirmed' },
                _count: true,
            });
            res.json({
                success: true,
                categories: grouped.map((g) => ({
                    category: g.category,
                    confirmedCount: g._count,
                })),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[LedgerDashboardController] byCategory 失敗:', err);
            res.status(500).json({ success: false, error: message });
        }
    };

    /**
     * GET /api/side-b/stats/validation-activity?days=30
     */
    validationActivity = async (req: Request, res: Response): Promise<void> => {
        const days = toPositiveInt(req.query.days, 30, 90);
        try {
            const since = new Date(Date.now() - days * 24 * 3600 * 1000);
            const rows = await prisma.$queryRaw<
                Array<{ bucket: Date; count: bigint }>
            >(
                Prisma.sql`
          SELECT date_trunc('day', "lastTestedAt") AS bucket,
                 count(*)::bigint AS count
          FROM "EdgeHypothesis"
          WHERE "lastTestedAt" IS NOT NULL
            AND "lastTestedAt" >= ${since}
          GROUP BY 1
          ORDER BY 1 ASC
        `,
            );
            res.json({
                success: true,
                days,
                points: rows.map((r) => ({
                    date: r.bucket.toISOString().slice(0, 10),
                    count: Number(r.count),
                })),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[LedgerDashboardController] validationActivity 失敗:', err);
            res.status(500).json({ success: false, error: message });
        }
    };

    /**
     * GET /api/side-b/discovery/latest
     *
     * 永続化された週次レポートは未実装のため、台帳から discovery 由来仮説のサマリーを返す。
     */
    latestDiscovery = async (_req: Request, res: Response): Promise<void> => {
        try {
            const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
            const [count7d, samples] = await Promise.all([
                prisma.edgeHypothesis.count({
                    where: {
                        source: 'discovery',
                        createdAt: { gte: weekAgo },
                    },
                }),
                prisma.edgeHypothesis.findMany({
                    where: { source: 'discovery' },
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                    select: {
                        id: true,
                        statement: true,
                        status: true,
                        createdAt: true,
                    },
                }),
            ]);
            res.json({
                success: true,
                hasWeeklyReport: false,
                message:
                    '週次 Discovery レポートの永続化は未実装です。仮説台帳から discovery 由来の件数を表示しています。',
                newHypothesesFromDiscovery7d: count7d,
                sampleHypotheses: samples.map((h) => ({
                    id: h.id,
                    statement: h.statement,
                    status: h.status,
                    createdAt: h.createdAt.toISOString(),
                })),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[LedgerDashboardController] latestDiscovery 失敗:', err);
            res.status(500).json({ success: false, error: message });
        }
    };

    /**
     * GET /api/side-b/system/health
     */
    systemHealth = async (_req: Request, res: Response): Promise<void> => {
        try {
            let dbOk = false;
            try {
                await prisma.$queryRaw(Prisma.sql`SELECT 1`);
                dbOk = true;
            } catch {
                dbOk = false;
            }

            // Phase 6.8b: boolean ではなく 4値ステータスで返す
            // 'ok' | 'local_only' | 'not_configured' | 'error'
            const pythonValidatorStatus = await pythonBridge.healthCheckStatus();

            res.json({
                success: true,
                database: dbOk ? 'ok' : 'error',
                pythonValidator: pythonValidatorStatus,
                checkedAt: new Date().toISOString(),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[LedgerDashboardController] systemHealth 失敗:', err);
            res.status(500).json({ success: false, error: message });
        }
    };
}

export const ledgerDashboardController = new LedgerDashboardController();
