/**
 * cTrader 認証 API ルート
 * 
 * 目的: cTrader OAuth フローの Railway 側エンドポイント
 * 
 * エンドポイント:
 * - GET  /api/auth/ctrader/url     - 認証URL を取得
 * - POST /api/auth/ctrader/exchange - 認可コードをトークンに交換
 * - GET  /api/auth/ctrader/status  - 接続状態を取得
 * - DELETE /api/auth/ctrader       - 接続を解除
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { CTraderAuthService, ExchangeCodeRequestSchema } from '../services/ctrader/ctraderAuthService';

const router = Router();
const prisma = new PrismaClient();
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
router.get('/url', async (req: Request, res: Response) => {
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
 * POST /api/auth/ctrader/exchange
 * 
 * 認可コードをアクセストークンに交換
 * Vercel Callback から呼び出される
 * 
 * Body: { code: string }
 */
router.post('/exchange', async (req: Request, res: Response) => {
  try {
    const bodyResult = ExchangeCodeRequestSchema.safeParse(req.body);
    
    if (!bodyResult.success) {
      return res.status(400).json({
        error: 'リクエストが不正です',
        details: bodyResult.error.format(),
      });
    }
    
    const { code } = bodyResult.data;
    const token = await authService.exchangeCode(code);
    
    console.log(`cTrader 連携成功: アカウント ${token.accountId}`);
    
    return res.json({
      success: true,
      accountId: token.accountId,
      expiresAt: token.expiresAt.toISOString(),
      message: 'cTrader 連携が完了しました',
    });
  } catch (error) {
    console.error('トークン交換エラー:', error);
    
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
      error: 'トークン交換に失敗しました',
      details: errorMessage,
    });
  }
});

/**
 * GET /api/auth/ctrader/status
 * 
 * cTrader 接続状態を取得
 */
router.get('/status', async (_req: Request, res: Response) => {
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
router.delete('/', async (req: Request, res: Response) => {
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
 * POST /api/auth/ctrader/refresh
 * 
 * アクセストークンを手動更新
 * 
 * Body: { accountId: string }
 */
router.post('/refresh', async (req: Request, res: Response) => {
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

export default router;
