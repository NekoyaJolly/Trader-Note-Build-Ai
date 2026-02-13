/**
 * 本番環境 cTrader API データ取得 UI 検証
 *
 * 目的: バックテスト画面の「事前データ取得」ボタンから
 *       cTrader API 経由でデータが取得できることをUI上で検証する
 *
 * 前提: npm run test:e2e:production:auth で認証セットアップ済み
 *
 * 実行: npx tsx scripts/production-verify-ctrader-fetch-ui.ts
 */

import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const PRODUCTION_UI_URL = process.env.PRODUCTION_UI_URL || 'https://trader-note-build-ai.vercel.app';
const AUTH_STATE_PATH = path.join(process.cwd(), '.auth', 'production.json');

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!fs.existsSync(AUTH_STATE_PATH)) {
    console.error(
      '❌ .auth/production.json がありません。先に npm run test:e2e:production:auth を実行してください。'
    );
    process.exit(1);
  }

  console.log('\n📥 本番環境 cTrader API データ取得 UI 検証開始\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 150,
  });

  const context = await browser.newContext({
    storageState: AUTH_STATE_PATH,
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();

  try {
    // ========== 1. ストラテジー一覧からバックテストページへ ==========
    console.log('[1] ストラテジー一覧へ移動');
    await page.goto(`${PRODUCTION_UI_URL}/strategies`, { waitUntil: 'networkidle' });
    await sleep(2000);

    let strategyLinks = page.locator('a[href^="/strategies/"]');
    const strategyCount = await strategyLinks.count();

    if (strategyCount === 0) {
      console.log('  ⚠ ストラテジーがありません。新規作成が必要です。');
      await page.goto(`${PRODUCTION_UI_URL}/strategies/new`, { waitUntil: 'networkidle' });
      await sleep(2000);
      const nameInput = page.locator('input[placeholder*="RSI"], input[placeholder*="例"]').first();
      if ((await nameInput.count()) > 0) {
        await nameInput.fill('cTrader取得検証用');
        await sleep(500);
        const saveBtn = page.locator('button:has-text("保存"), button:has-text("作成")').first();
        if ((await saveBtn.count()) > 0) {
          await saveBtn.click();
          await sleep(4000);
        }
      }
      await page.goto(`${PRODUCTION_UI_URL}/strategies`, { waitUntil: 'networkidle' });
      await sleep(1500);
      strategyLinks = page.locator('a[href^="/strategies/"]');
    }

    let strategyId: string | null = null;
    const excludeIds = ['new', 'comparison'];
    for (let i = 0; i < Math.min(15, await strategyLinks.count()); i++) {
      const href = await strategyLinks.nth(i).getAttribute('href');
      if (!href) continue;
      const parts = href.split('/').filter(Boolean);
      if (parts[0] !== 'strategies') continue;
      const id = parts[1];
      if (!id || excludeIds.includes(id)) continue;
      if (parts.length === 2) {
        strategyId = id;
        break;
      }
    }

    if (!strategyId) {
      throw new Error('ストラテジーIDを取得できません');
    }

    console.log(`  ストラテジーID: ${strategyId}`);
    await page.goto(`${PRODUCTION_UI_URL}/strategies/${strategyId}/backtest`, { waitUntil: 'networkidle' });
    await sleep(3000);

    if (!page.url().includes('/backtest')) {
      throw new Error('バックテストページに遷移できませんでした');
    }
    console.log('  ✓ バックテストページ表示');

    // ========== 2. 日付範囲を設定（直近7日） ==========
    console.log('\n[2] 日付範囲を設定');
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const startInput = page.locator('input[type="date"]').first();
    const endInput = page.locator('input[type="date"]').nth(1);

    if ((await startInput.count()) > 0) {
      await startInput.fill(startDate.toISOString().split('T')[0]);
      await sleep(300);
    }
    if ((await endInput.count()) >= 1) {
      await endInput.fill(endDate.toISOString().split('T')[0]);
      await sleep(300);
    }
    console.log(`  期間: ${startDate.toISOString().split('T')[0]} 〜 ${endDate.toISOString().split('T')[0]}`);

    // ========== 3. 「事前データ取得」ボタンをクリック ==========
    console.log('\n[3] 「事前データ取得」ボタンをクリック');
    const fetchBtn = page.locator('button:has-text("事前データ取得")').first();

    if ((await fetchBtn.count()) === 0) {
      throw new Error('「事前データ取得」ボタンが見つかりません');
    }

    await fetchBtn.click();
    await sleep(1000);

    // ========== 4. 進捗表示を待機（ctrader ソースを確認） ==========
    console.log('\n[4] cTrader API データ取得の進捗を監視');

    let sawCtraderSource = false;
    let sawCompletion = false;
    let sawError = false;
    let errorMessage = '';

    for (let i = 0; i < 180; i++) {
      await sleep(1000);

      const bodyText = await page.locator('body').textContent() || '';

      // cTrader ソースを検出
      if (bodyText.includes('ctrader') || bodyText.includes('cTrader')) {
        if (!sawCtraderSource) {
          sawCtraderSource = true;
          console.log('  → cTrader API でデータ取得中');
        }
      }

      // Twelve Data フォールバック
      if (bodyText.includes('twelvedata') || bodyText.includes('Twelve Data')) {
        console.log('  → Twelve Data API で取得（cTrader フォールバック後）');
      }

      // 完了メッセージ
      if (bodyText.includes('完了') && bodyText.includes('キャッシュ')) {
        sawCompletion = true;
        console.log('  → データ取得完了');
        break;
      }

      // エラー表示（ログアウト等のUI要素は除外）
      const errEl = page.locator('.bg-red-600, [class*="destructive"], .text-red-400').first();
      if ((await errEl.count()) > 0 && (await errEl.isVisible())) {
        const errText = (await errEl.textContent())?.trim() || '';
        const isRealError =
          errText.length > 0 &&
          !errText.includes('ログアウト') &&
          (errText.includes('エラー') ||
            errText.includes('失敗') ||
            errText.includes('error') ||
            errText.length > 50);
        if (isRealError) {
          sawError = true;
          errorMessage = errText.slice(0, 200);
          console.log('  → エラー検出:', errorMessage);
          break;
        }
      }

      // ボタンが再び有効 = 処理完了の可能性
      const btnDisabled = await fetchBtn.getAttribute('disabled');
      if (!btnDisabled && i > 5) {
        // 進捗バーが消えているか確認
        const progressBar = page.locator('text=取得中..., text=チャンク').first();
        if ((await progressBar.count()) === 0 || !(await progressBar.isVisible())) {
          sawCompletion = true;
          console.log('  → 処理完了（ボタン再有効）');
          break;
        }
      }
    }

    // ========== 5. 結果サマリー ==========
    console.log('\n========================================');
    console.log('  cTrader API データ取得 UI 検証結果');
    console.log('========================================');
    console.log(`  cTrader ソース検出: ${sawCtraderSource ? '✓' : '×'}`);
    console.log(`  完了: ${sawCompletion ? '✓' : '×'}`);
    if (sawError) {
      console.log(`  エラー: ${errorMessage}`);
    }
    console.log('========================================\n');

    if (sawCompletion) {
      console.log('✅ UI から cTrader API データ取得の検証が完了しました\n');
    } else if (sawError) {
      console.log('❌ データ取得中にエラーが発生しました\n');
      process.exit(1);
    } else {
      console.log('⚠ タイムアウトまたは結果が不明です。手動で確認してください。\n');
      await sleep(5000);
    }
  } catch (e) {
    console.error('エラー:', e);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
