/**
 * Zod バリデーションミドルウェア
 * 
 * 目的: Expressルートでのリクエストバリデーションを簡素化
 * 使用例:
 *   router.post('/', validateBody(CreateProfileRequestSchema), handler);
 *   router.get('/', validateQuery(GetNotesQuerySchema), handler);
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { formatZodError } from '../schemas/common';

/**
 * リクエストボディのバリデーションミドルウェア
 * 
 * バリデーション成功時: req.body にパース済みデータをセット
 * バリデーション失敗時: 400エラーを返却
 */
export function validateBody<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: 'バリデーションエラー',
        details: formatZodError(result.error),
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }
    
    // パース済みデータでreq.bodyを置換（型変換済み）
    req.body = result.data;
    next();
  };
}

/**
 * クエリパラメータのバリデーションミドルウェア
 * 
 * バリデーション成功時: req.query にパース済みデータをセット
 * バリデーション失敗時: 400エラーを返却
 */
export function validateQuery<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: 'クエリパラメータが不正です',
        details: formatZodError(result.error),
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }
    
    // パース済みデータでreq.queryを置換
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req.query as any) = result.data;
    next();
  };
}

/**
 * URLパラメータのバリデーションミドルウェア
 * 
 * バリデーション成功時: req.params にパース済みデータをセット
 * バリデーション失敗時: 400エラーを返却
 */
export function validateParams<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: 'URLパラメータが不正です',
        details: formatZodError(result.error),
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req.params as any) = result.data;
    next();
  };
}

/**
 * 複合バリデーションミドルウェア
 * body, query, params を同時にバリデーション
 */
export function validateRequest<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown
>(options: {
  body?: z.ZodSchema<TBody>;
  query?: z.ZodSchema<TQuery>;
  params?: z.ZodSchema<TParams>;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: { location: string; details: string }[] = [];
    
    // Body バリデーション
    if (options.body) {
      const result = options.body.safeParse(req.body);
      if (!result.success) {
        errors.push({
          location: 'body',
          details: formatZodError(result.error),
        });
      } else {
        req.body = result.data;
      }
    }
    
    // Query バリデーション
    if (options.query) {
      const result = options.query.safeParse(req.query);
      if (!result.success) {
        errors.push({
          location: 'query',
          details: formatZodError(result.error),
        });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (req.query as any) = result.data;
      }
    }
    
    // Params バリデーション
    if (options.params) {
      const result = options.params.safeParse(req.params);
      if (!result.success) {
        errors.push({
          location: 'params',
          details: formatZodError(result.error),
        });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (req.params as any) = result.data;
      }
    }
    
    if (errors.length > 0) {
      res.status(400).json({
        success: false,
        error: 'バリデーションエラー',
        validationErrors: errors,
      });
      return;
    }
    
    next();
  };
}

/**
 * Zodエラーを人間が読みやすい形式にフォーマット（詳細版）
 */
export function formatZodErrorDetailed(error: z.ZodError): {
  message: string;
  issues: Array<{
    path: string;
    code: string;
    message: string;
  }>;
} {
  return {
    message: error.issues.map((e) => e.message).join(', '),
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
      message: issue.message,
    })),
  };
}
