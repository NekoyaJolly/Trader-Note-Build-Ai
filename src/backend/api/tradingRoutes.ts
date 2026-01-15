/**
 * トレード用APIルート
 * 
 * エンドポイント:
 * - GET /api/trading/account - 口座情報取得
 * - GET /api/trading/positions - ポジション一覧取得
 * - GET /api/trading/stream - SSEでリアルタイム更新配信
 * 
 * 認証: すべてのエンドポイントで requireAuth が必要
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../../middleware/authMiddleware';
import { CTraderAuthService } from '../services/ctrader/ctraderAuthService';
import { CTraderProvider } from '../../infrastructure/market/CTraderProvider';
import { CTraderAccountService } from '../services/ctrader/ctraderAccountService';
import { getPrismaClient } from '../../infrastructure/prismaClient';
import { AccountInfoResponseSchema, PositionsResponseSchema } from '../../schemas/api/trading';

const router = Router();
const prisma = getPrismaClient();

/**
 * GET /api/trading/account
 * 口座情報を取得
 * 
 * @returns 口座残高・証拠金情報
 */
router.get('/account', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const primaryAccountId = req.user!.primaryAccountId;

    console.log('[TradingRoutes] 口座情報取得開始:', { userId, primaryAccountId });

    // プライマリアカウントのトークンを取得
    const token = await prisma.cTraderToken.findUnique({
      where: { accountId: primaryAccountId },
    });

    if (!token) {
      return res.status(404).json({
        success: false,
        error: 'cTraderアカウントが見つかりません。再度ログインしてください。',
      });
    }

    // CTraderProvider初期化
    const authService = new CTraderAuthService(prisma);
    const provider = new CTraderProvider(authService, primaryAccountId);
    
    await provider.connect();

    // AccountService経由で情報取得
    const accountService = new CTraderAccountService(provider, primaryAccountId);
    const accountInfo = await accountService.getAccountInfo();

    await provider.disconnect();

    // Zodバリデーション
    const validatedData = AccountInfoResponseSchema.parse(accountInfo);

    console.log('[TradingRoutes] 口座情報取得成功:', validatedData);

    return res.json({
      success: true,
      data: validatedData,
    });
  } catch (error) {
    console.error('[TradingRoutes] 口座情報取得エラー:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '口座情報の取得に失敗しました',
    });
  }
});

/**
 * GET /api/trading/positions
 * 保有ポジション一覧を取得
 * 
 * @returns ポジション配列
 */
router.get('/positions', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const primaryAccountId = req.user!.primaryAccountId;

    console.log('[TradingRoutes] ポジション取得開始:', { userId, primaryAccountId });

    const token = await prisma.cTraderToken.findUnique({
      where: { accountId: primaryAccountId },
    });

    if (!token) {
      return res.status(404).json({
        success: false,
        error: 'cTraderアカウントが見つかりません。再度ログインしてください。',
      });
    }

    const authService = new CTraderAuthService(prisma);
    const provider = new CTraderProvider(authService, primaryAccountId);
    
    await provider.connect();

    const accountService = new CTraderAccountService(provider, primaryAccountId);
    const positions = await accountService.getPositions();

    await provider.disconnect();

    // ポジション配列をJSON形式に変換（Date → string）
    const positionsResponse = positions.map((p) => ({
      ...p,
      openTime: p.openTime.toISOString(),
    }));

    // Zodバリデーション
    const validatedData = PositionsResponseSchema.parse(positionsResponse);

    console.log('[TradingRoutes] ポジション取得成功:', validatedData.length, '件');

    return res.json({
      success: true,
      data: validatedData,
    });
  } catch (error) {
    console.error('[TradingRoutes] ポジション取得エラー:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ポジション情報の取得に失敗しました',
    });
  }
});

/**
 * GET /api/trading/stream
 * SSEでリアルタイムポジション更新を配信
 * 
 * クライアントはこのエンドポイントに接続し、
 * ポジション変更イベントを受信する
 */
router.get('/stream', requireAuth, async (req: Request, res: Response) => {
  // SSEヘッダー設定
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  try {
    const userId = req.user!.userId;
    const primaryAccountId = req.user!.primaryAccountId;

    console.log('[TradingRoutes] SSEストリーム開始:', { userId, primaryAccountId });

    const token = await prisma.cTraderToken.findUnique({
      where: { accountId: primaryAccountId },
    });

    if (!token) {
      res.write(`data: ${JSON.stringify({ error: 'アカウントが見つかりません' })}\n\n`);
      res.end();
      return;
    }

    const authService = new CTraderAuthService(prisma);
    const provider = new CTraderProvider(authService, primaryAccountId);
    
    await provider.connect();

    const accountService = new CTraderAccountService(provider, primaryAccountId);
    
    // ポジション更新を購読
    accountService.subscribeToUpdates();
    
    accountService.on('positionUpdate', (update) => {
      // Date → ISO文字列に変換
      const updateResponse = {
        type: update.type,
        position: {
          ...update.position,
          openTime: update.position.openTime.toISOString(),
        },
        timestamp: update.timestamp.toISOString(),
      };

      res.write(`data: ${JSON.stringify(updateResponse)}\n\n`);
    });

    // 接続維持のためのハートビート（30秒ごと）
    const heartbeatTimer = setInterval(() => {
      res.write(`: heartbeat\n\n`);
    }, 30000);

    // クライアント切断時のクリーンアップ
    req.on('close', async () => {
      console.log('[TradingRoutes] SSEストリーム切断');
      clearInterval(heartbeatTimer);
      accountService.unsubscribeFromUpdates();
      await provider.disconnect();
      accountService.removeAllListeners();
    });
  } catch (error) {
    console.error('[TradingRoutes] SSE エラー:', error);
    res.write(`data: ${JSON.stringify({ error: 'ストリーム接続エラー' })}\n\n`);
    res.end();
  }
});

export default router;
