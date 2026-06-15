/**
 * 本番 UI の認証済みウォークスルー smoke。
 *
 * 目的:
 * - 手動ログインで作成した `.auth/production.json` を使い、主要画面が表示できることを確認する
 * - データ作成や重いジョブ実行は行わない
 *
 * 実行:
 *   npm run test:e2e:production:walkthrough
 */

import { chromium, type Page } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PRODUCTION_UI_URL = process.env.PRODUCTION_UI_URL ?? 'https://trader-note-build-ai.vercel.app';
const AUTH_STATE_PATH = path.join(process.cwd(), '.auth', 'production.json');

const TARGET_PATHS = [
  '/',
  '/notes',
  '/notifications',
  '/settings/notifications',
  '/chart',
  '/strategies',
] as const;

function ensureAuthState(): void {
  if (!fs.existsSync(AUTH_STATE_PATH)) {
    throw new Error('`.auth/production.json` がありません。先に `npm run test:e2e:production:auth` を実行してください。');
  }
}

async function assertNoFatalUi(page: Page, pathName: string): Promise<void> {
  const bodyText = (await page.locator('body').textContent()) ?? '';
  const lowerText = bodyText.toLowerCase();
  const fatalWords = ['application error', 'runtime error', '予期しないエラー'];
  const matched = fatalWords.find((word) => lowerText.includes(word.toLowerCase()));
  if (matched) {
    throw new Error(`${pathName} で致命的な UI エラー文言を検出しました: ${matched}`);
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
    for (const pathName of TARGET_PATHS) {
      const url = `${PRODUCTION_UI_URL}${pathName}`;
      console.log(`確認中: ${url}`);
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (!response || response.status() >= 400) {
        throw new Error(`${pathName} の配信ステータスが不正です: ${response?.status() ?? 'no response'}`);
      }
      await page.locator('body').waitFor({ state: 'visible', timeout: 10000 });
      await assertNoFatalUi(page, pathName);
    }

    console.log('本番 UI ウォークスルー smoke は成功しました。');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`本番 UI ウォークスルー smoke に失敗しました: ${message}`);
  process.exitCode = 1;
});
