/**
 * ウォッチリストルート
 *
 * 監視対象シンボルの管理API
 * - GET /api/watchlist - 一覧取得
 * - POST /api/watchlist - 追加
 * - PUT /api/watchlist/:id - 更新
 * - DELETE /api/watchlist/:id - 削除
 * - GET /api/watchlist/active - アクティブなシンボル一覧（OHLCV蓄積用）
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/authMiddleware';
import { getPrismaClient } from '../../infrastructure/prismaClient';

const router = Router();
const prisma = getPrismaClient();

// 有効な時間足
const VALID_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const;
const TimeframeSchema = z.enum(VALID_TIMEFRAMES);

// POST /api/watchlist のリクエストボディ
const CreateWatchlistBodySchema = z.object({
  symbol: z.string().min(1, 'シンボルは必須です'),
  timeframes: z.array(TimeframeSchema).optional(),
  notes: z.string().nullable().optional(),
});

// PUT /api/watchlist/:id のリクエストボディ
const UpdateWatchlistBodySchema = z.object({
  timeframes: z.array(TimeframeSchema).optional(),
  active: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

// /api/watchlist/:id の URL パラメータ
const WatchlistIdParamsSchema = z.object({
  id: z.string().min(1),
});

/**
 * GET /api/watchlist
 * 現在のユーザーのウォッチリスト一覧を取得
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const watchlists = await prisma.watchlist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: watchlists,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ウォッチリストの取得に失敗しました';
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/watchlist
 * ウォッチリストにシンボルを追加
 *
 * @body symbol - シンボル（例: USDJPY, EURUSD）
 * @body timeframes - 取得する時間足（任意、デフォルト: ["15m", "1h"]）
 * @body notes - メモ（任意）
 */
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Zod で req.body を具体型に narrow
    const parsed = CreateWatchlistBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      res.status(400).json({
        success: false,
        error: firstIssue?.message ?? 'シンボルは必須です',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }
    const { symbol, timeframes, notes } = parsed.data;

    // シンボルを正規化（大文字、スラッシュなし）
    const normalizedSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // 時間足のデフォルト（指定なしは ["15m", "1h"]）
    const requestedTimeframes: string[] = timeframes ?? ['15m', '1h'];

    // 既存チェック（ユーザー × シンボルでユニーク）
    const existing = await prisma.watchlist.findUnique({
      where: {
        userId_symbol: {
          userId,
          symbol: normalizedSymbol,
        },
      },
    });

    if (existing) {
      res.status(409).json({
        success: false,
        error: 'このシンボルは既にウォッチリストに登録されています',
      });
      return;
    }

    const watchlist = await prisma.watchlist.create({
      data: {
        userId,
        symbol: normalizedSymbol,
        timeframes: requestedTimeframes,
        notes: notes ?? null,
        active: true,
      },
    });

    res.status(201).json({
      success: true,
      data: watchlist,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ウォッチリストの追加に失敗しました';
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PUT /api/watchlist/:id
 * ウォッチリスト項目を更新
 *
 * @body timeframes - 取得する時間足
 * @body active - 有効/無効
 * @body notes - メモ
 */
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Zod で req.params / req.body を具体型に narrow
    const paramsParsed = WatchlistIdParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      res.status(400).json({
        success: false,
        error: 'id パラメータが不正です',
      });
      return;
    }
    const { id } = paramsParsed.data;

    const bodyParsed = UpdateWatchlistBodySchema.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({
        success: false,
        error: 'リクエストボディが不正です',
        issues: bodyParsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }
    const { timeframes, active, notes } = bodyParsed.data;

    // 所有権チェック
    const existing = await prisma.watchlist.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      res.status(404).json({
        success: false,
        error: 'ウォッチリスト項目が見つかりません',
      });
      return;
    }

    const watchlist = await prisma.watchlist.update({
      where: { id },
      data: {
        ...(timeframes !== undefined && { timeframes }),
        ...(active !== undefined && { active }),
        ...(notes !== undefined && { notes }),
      },
    });

    res.json({
      success: true,
      data: watchlist,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ウォッチリストの更新に失敗しました';
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * DELETE /api/watchlist/:id
 * ウォッチリスト項目を削除
 */
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    // 所有権チェック
    const existing = await prisma.watchlist.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      res.status(404).json({
        success: false,
        error: 'ウォッチリスト項目が見つかりません',
      });
      return;
    }

    await prisma.watchlist.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'ウォッチリストから削除しました',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ウォッチリストの削除に失敗しました';
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/watchlist/active
 * 全ユーザーのアクティブなウォッチリストを取得（OHLCV日次蓄積用）
 *
 * 認証不要（バッチ処理からの呼び出し用）
 * 重複を除去してシンボル × 時間足の組み合わせを返す
 */
router.get('/active', async (_req: Request, res: Response) => {
  try {
    const watchlists = await prisma.watchlist.findMany({
      where: { active: true },
      select: {
        symbol: true,
        timeframes: true,
      },
    });

    // シンボル × 時間足の組み合わせを重複除去して集約
    const symbolTimeframes = new Map<string, Set<string>>();

    for (const wl of watchlists) {
      const symbol = wl.symbol;
      if (!symbolTimeframes.has(symbol)) {
        symbolTimeframes.set(symbol, new Set());
      }
      const tfSet = symbolTimeframes.get(symbol)!;
      for (const tf of wl.timeframes) {
        tfSet.add(tf);
      }
    }

    // 結果を配列形式に変換
    const result = Array.from(symbolTimeframes.entries()).map(([symbol, tfSet]) => ({
      symbol,
      timeframes: Array.from(tfSet),
    }));

    res.json({
      success: true,
      data: result,
      count: result.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'アクティブウォッチリストの取得に失敗しました';
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export default router;
