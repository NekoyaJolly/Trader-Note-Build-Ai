/**
 * セッション管理サービス
 * 
 * cTrader OAuth 認証後のJWT発行・検証・Cookie管理を担当
 */

import type { JwtPayload, SignOptions } from 'jsonwebtoken';
import jwt from 'jsonwebtoken';
import type { CookieOptions, Response } from 'express';
import { z } from 'zod';

// 本番環境かどうかを判定
const isProduction = process.env.NODE_ENV === 'production';

const DEVELOPMENT_JWT_SECRET = 'development-secret-change-in-production';
const SAMPLE_JWT_SECRET = 'your-jwt-secret-change-in-production';

function isInsecureJwtSecret(secret: string): boolean {
  return secret === DEVELOPMENT_JWT_SECRET || secret === SAMPLE_JWT_SECRET;
}

/**
 * JWT 署名鍵を解決する。
 *
 * 本番で既知の既定値を使うと任意の JWT を作れるため、設定漏れは起動時に止める。
 */
export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.JWT_SECRET?.trim() || DEVELOPMENT_JWT_SECRET;
  const production = env.NODE_ENV === 'production';

  if (production && isInsecureJwtSecret(secret)) {
    throw new Error('JWT_SECRET が本番環境用に設定されていません');
  }

  return secret;
}

const JWT_SECRET = resolveJwtSecret();
if (!isProduction && isInsecureJwtSecret(JWT_SECRET)) {
  console.warn(
    '[SessionService] 警告: JWT_SECRET が未設定またはサンプル値です。本番環境では必ず安全な秘密鍵を設定してください。',
  );
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
        const e = new Error('トークンの有効期限が切れています');
        (e as Error & { cause?: Error }).cause = error;
        throw e;
      }
      if (error instanceof jwt.JsonWebTokenError) {
        const e = new Error('無効なトークンです');
        (e as Error & { cause?: Error }).cause = error;
        throw e;
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
    // 開発環境では secure: false, sameSite: 'lax'
    // 本番環境では secure: true, sameSite: 'none'（クロスドメイン対応）
    const cookieOptions: CookieOptions = {
      httpOnly: true, // XSS 対策
      secure: isProduction, // 本番環境のみ HTTPS 必須
      sameSite: (isProduction ? 'none' : 'lax'),
      maxAge: ACCESS_TOKEN_EXPIRES_IN_SECONDS * 1000, // ミリ秒
      path: '/',
    };

    console.log('[SessionService] Cookie設定:', {
      secure: cookieOptions.secure,
      sameSite: cookieOptions.sameSite,
      environment: isProduction ? '本番' : '開発',
    });

    res.cookie('auth_token', token, cookieOptions);
  }

  /**
   * Cookie からトークンを削除
   * 
   * @param res - Express Response オブジェクト
   */
  clearTokenCookie(res: Response): void {
    res.clearCookie('auth_token', {
      httpOnly: true,
      secure: isProduction, // 本番環境のみ HTTPS 必須
      sameSite: (isProduction ? 'none' : 'lax'),
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
