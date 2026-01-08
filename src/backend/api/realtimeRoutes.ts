/**
 * リアルタイムデータ API ルート
 * 
 * 目的: cTrader WebSocket から受信した Tick/OHLCV データを
 *       SSE (Server-Sent Events) でフロントエンドにリアルタイム配信
 * 
 * エンドポイント:
 * - GET /api/realtime/stream/:symbol - SSE ストリーム
 * - GET /api/realtime/bars/:symbol - 最新バー取得
 * - POST /api/realtime/subscribe - シンボル購読
 * - POST /api/realtime/unsubscribe - 購読解除
 * - GET /api/realtime/status - 接続状態
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { 
  getCTraderRealtimeOrchestrator, 
  CTraderRealtimeOrchestrator,
  ConnectionStatus 
} from '../services/realtime/ctraderRealtimeOrchestrator';
import { TickDataInput, OHLCVBarInput } from '../services/realtime/realtimeTickService';

const router = Router();
const prisma = new PrismaClient();

// オーケストレーターのシングルトン
let orchestrator: CTraderRealtimeOrchestrator | null = null;

/**
 * オーケストレーターを取得（遅延初期化）
 */
function getOrchestrator(): CTraderRealtimeOrchestrator {
  if (!orchestrator) {
    orchestrator = getCTraderRealtimeOrchestrator(prisma, {
      barIntervalSeconds: 10, // 10秒足
    });
  }
  return orchestrator;
}

// ========================================
// スキーマ定義
// ========================================

const SubscribeRequestSchema = z.object({
  symbols: z.array(z.string()).min(1, '最低1つのシンボルが必要です'),
});

const UnsubscribeRequestSchema = z.object({
  symbols: z.array(z.string()).min(1, '最低1つのシンボルが必要です'),
});

// ========================================
// エンドポイント
// ========================================

/**
 * GET /api/realtime/status
 * 接続状態を取得
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const orch = getOrchestrator();
    const status = orch.getStatus();
    const subscribedSymbols = orch.getSubscribedSymbols();

    res.json({
      success: true,
      data: {
        status,
        subscribedSymbols,
        isConnected: status === 'connected',
      },
    });
  } catch (error) {
    console.error('[RealtimeAPI] ステータス取得エラー:', error);
    res.status(500).json({
      success: false,
      error: 'ステータスの取得に失敗しました',
    });
  }
});

/**
 * POST /api/realtime/connect
 * cTrader に接続
 */
router.post('/connect', async (_req: Request, res: Response) => {
  try {
    const orch = getOrchestrator();
    const success = await orch.connect();

    res.json({
      success,
      data: {
        status: orch.getStatus(),
        message: success ? '接続成功' : '接続失敗',
      },
    });
  } catch (error) {
    console.error('[RealtimeAPI] 接続エラー:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '接続に失敗しました',
    });
  }
});

/**
 * POST /api/realtime/disconnect
 * cTrader から切断
 */
router.post('/disconnect', async (_req: Request, res: Response) => {
  try {
    const orch = getOrchestrator();
    await orch.disconnect();

    res.json({
      success: true,
      data: {
        status: orch.getStatus(),
        message: '切断しました',
      },
    });
  } catch (error) {
    console.error('[RealtimeAPI] 切断エラー:', error);
    res.status(500).json({
      success: false,
      error: '切断に失敗しました',
    });
  }
});

/**
 * POST /api/realtime/subscribe
 * シンボルを購読
 */
router.post('/subscribe', async (req: Request, res: Response) => {
  try {
    const result = SubscribeRequestSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error.format(),
      });
    }

    const orch = getOrchestrator();
    
    // 未接続なら接続
    if (orch.getStatus() !== 'connected') {
      const connected = await orch.connect();
      if (!connected) {
        return res.status(503).json({
          success: false,
          error: 'cTrader への接続に失敗しました',
        });
      }
    }

    await orch.subscribe(result.data.symbols);

    return res.json({
      success: true,
      data: {
        subscribedSymbols: orch.getSubscribedSymbols(),
        message: `${result.data.symbols.join(', ')} を購読開始`,
      },
    });
  } catch (error) {
    console.error('[RealtimeAPI] 購読エラー:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '購読に失敗しました',
    });
  }
});

/**
 * POST /api/realtime/unsubscribe
 * 購読解除
 */
router.post('/unsubscribe', async (req: Request, res: Response) => {
  try {
    const result = UnsubscribeRequestSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error.format(),
      });
    }

    const orch = getOrchestrator();
    await orch.unsubscribe(result.data.symbols);

    return res.json({
      success: true,
      data: {
        subscribedSymbols: orch.getSubscribedSymbols(),
        message: `${result.data.symbols.join(', ')} の購読を解除`,
      },
    });
  } catch (error) {
    console.error('[RealtimeAPI] 購読解除エラー:', error);
    return res.status(500).json({
      success: false,
      error: '購読解除に失敗しました',
    });
  }
});

/**
 * GET /api/realtime/bars/:symbol
 * 最新の OHLCV バーを取得
 */
router.get('/bars/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const limit = parseInt(req.query.limit as string) || 60;

    const orch = getOrchestrator();
    const bars = await orch.getRecentBars(symbol, limit);
    const pendingBar = orch.getPendingBar(symbol);

    res.json({
      success: true,
      data: {
        symbol,
        bars,
        pendingBar,
        count: bars.length,
      },
    });
  } catch (error) {
    console.error('[RealtimeAPI] バー取得エラー:', error);
    res.status(500).json({
      success: false,
      error: 'バーの取得に失敗しました',
    });
  }
});

/**
 * GET /api/realtime/stream/:symbol
 * SSE ストリーム（リアルタイムデータ配信）
 */
router.get('/stream/:symbol', async (req: Request, res: Response) => {
  const { symbol } = req.params;

  // SSE ヘッダー設定
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx バッファリング無効化
  res.flushHeaders();

  console.log(`[RealtimeAPI] SSE 接続開始: ${symbol}`);

  const orch = getOrchestrator();

  // 初期データを送信
  const sendInitialData = async () => {
    try {
      const bars = await orch.getRecentBars(symbol, 60);
      const pendingBar = orch.getPendingBar(symbol);

      res.write(`event: init\n`);
      res.write(`data: ${JSON.stringify({ bars, pendingBar, status: orch.getStatus() })}\n\n`);
    } catch (error) {
      console.error('[RealtimeAPI] 初期データ送信エラー:', error);
    }
  };

  // Tick イベントハンドラ
  const onTick = (tick: TickDataInput) => {
    if (tick.symbol === symbol || symbol === 'all') {
      res.write(`event: tick\n`);
      res.write(`data: ${JSON.stringify(tick)}\n\n`);
    }
  };

  // バー確定イベントハンドラ
  const onBar = (bar: OHLCVBarInput) => {
    if (bar.symbol === symbol || symbol === 'all') {
      res.write(`event: bar\n`);
      res.write(`data: ${JSON.stringify(bar)}\n\n`);
    }
  };

  // 進行中バーイベントハンドラ
  const onPendingBar = (bar: unknown) => {
    const pendingBar = bar as { symbol: string };
    if (pendingBar.symbol === symbol || symbol === 'all') {
      res.write(`event: pendingBar\n`);
      res.write(`data: ${JSON.stringify(bar)}\n\n`);
    }
  };

  // 接続状態変更ハンドラ
  const onStatusChange = (status: ConnectionStatus) => {
    res.write(`event: status\n`);
    res.write(`data: ${JSON.stringify({ status })}\n\n`);
  };

  // イベントリスナー登録
  orch.on('tick', onTick);
  orch.on('bar', onBar);
  orch.on('pendingBar', onPendingBar);
  orch.on('statusChange', onStatusChange);

  // 初期データ送信
  await sendInitialData();

  // 接続維持のためのハートビート
  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\n`);
    res.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
  }, 30000);

  // クライアント切断時のクリーンアップ
  req.on('close', () => {
    console.log(`[RealtimeAPI] SSE 接続終了: ${symbol}`);
    clearInterval(heartbeat);
    orch.off('tick', onTick);
    orch.off('bar', onBar);
    orch.off('pendingBar', onPendingBar);
    orch.off('statusChange', onStatusChange);
  });
});

export default router;

