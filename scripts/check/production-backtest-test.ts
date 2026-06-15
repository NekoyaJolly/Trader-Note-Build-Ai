/**
 * 本番バックテスト画面の read-only smoke。
 *
 * 目的:
 * - 認証済み状態でストラテジー一覧とバックテスト画面に到達できることを確認する
 * - 本番で重い backtest 実行やデータ作成は行わない
 *
 * 実行:
 *   npm run test:e2e:production:backtest
 */

import { chromium } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PRODUCTION_UI_URL = process.env.PRODUCTION_UI_URL ?? 'https://trader-note-build-ai.vercel.app';
const AUTH_STATE_PATH = path.join(process.cwd(), '.auth', 'production.json');

function ensureAuthState(): void {
  if (!fs.existsSync(AUTH_STATE_PATH)) {
    throw new Error('`.auth/production.json` がありません。先に `npm run test:e2e:production:auth` を実行してください。');
  }
}

async function main(): Promise<void> {
  ensureAuthState();

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const context = await browser.newContext({
    storageState: AUTH_STATE_PATH,
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  try {
    await page.goto(`${PRODUCTION_UI_URL}/strategies`, { waitUntil: 'networkidle' });
    await page.locator('body').waitFor({ state: 'visible', timeout: 10000 });

    const strategyLinks = page.locator('a[href^="/strategies/"]');
    const strategyCount = await strategyLinks.count();
    let strategyId = '';

    for (let i = 0; i < strategyCount; i += 1) {
      const href = await strategyLinks.nth(i).getAttribute('href');
      const parts = href?.split('/').filter(Boolean) ?? [];
      if (parts.length === 2 && parts[0] === 'strategies' && parts[1] !== 'new' && parts[1] !== 'comparison') {
        strategyId = parts[1];
        break;
      }
    }

    if (!strategyId) {
      console.log('ストラテジーが未作成のため、バックテスト詳細画面 smoke はスキップします。');
      return;
    }

    await page.goto(`${PRODUCTION_UI_URL}/strategies/${strategyId}/backtest`, { waitUntil: 'networkidle' });
    await page.locator('body').waitFor({ state: 'visible', timeout: 10000 });
    if (!page.url().includes('/backtest')) {
      throw new Error('バックテスト画面に到達できませんでした。');
    }

    console.log(`本番バックテスト画面 smoke は成功しました。strategyId=${strategyId}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`本番バックテスト画面 smoke に失敗しました: ${message}`);
  process.exitCode = 1;
});
