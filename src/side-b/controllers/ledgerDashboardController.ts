/**
 * Phase 4d: 台帳ダッシュボード・統計・ヘルス API
 *
 * @see docs/design/phase_4d_specification.md §4.5 §4.7
 */

import { z } from 'zod';
import type { Request, Response } from 'express';
import type { ParsedQs } from 'qs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../backend/db/client';
import {
    edgeLedger as defaultEdgeLedger,
    type EdgeLedger,
} from '../ledger/EdgeLedger';
import { pythonBridge } from '../validation/python_bridge';
import { createSystemStateRepository } from '../repositories/systemStateRepository';
import { mailService } from '../services/mailService';

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
    private readonly systemStateRepository = createSystemStateRepository();
    // DB容量取得キャッシュ用のメンバ変数 (指摘1)
    private cachedDbSizeBytes: number | null = null;
    private lastDbSizeCheckTime: number = 0;
    private readonly DB_SIZE_CACHE_TTL = 5 * 60 * 1000; // 5分間キャッシュ

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
     * GET /api/side-b/discovery/funnel
     *
     * Step D-4b: DiscoveryAgent が組成した仮説 (source='discovery') のライフサイクル funnel。
     * 「組成 (unverified) → screening_passed → confirmed / rejected」の status 分布 + 直近サンプル
     * (symbol / timeframe 付き) を返す観測導線。組成は DISCOVERY_COMPOSE_ENABLED ゲート (既定 OFF)。
     */
    discoveryFunnel = async (_req: Request, res: Response): Promise<void> => {
        try {
            const grouped = await prisma.edgeHypothesis.groupBy({
                by: ['status'],
                where: { source: 'discovery' },
                _count: true,
            });
            const byStatus: Record<string, number> = {};
            let total = 0;
            for (const g of grouped) {
                byStatus[g.status] = g._count;
                total += g._count;
            }
            const recent = await prisma.edgeHypothesis.findMany({
                where: { source: 'discovery' },
                orderBy: { createdAt: 'desc' },
                take: 10,
                select: {
                    id: true,
                    statement: true,
                    status: true,
                    symbols: true,
                    timeframes: true,
                    createdAt: true,
                },
            });
            res.json({
                success: true,
                source: 'discovery',
                total,
                byStatus,
                recent: recent.map((h) => ({
                    id: h.id,
                    statement: h.statement,
                    status: h.status,
                    symbols: h.symbols,
                    timeframes: h.timeframes,
                    createdAt: h.createdAt.toISOString(),
                })),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[LedgerDashboardController] discoveryFunnel 失敗:', err);
            res.status(500).json({ success: false, error: message });
        }
    };

    /**
     * GET /api/side-b/system/health
     */
    systemHealth = async (_req: Request, res: Response): Promise<void> => {
        try {
            let dbOk = false;
            let dbSizeBytes = 0;
            const nowTime = Date.now();

            if (this.cachedDbSizeBytes !== null && (nowTime - this.lastDbSizeCheckTime < this.DB_SIZE_CACHE_TTL)) {
                dbSizeBytes = this.cachedDbSizeBytes;
                dbOk = true;
            } else {
                try {
                    const sizeRows = await prisma.$queryRaw<Array<{ size_bytes: bigint }>>`
                      SELECT pg_database_size(current_database())::bigint AS size_bytes
                    `;
                    dbSizeBytes = sizeRows[0] ? Number(sizeRows[0].size_bytes) : 0;
                    dbOk = true;
                    // キャッシュを更新
                    this.cachedDbSizeBytes = dbSizeBytes;
                    this.lastDbSizeCheckTime = nowTime;
                } catch (err) {
                    console.error('[LedgerDashboardController] DB容量取得エラー:', err);
                    dbOk = false;
                    // エラー時は前回のキャッシュがあればそれを fallback
                    if (this.cachedDbSizeBytes !== null) {
                        dbSizeBytes = this.cachedDbSizeBytes;
                        dbOk = true;
                    }
                }
            }

            // DB容量制限チェック（無料枠上限500MB対策で400MBを警告閾値とする）
            const DB_LIMIT_BYTES = 400 * 1024 * 1024; // 400MB
            const dbWarning = dbSizeBytes > DB_LIMIT_BYTES;

            if (dbWarning && dbOk) {
                try {
                    const lastAlertStr = await this.systemStateRepository.get('last_db_alert_sent');
                    const now = Date.now();
                    const oneDayMs = 24 * 60 * 60 * 1000;

                    let shouldSend = true;
                    if (lastAlertStr) {
                        // Zod を用いてミリ秒を表す正の整数文字列を厳密にパース (指摘2)
                        const EpochSchema = z.string().regex(/^\d+$/).transform(Number);
                        const parsed = EpochSchema.safeParse(lastAlertStr);

                        if (parsed.success) {
                            const lastAlert = parsed.data;
                            if (now - lastAlert < oneDayMs) {
                                shouldSend = false;
                            }
                        } else {
                            // 不正なデータはリセットして警告
                            console.warn(`[LedgerDashboardController] last_db_alert_sent に不正な値 "${lastAlertStr}" が検出されたため削除リセットします。`);
                            await this.systemStateRepository.delete('last_db_alert_sent');
                        }
                    }

                    if (shouldSend) {
                        const sizeMB = (dbSizeBytes / (1024 * 1024)).toFixed(1);
                        await mailService.sendAlertMail(
                            'データベース容量警告',
                            `Supabaseデータベースの総使用量が警告閾値(400MB)を超えています。\n現在の使用量: ${sizeMB} MB\n不要なログや過去データのクリーンアップを実行してください。`
                        );
                        await this.systemStateRepository.set('last_db_alert_sent', now.toString());
                    }
                } catch (mailErr) {
                    console.error('[LedgerDashboardController] DB容量警告メール送信失敗:', mailErr);
                }
            }

            // Phase 6.8b: boolean ではなく 4値ステータスで返す
            // 'ok' | 'local_only' | 'not_configured' | 'error'
            const pythonValidatorStatus = await pythonBridge.healthCheckStatus();

            res.json({
                success: true,
                database: dbOk ? 'ok' : 'error',
                dbSizeBytes,
                dbWarning,
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
