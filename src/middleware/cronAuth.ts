/**
 * Cron認証ミドルウェア
 * 
 * 目的: 外部Cronサービス（Railway/Vercel）からのリクエストを認証
 * 
 * 認証方式:
 * - Authorization: Bearer <CRON_SECRET>
 * - または ?secret=<CRON_SECRET> クエリパラメータ
 * 
 * 環境変数:
 * - CRON_SECRET: Cronジョブ認証用シークレット（必須）
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Cronリクエスト認証ミドルウェア
 * 
 * CRON_SECRET環境変数と照合して認証
 * 開発環境ではCRON_SECRET未設定でもパススルー可能
 */
export function cronAuth(req: Request, res: Response, next: NextFunction): void {
  const cronSecret = process.env.CRON_SECRET;
  
  // 開発環境でCRON_SECRET未設定の場合は警告を出してパススルー
  if (!cronSecret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[CronAuth] CRON_SECRET が設定されていません');
      res.status(500).json({ error: 'Cronシークレットが設定されていません' });
      return;
    }
    console.warn('[CronAuth] CRON_SECRET が未設定です。開発環境のためパススルーします。');
    next();
    return;
  }
  
  // Authorizationヘッダーからトークンを取得
  const authHeader = req.headers.authorization;
  let providedSecret: string | undefined;
  
  if (authHeader?.startsWith('Bearer ')) {
    providedSecret = authHeader.substring(7);
  }
  
  // クエリパラメータからも取得を試みる（Railway cron用）
  if (!providedSecret && req.query.secret) {
    providedSecret = req.query.secret as string;
  }
  
  // シークレットの検証
  if (!providedSecret) {
    console.warn('[CronAuth] 認証トークンがありません');
    res.status(401).json({ error: '認証が必要です' });
    return;
  }
  
  if (providedSecret !== cronSecret) {
    console.warn('[CronAuth] 無効な認証トークン');
    res.status(403).json({ error: '認証に失敗しました' });
    return;
  }
  
  // 認証成功
  console.log('[CronAuth] Cronリクエスト認証成功');
  next();
}

/**
 * Cronリクエストかどうかを判定するヘルパー
 */
export function isCronRequest(req: Request): boolean {
  // User-Agentでの判定（Railway/Vercelは特定のUser-Agentを使用）
  const userAgent = req.headers['user-agent'] || '';
  return (
    userAgent.includes('Railway') ||
    userAgent.includes('Vercel') ||
    userAgent.includes('cron') ||
    req.headers['x-cron-job'] === 'true'
  );
}
