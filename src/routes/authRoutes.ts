/**
 * 認証ルート
 *
 * ユーザー認証に関するAPIエンドポイント
 * - POST /api/auth/register - ユーザー登録
 * - POST /api/auth/login - ログイン
 * - POST /api/auth/refresh - トークンリフレッシュ
 * - POST /api/auth/logout - ログアウト
 * - GET /api/auth/me - 現在のユーザー情報取得
 * - PUT /api/auth/password - パスワード変更
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthService } from '../backend/services/authService';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();
const prisma = new PrismaClient();
const authService = new AuthService(prisma);

/**
 * POST /api/auth/register
 * ユーザー登録
 *
 * @body email - メールアドレス
 * @body password - パスワード（8文字以上）
 * @body displayName - 表示名（任意）
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, displayName } = req.body;

    // バリデーション
    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: 'メールアドレスとパスワードは必須です',
      });
      return;
    }

    // メールアドレス形式のバリデーション
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({
        success: false,
        error: '有効なメールアドレスを入力してください',
      });
      return;
    }

    const result = await authService.register({ email, password, displayName });

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '登録に失敗しました';
    res.status(400).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/auth/login
 * ログイン
 *
 * @body email - メールアドレス
 * @body password - パスワード
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // バリデーション
    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: 'メールアドレスとパスワードは必須です',
      });
      return;
    }

    const result = await authService.login({ email, password });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ログインに失敗しました';
    // 認証エラーは 401
    res.status(401).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/auth/refresh
 * トークンリフレッシュ
 *
 * @body refreshToken - リフレッシュトークン
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({
        success: false,
        error: 'リフレッシュトークンは必須です',
      });
      return;
    }

    const tokens = await authService.refreshTokens(refreshToken);

    res.json({
      success: true,
      data: { tokens },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'トークンのリフレッシュに失敗しました';
    res.status(401).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/auth/logout
 * ログアウト
 *
 * リフレッシュトークンを無効化
 * 認証必須
 */
router.post('/logout', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    await authService.logout(userId);

    res.json({
      success: true,
      message: 'ログアウトしました',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ログアウトに失敗しました';
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/auth/me
 * 現在のユーザー情報を取得
 *
 * 認証必須
 */
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const user = await authService.getUserById(userId);

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'ユーザーが見つかりません',
      });
      return;
    }

    res.json({
      success: true,
      data: { user },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ユーザー情報の取得に失敗しました';
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * PUT /api/auth/password
 * パスワード変更
 *
 * @body currentPassword - 現在のパスワード
 * @body newPassword - 新しいパスワード（8文字以上）
 * 認証必須
 */
router.put('/password', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { currentPassword, newPassword } = req.body;

    // バリデーション
    if (!currentPassword || !newPassword) {
      res.status(400).json({
        success: false,
        error: '現在のパスワードと新しいパスワードは必須です',
      });
      return;
    }

    await authService.changePassword(userId, currentPassword, newPassword);

    res.json({
      success: true,
      message: 'パスワードを変更しました。再度ログインしてください。',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'パスワードの変更に失敗しました';
    res.status(400).json({
      success: false,
      error: message,
    });
  }
});

export default router;
