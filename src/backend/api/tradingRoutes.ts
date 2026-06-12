/**
 * トレード用APIルート
 *
 * エンドポイント:
 * - GET /api/trading/account - 口座情報取得
 * - GET /api/trading/positions - ポジション一覧取得
 * - GET /api/trading/stream - SSEでリアルタイム更新配信
 * - POST /api/trading/orders - 新規注文
 * - PUT /api/trading/orders/:id - 注文変更
 * - DELETE /api/trading/orders/:id - 注文キャンセル
 * - POST /api/trading/positions/:id/close - ポジション決済
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware';
import { CTraderAuthService } from '../services/ctrader/ctraderAuthService';
import { CTraderProvider } from '../../infrastructure/market/CTraderProvider';
import { CTraderAccountService } from '../services/ctrader/ctraderAccountService';
import { getPrismaClient } from '../../infrastructure/prismaClient';
import {
  isTradingOrderExecutionEnabled,
  TRADING_ORDER_EXECUTION_DISABLED_CODE,
  TRADING_ORDER_EXECUTION_DISABLED_MESSAGE,
} from '../services/tradingOrderExecutionGate';
import {
  ClosePositionRequestSchema,
  CreateOrderRequestSchema,
  TradingOrderResponseSchema,
  UpdateOrderRequestSchema,
} from '../../schemas/api/trading';
import type { PositionResponse } from '../../schemas/api/trading';

const router = Router();
const prisma = getPrismaClient();

interface TradingRouteContext {
  provider: CTraderProvider;
  accountService: CTraderAccountService;
}

async function createTradingRouteContext(primaryAccountId: string): Promise<TradingRouteContext> {
  const token = await prisma.cTraderToken.findUnique({
    where: { accountId: primaryAccountId },
  });

  if (!token) {
    throw new Error('cTraderアカウントが見つかりません。再度ログインしてください。');
  }

  const authService = new CTraderAuthService(prisma);
  const provider = new CTraderProvider(authService, primaryAccountId);
  await provider.connect();
  const accountService = new CTraderAccountService(provider, primaryAccountId);

  return { provider, accountService };
}

function rejectDisabledOrderExecution(res: Response): boolean {
  if (isTradingOrderExecutionEnabled()) {
    return false;
  }

  res.status(403).json({
    success: false,
    code: TRADING_ORDER_EXECUTION_DISABLED_CODE,
    error: TRADING_ORDER_EXECUTION_DISABLED_MESSAGE,
  });
  return true;
}

/**
 * GET /api/trading/account
 * 口座情報を取得
 */
router.get('/account', requireAuth, async (req: Request, res: Response) => {
  let provider: CTraderProvider | null = null;

  try {
    const userId = req.user!.userId;
    const primaryAccountId = req.user!.primaryAccountId;
    console.log('[TradingRoutes] 口座情報取得開始:', { userId, primaryAccountId });

    const context = await createTradingRouteContext(primaryAccountId);
    provider = context.provider;
    const accountInfo = await context.accountService.getAccountInfo();

    return res.json({
      success: true,
      data: accountInfo,
    });
  } catch (error) {
    console.error('[TradingRoutes] 口座情報取得エラー:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '口座情報の取得に失敗しました',
    });
  } finally {
    if (provider) {
      try {
        await provider.disconnect();
      } catch (cleanupError) {
        console.error('[TradingRoutes] プロバイダー切断エラー:', cleanupError);
      }
    }
  }
});

/**
 * GET /api/trading/positions
 * 保有ポジション一覧を取得
 */
router.get('/positions', requireAuth, async (req: Request, res: Response) => {
  let provider: CTraderProvider | null = null;

  try {
    const userId = req.user!.userId;
    const primaryAccountId = req.user!.primaryAccountId;
    console.log('[TradingRoutes] ポジション取得開始:', { userId, primaryAccountId });

    const context = await createTradingRouteContext(primaryAccountId);
    provider = context.provider;
    const positions = await context.accountService.getPositions();

    return res.json({
      success: true,
      data: positions,
    });
  } catch (error) {
    console.error('[TradingRoutes] ポジション取得エラー:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ポジション情報の取得に失敗しました',
    });
  } finally {
    if (provider) {
      try {
        await provider.disconnect();
      } catch (cleanupError) {
        console.error('[TradingRoutes] プロバイダー切断エラー:', cleanupError);
      }
    }
  }
});

/**
 * GET /api/trading/stream
 * ポーリング差分でSSE配信
 */
router.get('/stream', requireAuth, async (req: Request, res: Response) => {
  let provider: CTraderProvider | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let accountService: CTraderAccountService | null = null;
  let isClosed = false;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    const primaryAccountId = req.user!.primaryAccountId;
    const context = await createTradingRouteContext(primaryAccountId);
    provider = context.provider;
    accountService = context.accountService;

    const onPositionUpdate = (update: {
      type: 'OPEN' | 'MODIFY' | 'CLOSE';
      position: PositionResponse;
      timestamp: string;
    }) => {
      if (isClosed) return;
      res.write(`data: ${JSON.stringify(update)}\n\n`);
    };

    const onUpdateError = (error: Error) => {
      if (isClosed) return;
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    };

    accountService.on('positionUpdate', onPositionUpdate);
    accountService.on('error', onUpdateError);
    accountService.subscribeToUpdates();

    heartbeatTimer = setInterval(() => {
      res.write(`: heartbeat\n\n`);
    }, 30000);

    req.on('close', async () => {
      isClosed = true;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (accountService) {
        accountService.unsubscribeFromUpdates();
        accountService.removeAllListeners();
      }
      if (provider) {
        try {
          await provider.disconnect();
        } catch (cleanupError) {
          console.error('[TradingRoutes] プロバイダー切断エラー:', cleanupError);
        }
      }
    });
  } catch (error) {
    console.error('[TradingRoutes] SSE エラー:', error);
    res.write(`data: ${JSON.stringify({ error: 'ストリーム接続エラー' })}\n\n`);
    res.end();

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    if (accountService) {
      accountService.unsubscribeFromUpdates();
      accountService.removeAllListeners();
    }
    if (provider) {
      try {
        await provider.disconnect();
      } catch (cleanupError) {
        console.error('[TradingRoutes] プロバイダー切断エラー:', cleanupError);
      }
    }
  }
});

/**
 * POST /api/trading/orders
 * 新規注文
 */
router.post('/orders', requireAuth, async (req: Request, res: Response) => {
  let provider: CTraderProvider | null = null;

  try {
    if (rejectDisabledOrderExecution(res)) {
      return;
    }

    const parsed = CreateOrderRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.format(),
      });
    }

    const context = await createTradingRouteContext(req.user!.primaryAccountId);
    provider = context.provider;
    await context.accountService.createOrder(parsed.data);

    const response = TradingOrderResponseSchema.parse({
      success: true,
      action: 'CREATE',
      requestId: Date.now().toString(),
    });

    return res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error('[TradingRoutes] 新規注文エラー:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '新規注文に失敗しました',
    });
  } finally {
    if (provider) {
      try {
        await provider.disconnect();
      } catch (cleanupError) {
        console.error('[TradingRoutes] プロバイダー切断エラー:', cleanupError);
      }
    }
  }
});

/**
 * PUT /api/trading/orders/:id
 * 注文変更
 */
router.put('/orders/:id', requireAuth, async (req: Request, res: Response) => {
  let provider: CTraderProvider | null = null;

  try {
    if (rejectDisabledOrderExecution(res)) {
      return;
    }

    const parsed = UpdateOrderRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.format(),
      });
    }

    const context = await createTradingRouteContext(req.user!.primaryAccountId);
    provider = context.provider;
    await context.accountService.updateOrder(req.params.id, parsed.data);

    const response = TradingOrderResponseSchema.parse({
      success: true,
      action: 'UPDATE',
      requestId: Date.now().toString(),
    });

    return res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error('[TradingRoutes] 注文変更エラー:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '注文変更に失敗しました',
    });
  } finally {
    if (provider) {
      try {
        await provider.disconnect();
      } catch (cleanupError) {
        console.error('[TradingRoutes] プロバイダー切断エラー:', cleanupError);
      }
    }
  }
});

/**
 * DELETE /api/trading/orders/:id
 * 注文キャンセル
 */
router.delete('/orders/:id', requireAuth, async (req: Request, res: Response) => {
  let provider: CTraderProvider | null = null;

  try {
    if (rejectDisabledOrderExecution(res)) {
      return;
    }

    const context = await createTradingRouteContext(req.user!.primaryAccountId);
    provider = context.provider;
    await context.accountService.cancelOrder(req.params.id);

    const response = TradingOrderResponseSchema.parse({
      success: true,
      action: 'CANCEL',
      requestId: Date.now().toString(),
    });

    return res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error('[TradingRoutes] 注文キャンセルエラー:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '注文キャンセルに失敗しました',
    });
  } finally {
    if (provider) {
      try {
        await provider.disconnect();
      } catch (cleanupError) {
        console.error('[TradingRoutes] プロバイダー切断エラー:', cleanupError);
      }
    }
  }
});

/**
 * POST /api/trading/positions/:id/close
 * ポジション決済
 */
router.post('/positions/:id/close', requireAuth, async (req: Request, res: Response) => {
  let provider: CTraderProvider | null = null;

  try {
    if (rejectDisabledOrderExecution(res)) {
      return;
    }

    const parsed = ClosePositionRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.format(),
      });
    }

    const context = await createTradingRouteContext(req.user!.primaryAccountId);
    provider = context.provider;
    await context.accountService.closePosition(req.params.id, parsed.data.volume);

    const response = TradingOrderResponseSchema.parse({
      success: true,
      action: 'CLOSE',
      requestId: Date.now().toString(),
    });

    return res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error('[TradingRoutes] ポジション決済エラー:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ポジション決済に失敗しました',
    });
  } finally {
    if (provider) {
      try {
        await provider.disconnect();
      } catch (cleanupError) {
        console.error('[TradingRoutes] プロバイダー切断エラー:', cleanupError);
      }
    }
  }
});

export default router;
