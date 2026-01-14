/**
 * cTrader 認証 API ルート
 * 
 * 目的: cTrader OAuth フローの Railway 側エンドポイント
 * 
 * エンドポイント:
 * - GET  /api/auth/ctrader/url     - 認証URL を取得
 * - POST /api/auth/ctrader/callback - 認可コードをトークンに交換
 * - GET  /api/auth/ctrader/status  - 接続状態を取得
 * - DELETE /api/auth/ctrader       - 接続を解除
 * - GET  /api/auth/me              - ログインユーザー情報取得
 * - POST /api/auth/logout          - ログアウト
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { CTraderAuthService, ExchangeCodeRequestSchema } from '../services/ctrader/ctraderAuthService';
import { sessionService } from '../services/auth/sessionService';
import { getPrismaClient } from '../../infrastructure/prismaClient';

const router = Router();

// Prismaクライアントをシングルトンから取得
const prisma = getPrismaClient();
const authService = new CTraderAuthService(prisma);

// ========================================
// Zod スキーマ（リクエストバリデーション用）
// ========================================

const GetAuthUrlQuerySchema = z.object({
  state: z.string().optional(),
});

const DisconnectRequestSchema = z.object({
  accountId: z.string().min(1, 'accountId は必須です'),
});

// ========================================
// エンドポイント
// ========================================

/**
 * GET /api/auth/ctrader/url
 * 
 * 認証URL を生成して返す
 * クライアントはこの URL にリダイレクトしてユーザー認証を開始
 */
router.get('/ctrader/url', async (req: Request, res: Response) => {
  try {
    const queryResult = GetAuthUrlQuerySchema.safeParse(req.query);
    
    if (!queryResult.success) {
      return res.status(400).json({
        error: 'パラメータが不正です',
        details: queryResult.error.format(),
      });
    }
    
    const { state } = queryResult.data;
    const authUrl = authService.generateAuthUrl(state);
    
    return res.json({
      authUrl,
      message: 'このURL にリダイレクトして cTrader 認証を開始してください',
    });
  } catch (error) {
    console.error('認証URL生成エラー:', error);
    return res.status(500).json({
      error: '認証URL の生成に失敗しました',
    });
  }
});

/**
 * POST /api/auth/ctrader/callback
 * 
 * cTrader OAuth コールバック処理（認可コードをトークンに交換 + ユーザー自動作成 + ログイン）
 * 
 * フロー:
 * 1. code を受け取る
 * 2. exchangeCodeAndLogin で User 作成/取得 + CTraderToken 保存 + JWT 発行
 * 3. JWT を Cookie に設定
 * 4. フロントエンドに成功レスポンス（フロントで /dashboard にリダイレクト）
 * 
 * Body: { code: string }
 */
router.post('/ctrader/callback', async (req: Request, res: Response) => {
  try {
    const bodyResult = ExchangeCodeRequestSchema.safeParse(req.body);
    
    if (!bodyResult.success) {
      return res.status(400).json({
        error: 'リクエストが不正です',
        details: bodyResult.error.format(),
      });
    }
    
    const { code } = bodyResult.data;
    const authResult = await authService.exchangeCodeAndLogin(code);
    
    // JWT を Cookie に設定
    sessionService.setTokenCookie(res, authResult.jwt);
    
    console.log(`cTrader ログイン成功: ユーザー ${authResult.user.id}, アカウント ${authResult.token.accountId}`);
    
    return res.json({
      success: true,
      user: {
        id: authResult.user.id,
        primaryAccountId: authResult.user.primaryAccountId,
        displayName: authResult.user.displayName,
        email: authResult.user.email,
        role: authResult.user.role,
      },
      accountId: authResult.token.accountId,
      isNewUser: authResult.isNewUser,
      message: authResult.isNewUser 
        ? 'アカウントを作成し、cTrader 連携が完了しました'
        : 'cTrader 連携が完了しました',
    });
  } catch (error) {
    console.error('cTrader ログインエラー:', error);
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // エラー種別に応じたレスポンス
    if (error instanceof Error) {
      if (error.message.includes('400')) {
        return res.status(400).json({
          error: '認可コードが無効または期限切れです',
          details: errorMessage,
        });
      }
      if (error.message.includes('401')) {
        return res.status(401).json({
          error: 'cTrader API 認証に失敗しました',
          details: errorMessage,
        });
      }
    }
    
    return res.status(500).json({
      error: 'ログインに失敗しました',
      details: errorMessage,
    });
  }
});

/**
 * GET /api/auth/ctrader/status
 * 
 * cTrader 接続状態を取得
 */
router.get('/ctrader/status', async (_req: Request, res: Response) => {
  try {
    const status = await authService.getConnectionStatus();
    
    return res.json({
      connected: status.connected,
      accounts: status.accounts.map((acc: { accountId: string; expiresAt: Date; lastConnectedAt: Date | null }) => ({
        accountId: acc.accountId,
        expiresAt: acc.expiresAt.toISOString(),
        lastConnectedAt: acc.lastConnectedAt?.toISOString() || null,
        isExpired: acc.expiresAt < new Date(),
      })),
    });
  } catch (error) {
    console.error('接続状態取得エラー:', error);
    return res.status(500).json({
      error: '接続状態の取得に失敗しました',
    });
  }
});

/**
 * DELETE /api/auth/ctrader
 * 
 * cTrader 接続を解除
 * 
 * Body: { accountId: string } または空（全解除）
 */
router.delete('/ctrader', async (req: Request, res: Response) => {
  try {
    const bodyResult = DisconnectRequestSchema.safeParse(req.body);
    
    if (bodyResult.success) {
      // 特定アカウントの接続解除
      const { accountId } = bodyResult.data;
      await authService.disconnect(accountId);
      
      console.log(`cTrader 接続解除: アカウント ${accountId}`);
      
      return res.json({
        success: true,
        message: `アカウント ${accountId} の接続を解除しました`,
      });
    } else {
      // 全接続解除
      await authService.disconnectAll();
      
      console.log('cTrader 全接続解除');
      
      return res.json({
        success: true,
        message: 'すべての cTrader 接続を解除しました',
      });
    }
  } catch (error) {
    console.error('接続解除エラー:', error);
    return res.status(500).json({
      error: '接続解除に失敗しました',
    });
  }
});

/**
 * PUT /api/auth/ctrader/primary
 *
 * プライマリアカウントを変更
 *
 * Body: { accountId: string }
 */
router.put('/ctrader/primary', async (req: Request, res: Response) => {
  try {
    // JWT からユーザーIDを取得
    let token = req.cookies?.auth_token;

    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return res.status(401).json({
        error: '認証が必要です',
      });
    }

    const payload = sessionService.verifyToken(token);

    const bodyResult = DisconnectRequestSchema.safeParse(req.body);

    if (!bodyResult.success) {
      return res.status(400).json({
        error: 'accountId は必須です',
        details: bodyResult.error.format(),
      });
    }

    const { accountId } = bodyResult.data;

    // 指定されたアカウントがユーザーのものかを確認
    const tokenRecord = await prisma.cTraderToken.findFirst({
      where: {
        userId: payload.userId,
        accountId,
      },
    });

    if (!tokenRecord) {
      return res.status(404).json({
        error: '指定されたアカウントが見つかりません',
      });
    }

    // ユーザーのプライマリアカウントを更新
    await prisma.user.update({
      where: { id: payload.userId },
      data: { primaryAccountId: accountId },
    });

    console.log(`プライマリアカウント変更: ユーザー ${payload.userId}, アカウント ${accountId}`);

    return res.json({
      success: true,
      message: `アカウント ${accountId} をプライマリアカウントに設定しました`,
    });
  } catch (error) {
    console.error('プライマリアカウント変更エラー:', error);
    return res.status(500).json({
      error: 'プライマリアカウントの変更に失敗しました',
    });
  }
});

/**
 * POST /api/auth/ctrader/refresh
 *
 * アクセストークンを手動更新
 *
 * Body: { accountId: string }
 */
router.post('/ctrader/refresh', async (req: Request, res: Response) => {
  try {
    const bodyResult = DisconnectRequestSchema.safeParse(req.body);
    
    if (!bodyResult.success) {
      return res.status(400).json({
        error: 'accountId は必須です',
        details: bodyResult.error.format(),
      });
    }
    
    const { accountId } = bodyResult.data;
    const token = await authService.refreshAccessToken(accountId);
    
    console.log(`cTrader トークン更新: アカウント ${accountId}`);
    
    return res.json({
      success: true,
      accountId: token.accountId,
      expiresAt: token.expiresAt.toISOString(),
      message: 'トークンを更新しました',
    });
  } catch (error) {
    console.error('トークン更新エラー:', error);
    return res.status(500).json({
      error: 'トークン更新に失敗しました',
    });
  }
});

/**
 * GET /api/auth/me
 * 
 * 現在のユーザー情報を取得（JWT検証）
 * Cookie または Authorization ヘッダーから JWT を取得
 */
router.get('/me', async (req: Request, res: Response) => {
  try {
    // Cookie または Authorization ヘッダーから JWT を取得
    let token = req.cookies?.auth_token;
    
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }
    
    if (!token) {
      return res.status(401).json({
        error: '認証が必要です',
      });
    }
    
    // JWT を検証
    const payload = sessionService.verifyToken(token);
    
    // ユーザー情報を取得
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        ctraderTokens: {
          select: {
            accountId: true,
            expiresAt: true,
            lastConnectedAt: true,
          },
        },
      },
    });
    
    if (!user) {
      return res.status(404).json({
        error: 'ユーザーが見つかりません',
      });
    }
    
    return res.json({
      success: true,
      user: {
        id: user.id,
        primaryAccountId: user.primaryAccountId,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        active: user.active,
        lastLoginAt: user.lastLoginAt,
        ctraderAccounts: user.ctraderTokens,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'ユーザー情報の取得に失敗しました';
    return res.status(401).json({
      error: errorMessage,
    });
  }
});

/**
 * POST /api/auth/logout
 * 
 * ログアウト（Cookie削除）
 */
router.post('/logout', async (_req: Request, res: Response) => {
  try {
    // Cookie を削除
    sessionService.clearTokenCookie(res);
    
    return res.json({
      success: true,
      message: 'ログアウトしました',
    });
  } catch (error) {
    console.error('ログアウトエラー:', error);
    return res.status(500).json({
      error: 'ログアウトに失敗しました',
    });
  }
});

export default router;
