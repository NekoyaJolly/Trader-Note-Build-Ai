/**
 * チャート OHLCV API ルート
 *
 * GET /api/chart/candles
 *   チャートのローソク足 (OHLCV) を取得する主経路。EODHD を主データソースとし、
 *   障害時はローカルキャッシュ (OHLCVCandle) にフォールバックする。
 *   **cTrader には依存しない** ため、cTrader 障害でもローソク足は表示できる。
 *
 * 分析結果 (12次元特徴量等) は従来通り /api/market-analysis/:symbol が担う。
 * 本ルートはローソ足取得専用で、分析 API とは責務を分ける。
 *
 * HTTP ステータス方針 (404 を乱用しない):
 *   - symbol 不正 / 未対応      → 404
 *   - timeframe 不正            → 400
 *   - 必須パラメータ不足          → 400
 *   - 外部障害かつキャッシュ無し   → 503
 *   - symbol 有効・データ無し     → 200 (candles: [] + warning)
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { chartDataService } from '../../services/chartDataService';
import { ChartDataError } from '../../infrastructure/market/chart-data.types';

const router = Router();

/** クエリパラメータの境界バリデーション (Zod で具体型に narrow) */
const CandlesQuerySchema = z.object({
  symbol: z.string().min(1, 'symbol は必須です'),
  timeframe: z.string().min(1, 'timeframe は必須です'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(5000).optional(),
});

/**
 * GET /api/chart/candles?symbol=&timeframe=&from=&to=&limit=
 */
router.get('/candles', async (req: Request, res: Response) => {
  const parsed = CandlesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: '必須パラメータが不足/不正です: symbol, timeframe',
      detail: parsed.error.format(),
    });
    return;
  }

  const { symbol, timeframe, from, to, limit } = parsed.data;

  try {
    const result = await chartDataService.getCandles({
      symbol,
      timeframe,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit,
    });
    // ChartCandlesResponse をそのまま返す ({ candles, meta, warning })
    res.json(result);
  } catch (error) {
    if (error instanceof ChartDataError) {
      const status = mapChartErrorToStatus(error.kind);
      // 原因追跡用ログ (provider / symbol / timeframe / range / error type)
      console.warn(
        `[ChartCandles] ${error.kind} symbol=${symbol} timeframe=${timeframe} ` +
          `range=${from ?? '-'}〜${to ?? '-'} detail=${error.detail ?? '-'}`,
      );
      res.status(status).json({
        success: false,
        error: error.message,
        kind: error.kind,
      });
      return;
    }
    console.error(
      `[ChartCandles] 予期せぬエラー symbol=${symbol} timeframe=${timeframe}:`,
      error,
    );
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'チャートデータの取得に失敗しました',
    });
  }
});

/** ChartDataError.kind → HTTP ステータス */
function mapChartErrorToStatus(kind: ChartDataError['kind']): number {
  switch (kind) {
    case 'invalid_symbol':
      return 404;
    case 'invalid_timeframe':
      return 400;
    case 'upstream_unavailable':
      return 503;
    default:
      return 500;
  }
}

export default router;
