/**
 * HTTP リクエスト単位の相関IDミドルウェア。
 *
 * 目的:
 * - API / UI / CI ログを横断して同じリクエストを追えるようにする
 * - 外部入力ヘッダーは Zod で検証し、安全な値だけを引き継ぐ
 */

import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

const CORRELATION_ID_HEADER = 'x-correlation-id';
const REQUEST_ID_HEADER = 'x-request-id';
const RESPONSE_CORRELATION_ID_HEADER = 'X-Correlation-Id';

const IncomingCorrelationIdSchema = z.string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

declare module 'express' {
  interface Request {
    correlationId?: string;
    requestId?: string;
  }
}

/**
 * 複数値ヘッダーは先頭の文字列だけを候補にする。
 * 理由: proxy 経由で同一ヘッダーが複数化しても、ログの識別子を1つに固定するため。
 */
function pickHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value?.split(',')[0]?.trim();
}

export function buildCorrelationId(input?: string): string {
  const parsed = IncomingCorrelationIdSchema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }
  return randomUUID();
}

export function readIncomingCorrelationId(req: Request): string | undefined {
  return (
    pickHeaderValue(req.headers[CORRELATION_ID_HEADER]) ??
    pickHeaderValue(req.headers[REQUEST_ID_HEADER])
  );
}

export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const correlationId = buildCorrelationId(readIncomingCorrelationId(req));

  req.correlationId = correlationId;
  req.requestId = correlationId;
  res.locals.correlationId = correlationId;
  res.setHeader(RESPONSE_CORRELATION_ID_HEADER, correlationId);

  next();
}
