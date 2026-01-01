/**
 * 認証ミドルウェア
 *
 * JWTトークンを検証し、認証済みユーザー情報をリクエストに付加
 * 保護されたルートへのアクセスを制御
 */

import { Request, Response, NextFunction } from 'express';
import { PrismaClient, UserRole } from '@prisma/client';
import { AuthService, TokenPayload } from '../backend/services/authService';

// Express のリクエスト型を拡張して user プロパティを追加
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

// Prisma クライアントのシングルトン
const prisma = new PrismaClient();
const authService = new AuthService(prisma);

/**
 * 認証必須ミドルウェア
 *
 * Authorization ヘッダーから Bearer トークンを取得し検証
 * 認証成功時は req.user にユーザー情報を設定
 * 認証失敗時は 401 エラーを返す
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  // Authorization ヘッダーの存在チェック
  if (!authHeader) {
    res.status(401).json({
      success: false,
      error: '認証が必要です。Authorization ヘッダーを設定してください。',
    });
    return;
  }

  // Bearer トークン形式のチェック
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res.status(401).json({
      success: false,
      error: '無効な Authorization ヘッダー形式です。Bearer <token> の形式で設定してください。',
    });
    return;
  }

  const token = parts[1];

  try {
    // トークンを検証
    const payload = authService.verifyAccessToken(token);

    // リクエストにユーザー情報を付加
    req.user = payload;

    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : '認証に失敗しました';
    res.status(401).json({
      success: false,
      error: message,
    });
  }
}

/**
 * 認証オプショナルミドルウェア
 *
 * トークンがあれば検証してユーザー情報を設定
 * トークンがなくても次の処理に進む
 * 認証状態に応じて挙動を変えたいルートで使用
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  // Authorization ヘッダーがない場合はそのまま次へ
  if (!authHeader) {
    next();
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    // 形式が不正でも、オプショナルなのでエラーにしない
    next();
    return;
  }

  const token = parts[1];

  try {
    const payload = authService.verifyAccessToken(token);
    req.user = payload;
  } catch {
    // トークンが無効でも、オプショナルなのでエラーにしない
    // req.user は undefined のまま
  }

  next();
}

/**
 * ロールベースアクセス制御ミドルウェア
 *
 * 指定されたロールを持つユーザーのみアクセスを許可
 * requireAuth の後に使用すること
 *
 * @param allowedRoles - アクセスを許可するロールの配列
 * @returns ミドルウェア関数
 *
 * @example
 * // 管理者のみアクセス可能
 * router.delete('/users/:id', requireAuth, requireRole(['admin']), deleteUser);
 */
export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // requireAuth が先に実行されていることを前提とする
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: '認証が必要です',
      });
      return;
    }

    // ユーザーのロールが許可されているかチェック
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: 'この操作を行う権限がありません',
      });
      return;
    }

    next();
  };
}

/**
 * 自分自身またはアドミンのみアクセス可能ミドルウェア
 *
 * リクエストパラメータの userId と認証ユーザーの id を比較
 * 一致するか、管理者ロールの場合のみ許可
 *
 * @param userIdParam - リクエストパラメータでユーザーIDを指定するキー名（デフォルト: 'userId'）
 * @returns ミドルウェア関数
 *
 * @example
 * // 自分のプロフィールまたは管理者のみ編集可能
 * router.put('/users/:userId', requireAuth, requireSelfOrAdmin(), updateUser);
 */
export function requireSelfOrAdmin(userIdParam: string = 'userId') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: '認証が必要です',
      });
      return;
    }

    const targetUserId = req.params[userIdParam];

    // 管理者または自分自身の場合は許可
    if (req.user.role === 'admin' || req.user.userId === targetUserId) {
      next();
      return;
    }

    res.status(403).json({
      success: false,
      error: '他のユーザーのリソースにはアクセスできません',
    });
  };
}
