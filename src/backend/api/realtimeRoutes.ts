/**
 * リアルタイムデータ API ルート
 *
 * 目的: EODHD WebSocket から受信した Tick/OHLCV データを
 *       SSE (Server-Sent Events) でフロントエンドにリアルタイム配信
 *
 * Phase A PR #3 (2026-05-21): Tick source を cTrader → EODHD WebSocket に切替。
 * 旧 CTraderRealtimeOrchestrator → 新 EodhdRealtimeOrchestrator (互換 API)。
 *
 * エンドポイント:
 * - GET /api/realtime/stream/:symbol - SSE ストリーム
 * - GET /api/realtime/bars/:symbol - 最新バー取得
 * - POST /api/realtime/subscribe - シンボル購読
 * - POST /api/realtime/unsubscribe - 購読解除
 * - GET /api/realtime/status - 接続状態
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/authMiddleware';
import type {
  EodhdRealtimeOrchestrator,
  ConnectionStatus,
} from '../services/realtime/eodhdRealtimeOrchestrator';
import {
  getEodhdRealtimeOrchestrator,
  getAllEodhdRealtimeOrchestrators,
} from '../services/realtime/eodhdRealtimeOrchestrator';
import type { TickDataInput, OHLCVBarInput, PendingBar } from '../services/realtime/realtimeTickService';
import type { JsonValue } from '../../utils/jsonValue';
import { prisma } from '../db/client';

/** Express の拡張（compression 等で optional flush が付く場合がある） */
type ResponseWithFlush = Response & { flush?: () => void };

function flushStreamResponse(res: Response): void {
  const flush = (res as ResponseWithFlush).flush;
  if (typeof flush === 'function') {
    flush.call(res);
  }
}

const router = Router();

/**
 * 時間足ごとのオーケストレーターを取得
 *
 * Phase A PR #3 (2026-05-21) で EODHD 経路に切替。
 * `getEodhdRealtimeOrchestrator` が barIntervalSeconds キーで内部 Map 管理するため、
 * 本 routes 側で重ねて Map を持つ必要はなく、同 interval なら同インスタンスが返る。
 */
function getOrchestrator(barIntervalSeconds: number = 60): EodhdRealtimeOrchestrator {
  return getEodhdRealtimeOrchestrator(prisma, { barIntervalSeconds });
}

/**
 * デフォルトのオーケストレーターを取得
 */
function getDefaultOrchestrator(): EodhdRealtimeOrchestrator {
  return getOrchestrator(60);
}

// ========================================
// CORS ヘルパー
// ========================================

/**
 * CORSヘッダーを設定するヘルパー関数
 */
function setCorsHeaders(req: Request, res: Response): void {
  const origin = req.headers.origin;
  
  // 許可するオリジン一覧
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3102',
    'https://trader-note-build-ai.vercel.app',
  ];
  
  // ワイルドカードパターン（Vercel プレビュー用）
  const wildcardPatterns = [
    /^https:\/\/trader-note-build-ai-.*-nekoya258\.vercel\.app$/,
    /^https:\/\/trader-note-build-.*-nekoya258\.vercel\.app$/,
  ];
  
  // オリジンが許可されているか確認
  const isAllowed = origin && (
    allowedOrigins.includes(origin) ||
    wildcardPatterns.some(pattern => pattern.test(origin))
  );
  
  // CORS ヘッダーを設定
  if (isAllowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

// ========================================
// スキーマ定義
// ========================================

const SubscribeRequestSchema = z.object({
  symbols: z.array(z.string()).min(1, '最低1つのシンボルが必要です'),
  timeframe: z.number().optional().default(60), // 秒単位の時間足
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
router.get('/status', (req: Request, res: Response) => {
  setCorsHeaders(req, res);

  try {
    const orch = getDefaultOrchestrator();
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
router.post('/connect', requireAuth, async (req: Request, res: Response) => {
  setCorsHeaders(req, res);

  try {
    const userId = req.user!.userId;
    const timeframe = parseInt(req.query.timeframe as string) || 60;
    const orch = getOrchestrator(timeframe);
    const success = await orch.connect(userId);

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
router.post('/disconnect', async (req: Request, res: Response) => {
  setCorsHeaders(req, res);
  
  try {
    const timeframe = parseInt(req.query.timeframe as string) || 60;
    const orch = getOrchestrator(timeframe);
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
router.post('/subscribe', requireAuth, async (req: Request, res: Response) => {
  setCorsHeaders(req, res);
  
  try {
    const result = SubscribeRequestSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error.format(),
      });
    }

    const { symbols, timeframe } = result.data;
    const userId = req.user!.userId;
    const orch = getOrchestrator(timeframe);

    // 未接続なら接続
    if (orch.getStatus() !== 'connected') {
      const connected = await orch.connect(userId);
      if (!connected) {
        return res.status(503).json({
          success: false,
          error: 'cTrader への接続に失敗しました',
        });
      }
    }

    await orch.subscribe(symbols);

    return res.json({
      success: true,
      data: {
        subscribedSymbols: orch.getSubscribedSymbols(),
        timeframe,
        message: `${symbols.join(', ')} を購読開始（${timeframe}秒足）`,
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
  setCorsHeaders(req, res);
  
  try {
    const result = UnsubscribeRequestSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error.format(),
      });
    }

    const timeframe = parseInt(req.query.timeframe as string) || 60;
    const orch = getOrchestrator(timeframe);
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
 * POST /api/realtime/clear-bars/:symbol
 * 異常バーをクリア（メモリ+DB）
 */
router.post('/clear-bars/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const timeframe = parseInt(req.query.timeframe as string) || 60;

    const orch = getOrchestrator(timeframe);
    
    // 1. メモリの進行中バーをクリア
    orch.clearPendingBar(symbol);
    
    // 2. DBから異常バーを削除
    const deletedCount = await orch.deleteAnomalousBars(symbol);

    return res.json({
      success: true,
      data: {
        symbol,
        timeframe,
        deletedCount,
        message: `メモリバーをクリアし、${deletedCount}件の異常バーをDBから削除しました`,
      },
    });
  } catch (error) {
    console.error('[RealtimeAPI] バークリアエラー:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'バーのクリアに失敗しました',
    });
  }
});

/**
 * POST /api/realtime/clear-all-bars
 * 全ての異常バーをクリア
 */
router.post('/clear-all-bars', (_req: Request, res: Response) => {
  try {
    // Copilot review (PR #237) 指摘対応:
    // RealtimeTickService は barIntervalSeconds ごとに別インスタンスのため、
    // 全 timeframe の orchestrator を走査して各々の pending bars をクリアする必要がある。
    // 生成済 orchestrator のみを対象 (lazy init で未生成の timeframe には pending bars も無い)。
    const allOrchestrators = getAllEodhdRealtimeOrchestrators();
    const clearedCount = allOrchestrators.length;
    for (const orch of allOrchestrators) {
      orch.clearAllPendingBars();
    }

    return res.json({
      success: true,
      data: {
        message: `${clearedCount} 個の timeframe の進行中バーをクリアしました`,
        clearedTimeframes: clearedCount,
      },
    });
  } catch (error) {
    console.error('[RealtimeAPI] 全バークリアエラー:', error);
    return res.status(500).json({
      success: false,
      error: 'バーのクリアに失敗しました',
    });
  }
});

/**
 * GET /api/realtime/bars/:symbol
 * 最新の OHLCV バーを取得
 */
router.get('/bars/:symbol', async (req: Request, res: Response) => {
  setCorsHeaders(req, res);
  
  try {
    const { symbol } = req.params;
    const limit = parseInt(req.query.limit as string) || 60;
    const timeframe = parseInt(req.query.timeframe as string) || 60;

    const orch = getOrchestrator(timeframe);
    const bars = await orch.getRecentBars(symbol, limit);
    const pendingBar = orch.getPendingBar(symbol);

    res.json({
      success: true,
      data: {
        symbol,
        timeframe,
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
 * クエリパラメータ: timeframe (秒)
 */
router.get('/stream/:symbol', async (req: Request, res: Response) => {
  const { symbol } = req.params;
  const timeframe = parseInt(req.query.timeframe as string) || 60;

  // SSE ヘッダー設定
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx バッファリング無効化
  
  // CORS ヘッダーを設定
  setCorsHeaders(req, res);
  
  res.flushHeaders();

  console.log(`[RealtimeAPI] SSE 接続開始: ${symbol} (${timeframe}秒足)`);

  const orch = getOrchestrator(timeframe);

type SseDataPayload =
  | JsonValue
  | TickDataInput
  | OHLCVBarInput
  | PendingBar
  | {
      bars: OHLCVBarInput[];
      pendingBar: PendingBar | undefined;
      status: ConnectionStatus;
    };

  // SSE メッセージ送信ヘルパー（即座にフラッシュ）
  const sendSSE = (event: string, data: SseDataPayload) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    flushStreamResponse(res);
  };

  // 初期データを送信
  const sendInitialData = async () => {
    try {
      const bars = await orch.getRecentBars(symbol, 60);
      const pendingBar = orch.getPendingBar(symbol);
      console.log(`[RealtimeAPI] 初期データ送信: ${bars.length} バー, status=${orch.getStatus()}`);
      sendSSE('init', { bars, pendingBar, status: orch.getStatus() });
    } catch (error) {
      console.error('[RealtimeAPI] 初期データ送信エラー:', error);
      // エラー時も空のデータを送信
      sendSSE('init', { bars: [], pendingBar: null, status: 'error' });
    }
  };

  // Tick イベントハンドラ
  const onTick = (tick: TickDataInput) => {
    if (tick.symbol === symbol || symbol === 'all') {
      sendSSE('tick', tick);
    }
  };

  // バー確定イベントハンドラ
  const onBar = (bar: OHLCVBarInput) => {
    if (bar.symbol === symbol || symbol === 'all') {
      sendSSE('bar', bar);
    }
  };

  // 進行中バーイベントハンドラ
  const onPendingBar = (bar: PendingBar) => {
    if (bar.symbol === symbol || symbol === 'all') {
      sendSSE('pendingBar', bar);
    }
  };

  // 接続状態変更ハンドラ
  const onStatusChange = (status: ConnectionStatus) => {
    sendSSE('status', { status });
  };

  // イベントリスナー登録
  orch.on('tick', onTick);
  orch.on('bar', onBar);
  orch.on('pendingBar', onPendingBar);
  orch.on('statusChange', onStatusChange);

  // 初期データ送信
  await sendInitialData();

  // 接続維持のためのハートビート（30秒ごと）
  const heartbeat = setInterval(() => {
    sendSSE('heartbeat', { timestamp: Date.now() });
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

