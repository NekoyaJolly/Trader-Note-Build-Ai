/**
 * Mail API ルーティング
 *
 * 外部からのインバウンドメール受信（Webhook）用のエンドポイントを定義します。
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { mailService } from '../services/mailService';
import { InboundMailSchema } from '../../schemas/api/sideB';
import type { InboundMail } from '../../schemas/api/sideB';
import { validateBody } from '../../middleware/validateRequest';

const router = Router();

const MailTokenHeadersSchema = z.object({
  authorization: z.string().optional(),
  'x-mail-security-token': z.string().optional(),
});

const MailTokenQuerySchema = z.object({
  token: z.string().optional(),
});

const mailReceiveRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Webhookリクエストが多すぎます' },
});

function extractMailSecurityToken(req: Request): string | undefined {
  const headerResult = MailTokenHeadersSchema.safeParse(req.headers);
  const queryResult = MailTokenQuerySchema.safeParse(req.query);

  const authorization = headerResult.success ? headerResult.data.authorization : undefined;
  if (authorization?.startsWith('Bearer ')) {
    return authorization.substring(7);
  }

  const headerToken = headerResult.success ? headerResult.data['x-mail-security-token'] : undefined;
  if (headerToken) {
    return headerToken;
  }

  return queryResult.success ? queryResult.data.token : undefined;
}

export function requireMailSecurityToken(req: Request, res: Response, next: NextFunction): void {
  const expectedToken = process.env.MAIL_SECURITY_TOKEN;
  if (!expectedToken) {
    res.status(500).json({
      success: false,
      error: 'MAIL_SECURITY_TOKEN が設定されていません',
    });
    return;
  }

  const providedToken = extractMailSecurityToken(req);
  if (!providedToken) {
    res.status(401).json({
      success: false,
      error: 'Webhook token が必要です',
    });
    return;
  }

  if (providedToken !== expectedToken) {
    res.status(403).json({
      success: false,
      error: 'Webhook token が不正です',
    });
    return;
  }

  next();
}

/**
 * POST /api/side-b/mail/receive
 * インバウンドメールWebhookの受け口
 */
router.post('/receive', mailReceiveRateLimiter, requireMailSecurityToken, validateBody(InboundMailSchema), async (req, res) => {
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
    const message = error instanceof Error ? error.message : '不明なエラー';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export const mailRouter = router;
