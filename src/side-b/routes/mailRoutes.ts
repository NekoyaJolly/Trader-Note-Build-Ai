/**
 * Mail API ルーティング
 *
 * 外部からのインバウンドメール受信（Webhook）用のエンドポイントを定義します。
 */

import { Router } from 'express';
import { mailService, InboundMailSchema } from '../services/mailService';

const router = Router();

/**
 * POST /api/side-b/mail/receive
 * インバウンドメールWebhookの受け口
 */
router.post('/receive', async (req, res) => {
  const result = InboundMailSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.format() });
  }

  try {
    const handleResult = await mailService.handleInboundMail(result.data);
    if (!handleResult.success) {
      return res.status(400).json({ error: handleResult.message });
    }
    return res.status(200).json({ message: handleResult.message });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

export const mailRouter = router;
