/**
 * Zod バリデーションミドルウェア（Express 5 対応版）
 * 
 * 目的: Expressルートでのリクエストバリデーションを簡素化
 * 
 * Express 5 では req.query / req.params が読み取り専用のため、
 * バリデーション済みデータは res.locals に格納します。
 * 
 * 使用例:
 *   // ルート定義
 *   router.get('/', validateQuery(GetNotesQuerySchema), handler);
 *   
 *   // ハンドラー内でのアクセス
 *   const query = getValidatedQuery<GetNotesQuery>(res);
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { formatZodError } from '../schemas/common';

// ========================================
// res.locals のキー定義
// ========================================

const VALIDATED_QUERY_KEY = 'validatedQuery';
const VALIDATED_PARAMS_KEY = 'validatedParams';

// ========================================
// 型安全なアクセサー関数
// ========================================

/**
 * バリデーション済みクエリパラメータを取得
 * validateQuery ミドルウェア通過後に使用
 */
export function getValidatedQuery<T>(res: Response): T {
  return res.locals[VALIDATED_QUERY_KEY] as T;
}

/**
 * バリデーション済みURLパラメータを取得
 * validateParams ミドルウェア通過後に使用
 */
export function getValidatedParams<T>(res: Response): T {
  return res.locals[VALIDATED_PARAMS_KEY] as T;
}

// ========================================
// バリデーションミドルウェア
// ========================================

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
    
    // req.body は Express 5 でも書き換え可能
    req.body = result.data;
    next();
  };
}

/**
 * クエリパラメータのバリデーションミドルウェア
 * 
 * バリデーション成功時: res.locals.validatedQuery にパース済みデータをセット
 * バリデーション失敗時: 400エラーを返却
 * 
 * 取得方法: getValidatedQuery<T>(res)
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
    
    // Express 5: res.locals に格納（req.query は読み取り専用）
    res.locals[VALIDATED_QUERY_KEY] = result.data;
    next();
  };
}

/**
 * URLパラメータのバリデーションミドルウェア
 * 
 * バリデーション成功時: res.locals.validatedParams にパース済みデータをセット
 * バリデーション失敗時: 400エラーを返却
 * 
 * 取得方法: getValidatedParams<T>(res)
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
    
    // Express 5: res.locals に格納（req.params は読み取り専用）
    res.locals[VALIDATED_PARAMS_KEY] = result.data;
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
        res.locals[VALIDATED_QUERY_KEY] = result.data;
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
        res.locals[VALIDATED_PARAMS_KEY] = result.data;
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
