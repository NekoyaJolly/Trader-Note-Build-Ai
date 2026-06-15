/**
 * 本番 API の認証済み read / safety smoke。
 *
 * 目的:
 * - 認証済みトークンで主要 read API が 401 にならないことを確認する
 * - 実発注 API が production で停止されていることを確認する
 *
 * 実行:
 *   npm run test:e2e:production:functional
 */

import { chromium, type Page } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PRODUCTION_UI_URL = process.env.PRODUCTION_UI_URL ?? 'https://trader-note-build-ai.vercel.app';
const PRODUCTION_API_URL =
  process.env.PRODUCTION_API_URL ?? 'https://trader-note-571157808050.asia-northeast1.run.app';
const AUTH_STATE_PATH = path.join(process.cwd(), '.auth', 'production.json');

interface SmokeResponse {
  status: number;
  ok: boolean;
  text: string;
}

function ensureAuthState(): void {
  if (!fs.existsSync(AUTH_STATE_PATH)) {
    throw new Error('`.auth/production.json` がありません。先に `npm run test:e2e:production:auth` を実行してください。');
  }
}

async function readAuthToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    try {
      return window.localStorage.getItem('auth_token') ?? '';
    } catch {
      return '';
    }
  });
  if (!token) {
    throw new Error('localStorage の auth_token が空です。`npm run test:e2e:production:auth` を再実行してください。');
  }
  return token;
}

async function apiRequest(
  page: Page,
  token: string,
  pathName: string,
  init: RequestInit = {}
): Promise<SmokeResponse> {
  return page.evaluate(
    async ({ apiUrl, endpoint, jwt, requestInit }) => {
      const headers = new Headers(requestInit.headers);
      headers.set('Authorization', `Bearer ${jwt}`);
      if (requestInit.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      const response = await fetch(`${apiUrl}${endpoint}`, {
        ...requestInit,
        headers,
        credentials: 'include',
      });
      return {
        status: response.status,
        ok: response.ok,
        text: await response.text(),
      };
    },
    { apiUrl: PRODUCTION_API_URL, endpoint: pathName, jwt: token, requestInit: init }
  );
}

function assertStatus(name: string, response: SmokeResponse, allowedStatuses: number[]): void {
  if (!allowedStatuses.includes(response.status)) {
    throw new Error(`${name} の status が不正です: ${response.status} body=${response.text.slice(0, 300)}`);
  }
}

async function main(): Promise<void> {
  ensureAuthState();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  const page = await context.newPage();

  try {
    await page.goto(PRODUCTION_UI_URL, { waitUntil: 'domcontentloaded' });
    const token = await readAuthToken(page);

    const me = await apiRequest(page, token, '/api/auth/me');
    assertStatus('/api/auth/me', me, [200]);

    const notes = await apiRequest(page, token, '/api/trades/notes?limit=1');
    assertStatus('/api/trades/notes', notes, [200]);

    const notifications = await apiRequest(page, token, '/api/notifications/unread-count');
    assertStatus('/api/notifications/unread-count', notifications, [200]);

    const disabledOrder = await apiRequest(page, token, '/api/trading/orders', {
      method: 'POST',
      headers: {
        'Idempotency-Key': `prod-smoke-${Date.now()}`,
      },
      body: JSON.stringify({
        symbol: 'XAUUSD',
        side: 'BUY',
        orderType: 'MARKET',
        volume: 0.01,
      }),
    });
    assertStatus('/api/trading/orders disabled guard', disabledOrder, [403]);

    if (!disabledOrder.text.includes('TRADING_ORDER_EXECUTION_DISABLED')) {
      throw new Error('実発注停止ゲートのエラーコードを確認できませんでした。');
    }

    console.log('本番 API functional smoke は成功しました。');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`本番 API functional smoke に失敗しました: ${message}`);
  process.exitCode = 1;
});
