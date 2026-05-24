/**
 * Mail API ルーティング
 *
 * 外部からのインバウンドメール受信（Webhook）用のエンドポイントを定義します。
 */

import { Router } from 'express';
import { mailService } from '../services/mailService';
import { InboundMailSchema } from '../../schemas/api/sideB';
import type { InboundMail } from '../../schemas/api/sideB';
import { validateBody } from '../../middleware/validateRequest';

const router = Router();

/**
 * POST /api/side-b/mail/receive
 * インバウンドメールWebhookの受け口
 */
router.post('/receive', validateBody(InboundMailSchema), async (req, res) => {
  try {
    const mailData = req.body as InboundMail;
    const handleResult = await mailService.handleInboundMail(mailData);
    if (!handleResult.success) {
      const isAuthError = handleResult.message.includes('セキュリティトークン');
      return res.status(isAuthError ? 403 : 400).json({
        success: false,
        error: handleResult.message,
      });
    }
    return res.status(200).json({
      success: true,
      message: handleResult.message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export const mailRouter = router;
