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

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();
const prisma = new PrismaClient();

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
    const { symbol, timeframes, notes } = req.body;

    // バリデーション
    if (!symbol || typeof symbol !== 'string') {
      res.status(400).json({
        success: false,
        error: 'シンボルは必須です',
      });
      return;
    }

    // シンボルを正規化（大文字、スラッシュなし）
    const normalizedSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // 時間足のバリデーション
    const validTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
    const requestedTimeframes = timeframes || ['15m', '1h'];
    
    if (!Array.isArray(requestedTimeframes)) {
      res.status(400).json({
        success: false,
        error: 'timeframes は配列で指定してください',
      });
      return;
    }

    const invalidTimeframes = requestedTimeframes.filter((tf: string) => !validTimeframes.includes(tf));
    if (invalidTimeframes.length > 0) {
      res.status(400).json({
        success: false,
        error: `無効な時間足: ${invalidTimeframes.join(', ')}。有効な値: ${validTimeframes.join(', ')}`,
      });
      return;
    }

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
        notes: notes || null,
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
    const { id } = req.params;
    const { timeframes, active, notes } = req.body;

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

    // 時間足のバリデーション（指定された場合）
    if (timeframes !== undefined) {
      const validTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
      
      if (!Array.isArray(timeframes)) {
        res.status(400).json({
          success: false,
          error: 'timeframes は配列で指定してください',
        });
        return;
      }

      const invalidTimeframes = timeframes.filter((tf: string) => !validTimeframes.includes(tf));
      if (invalidTimeframes.length > 0) {
        res.status(400).json({
          success: false,
          error: `無効な時間足: ${invalidTimeframes.join(', ')}`,
        });
        return;
      }
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
