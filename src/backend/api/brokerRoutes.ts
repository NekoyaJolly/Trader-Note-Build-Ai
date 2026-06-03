/**
 * ブローカー (cTrader) overlay API ルート
 *
 * GET /api/broker/quote
 *   チャート上に重ねる現在の bid/ask・スプレッドを返す。ローソ足 (EODHD/local) とは
 *   別レイヤーであり、cTrader 障害時もチャート API には影響しない。
 *
 * HTTP ステータス方針:
 *   - 正常取得          → 200 status=connected
 *   - 設定済だが取得失敗  → 200 status=degraded (quote=null) ※チャートを壊さないため 503 にしない
 *   - 未接続            → 503 status=disconnected (発注不可を明示)
 *   - symbol 不足        → 400
 *
 * 注: 約定履歴 (deal) マーカー用の /api/broker/executions は後続 PR で追加する
 *     (cTrader 側の deal 取得が未実装のため、本 PR ではポジション overlay までに留める)。
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { ctraderQuoteProvider } from '../services/ctrader/ctraderQuoteProvider';

const router = Router();

const QuoteQuerySchema = z.object({
  symbol: z.string().min(1, 'symbol は必須です'),
});

/**
 * GET /api/broker/quote?symbol=
 */
router.get('/quote', async (req: Request, res: Response) => {
  const parsed = QuoteQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: '必須パラメータが不足しています: symbol',
    });
    return;
  }

  const { symbol } = parsed.data;
  try {
    const result = await ctraderQuoteProvider.getQuote(symbol);
    // disconnected のみ 503 (発注不可を呼び出し側へ明示)。degraded/connected は 200。
    const status = result.status === 'disconnected' ? 503 : 200;
    res.status(status).json(result);
  } catch (error) {
    // getQuote は基本 throw しない想定だが、保険として degraded を返す
    console.warn(`[BrokerQuote] 予期せぬエラー symbol=${symbol}:`, error);
    res.status(200).json({
      quote: null,
      status: 'degraded',
      warning: 'ブローカー気配の取得中にエラーが発生しました。',
    });
  }
});

export default router;
