/**
 * セッション管理サービス
 * 
 * cTrader OAuth 認証後のJWT発行・検証・Cookie管理を担当
 */

import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { Response } from 'express';
import { z } from 'zod';

// 環境変数から秘密鍵を取得（必須）
const JWT_SECRET = process.env.JWT_SECRET || 'development-secret-change-in-production';
if (!JWT_SECRET || JWT_SECRET === 'development-secret-change-in-production') {
  console.warn('[SessionService] 警告: JWT_SECRET が設定されていません。本番環境では必ず設定してください。');
}

// トークンの有効期限
const ACCESS_TOKEN_EXPIRES_IN = '7d'; // アクセストークン: 7日（cTrader連携なので長め）
const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60; // 7日（秒）

// ========================================
// Zod スキーマ
// ========================================

/**
 * JWTペイロードスキーマ
 */
export const SessionPayloadSchema = z.object({
  userId: z.string().uuid(),
  primaryAccountId: z.string(),
  email: z.string().email().nullable().optional(),
  displayName: z.string().nullable().optional(),
  role: z.enum(['user', 'admin']),
  iat: z.number().optional(), // issued at
  exp: z.number().optional(), // expiration
});

export type SessionPayload = z.infer<typeof SessionPayloadSchema>;

/**
 * JWT作成用ペイロード（iat, exp を除く）
 */
export type CreateSessionPayload = Omit<SessionPayload, 'iat' | 'exp'>;

// ========================================
// セッション管理サービス
// ========================================

export class SessionService {
  /**
   * JWTトークンを生成
   * 
   * @param payload - セッション情報
   * @returns JWTトークン文字列
   */
  generateToken(payload: CreateSessionPayload): string {
    const options: SignOptions = {
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    };

    return jwt.sign(payload, JWT_SECRET, options);
  }

  /**
   * JWTトークンを検証
   * 
   * @param token - JWTトークン
   * @returns デコードされたペイロード
   * @throws Error - トークンが無効な場合
   */
  verifyToken(token: string): SessionPayload {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
      const result = SessionPayloadSchema.safeParse(decoded);

      if (!result.success) {
        throw new Error(`トークンペイロードが不正です: ${result.error.message}`);
      }

      return result.data;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('トークンの有効期限が切れています');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('無効なトークンです');
      }
      throw error;
    }
  }

  /**
   * Cookie にトークンを設定
   * 
   * @param res - Express Response オブジェクト
   * @param token - JWTトークン
   */
  setTokenCookie(res: Response, token: string): void {
    res.cookie('auth_token', token, {
      httpOnly: true, // XSS 対策
      secure: process.env.NODE_ENV === 'production', // 本番環境では HTTPS のみ
      sameSite: 'lax', // CSRF 対策
      maxAge: ACCESS_TOKEN_EXPIRES_IN_SECONDS * 1000, // ミリ秒
      path: '/',
    });
  }

  /**
   * Cookie からトークンを削除
   * 
   * @param res - Express Response オブジェクト
   */
  clearTokenCookie(res: Response): void {
    res.clearCookie('auth_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
  }

  /**
   * トークンからユーザーIDを取得（エラー時は null）
   * 
   * @param token - JWTトークン
   * @returns ユーザーID または null
   */
  getUserIdFromToken(token: string): string | null {
    try {
      const payload = this.verifyToken(token);
      return payload.userId;
    } catch {
      return null;
    }
  }
}

// シングルトンインスタンスのエクスポート
export const sessionService = new SessionService();
