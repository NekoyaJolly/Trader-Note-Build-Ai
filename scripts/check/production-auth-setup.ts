/**
 * 本番認証 storageState 作成スクリプト。
 *
 * 目的:
 * - 本番 UI smoke で使う Playwright storageState を手動ログインで作成する
 * - cTrader 認証情報や JWT をコード・ログに出さず、ローカル `.auth/production.json` にだけ保存する
 *
 * 実行:
 *   npm run test:e2e:production:auth
 */

import { chromium } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const PRODUCTION_UI_URL = process.env.PRODUCTION_UI_URL ?? 'https://trader-note-build-ai.vercel.app';
const AUTH_DIR = path.join(process.cwd(), '.auth');
const AUTH_STATE_PATH = path.join(AUTH_DIR, 'production.json');

async function waitForEnter(message: string): Promise<void> {
  const readline = createInterface({ input, output });
  try {
    await readline.question(message);
  } finally {
    readline.close();
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  console.log('\n本番認証 storageState を作成します。');
  console.log(`対象 UI: ${PRODUCTION_UI_URL}`);
  console.log(`保存先: ${AUTH_STATE_PATH}`);
  console.log('ブラウザで cTrader ログインを完了し、アプリのホーム画面が見えたら Enter を押してください。\n');

  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  try {
    await page.goto(PRODUCTION_UI_URL, { waitUntil: 'domcontentloaded' });
    await waitForEnter('ログイン完了後に Enter: ');

    await page.goto(PRODUCTION_UI_URL, { waitUntil: 'networkidle' });
    const hasLocalStorageToken = await page.evaluate(() => {
      try {
        return Boolean(window.localStorage.getItem('auth_token'));
      } catch {
        return false;
      }
    });

    const cookies = await context.cookies();
    const hasCookieToken = cookies.some((cookie) => cookie.name === 'auth_token');

    if (!hasLocalStorageToken && !hasCookieToken) {
      throw new Error(
        'auth_token が localStorage / Cookie のどちらにも見つかりません。ログイン完了後に再実行してください。'
      );
    }

    await context.storageState({ path: AUTH_STATE_PATH });
    console.log('\n認証 storageState を保存しました。');
    console.log('次に `npm run test:e2e:production:walkthrough` などを実行できます。\n');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`本番認証 storageState 作成に失敗しました: ${message}`);
  process.exitCode = 1;
});
