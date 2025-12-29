/**
 * BarLocator コントローラー
 *
 * 目的: 指定時刻のローソク足を検出・取得するエンドポイント
 *
 * エンドポイント:
 * - POST /api/bars/locate
 * - GET /api/bars/locate/:symbol/:timestamp/:timeframe
 */

import { Router, Request, Response } from 'express';
import { barLocator } from '../services/barLocatorService';

const router = Router();

/**
 * ローソク足検出エンドポイント (POST)
 *
 * リクエスト:
 * ```json
 * {
 *   "symbol": "BTC/USD",
 *   "targetTime": "2024-01-01T12:00:00Z",
 *   "timeframe": "1h",
 *   "mode": "auto" | "exact" | "nearest"
 * }
 * ```
 *
 * レスポンス:
 * ```json
 * {
 *   "bar": { ... },
 *   "mode": "exact",
 *   "confidence": 1.0,
 *   "info": { ... }
 * }
 * ```
 */
router.post('/locate', async (req: Request, res: Response) => {
  try {
    const { symbol, targetTime, timeframe, mode = 'auto' } = req.body;

    // バリデーション
    if (!symbol || !targetTime || !timeframe) {
      return res.status(400).json({
        error: '必須フィールドが不足しています: symbol, targetTime, timeframe',
      });
    }

    // 時刻を Date に変換
    const targetDate = new Date(targetTime);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({
        error: '無効な日時形式: targetTime は ISO 8601 形式である必要があります',
      });
    }

    // mode の検証
    if (!['auto', 'exact', 'nearest'].includes(mode)) {
      return res.status(400).json({
        error: 'mode は "auto", "exact", または "nearest" である必要があります',
      });
    }

    // BarLocator で検索
    const result = await barLocator.locateBar(symbol, targetDate, timeframe, mode);

    // レスポンス
    return res.status(200).json({
      success: true,
      data: {
        bar: result.bar,
        mode: result.mode,
        confidence: result.confidence,
        info: result.info,
      },
    });
  } catch (error) {
    console.error('BarLocator エラー (POST /locate):', error);
    return res.status(500).json({
      error: 'ローソク足の検出に失敗しました',
    });
  }
});

/**
 * ローソク足検出エンドポイント (GET)
 *
 * URL: /api/bars/locate/:symbol/:timestamp/:timeframe
 *
 * クエリ:
 * - mode: "auto" | "exact" | "nearest" (default: "auto")
 *
 * 例:
 * GET /api/bars/locate/BTC%2FUSD/2024-01-01T12%3A00%3A00Z/1h?mode=exact
 */
router.get('/locate/:symbol/:timestamp/:timeframe', async (req: Request, res: Response) => {
  try {
    const { symbol, timestamp, timeframe } = req.params;
    const { mode = 'auto' } = req.query;

    // バリデーション
    if (!symbol || !timestamp || !timeframe) {
      return res.status(400).json({
        error: 'パスパラメータが不足しています: symbol, timestamp, timeframe',
      });
    }

    // 時刻をデコードして Date に変換
    const targetDate = new Date(decodeURIComponent(timestamp));
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({
        error: '無効な日時形式: timestamp は ISO 8601 形式である必要があります',
      });
    }

    // mode の検証
    const modeStr = typeof mode === 'string' ? mode : 'auto';
    if (!['auto', 'exact', 'nearest'].includes(modeStr)) {
      return res.status(400).json({
        error: 'mode は "auto", "exact", または "nearest" である必要があります',
      });
    }

    // BarLocator で検索
    const result = await barLocator.locateBar(
      decodeURIComponent(symbol),
      targetDate,
      timeframe,
      modeStr as any
    );

    // レスポンス
    return res.status(200).json({
      success: true,
      data: {
        bar: result.bar,
        mode: result.mode,
        confidence: result.confidence,
        info: result.info,
      },
    });
  } catch (error) {
    console.error('BarLocator エラー (GET /locate/:symbol/:timestamp/:timeframe):', error);
    return res.status(500).json({
      error: 'ローソク足の検出に失敗しました',
    });
  }
});

export default router;

