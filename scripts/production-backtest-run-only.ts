/**
 * 本番環境 バックテスト実行のみ（データ取得済みを前提）
 *
 * 事前データ取得済みのストラテジーで、バックテスト・モンテカルロ・ウォークフォワードを実行する。
 * 実行: npx tsx scripts/production-backtest-run-only.ts [ストラテジーID]
 */

import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const PRODUCTION_UI_URL = process.env.PRODUCTION_UI_URL || 'https://trader-note-build-ai.vercel.app';
const AUTH_STATE_PATH = path.join(process.cwd(), '.auth', 'production.json');

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!fs.existsSync(AUTH_STATE_PATH)) {
    console.error('❌ .auth/production.json がありません。');
    process.exit(1);
  }

  const strategyIdArg = process.argv[2];

  console.log('\n📊 バックテスト実行（データ取得済み前提）\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 150,
  });

  const context = await browser.newContext({
    storageState: AUTH_STATE_PATH,
    viewport: { width: 1600, height: 1000 },
  });

  const page = await context.newPage();
  let strategyId: string | null = strategyIdArg || null;

  try {
    if (!strategyId) {
      // ストラテジー一覧から RSI80逆張り または最新を取得
      console.log('[1] ストラテジー一覧から対象を取得');
      await page.goto(`${PRODUCTION_UI_URL}/strategies`, { waitUntil: 'networkidle' });
      await sleep(2000);

      const links = page.locator('a[href^="/strategies/"]');
      const count = await links.count();
      for (let i = 0; i < Math.min(count, 20); i++) {
        const href = await links.nth(i).getAttribute('href');
        const text = await links.nth(i).textContent();
        if (href && text && (text.includes('RSI80') || text.includes('検証用'))) {
          strategyId = href.split('/').filter(Boolean)[1];
          if (strategyId && !['new', 'comparison'].includes(strategyId)) {
            console.log(`  ✓ 対象: ${text.trim()} (${strategyId})`);
            break;
          }
        }
      }
      if (!strategyId && count > 0) {
        const firstHref = await links.first().getAttribute('href');
        strategyId = firstHref?.split('/').filter(Boolean)[1] || null;
        console.log(`  ✓ 最初のストラテジーを使用: ${strategyId}`);
      }
    }

    if (!strategyId) {
      throw new Error('ストラテジーIDを指定するか、一覧にストラテジーが存在する必要があります');
    }

    // バックテストページへ
    console.log('\n[2] バックテストページへ移動');
    await page.goto(`${PRODUCTION_UI_URL}/strategies/${strategyId}/backtest`, { waitUntil: 'networkidle' });
    await sleep(3000);

    // シンボル: USD/JPY（事前データ取得済みのシンボルに合わせる）
    const symbolInput = page.locator('input[placeholder="例: USDJPY, XAUUSD"]');
    await symbolInput.click();
    await sleep(300);
    await symbolInput.fill('');
    await sleep(200);
    await symbolInput.fill('USD/JPY');
    await sleep(800);
    // 「USD/JPY」を使用 ボタンで確定（ドロップダウンより確実）
    const useSymbolBtn = page.locator('button:has-text("を使用")').filter({ hasText: 'USD/JPY' }).first();
    if ((await useSymbolBtn.count()) > 0 && (await useSymbolBtn.isVisible())) {
      await useSymbolBtn.click();
    } else {
      // ドロップダウンから選択
      const usdJpyOpt = page.locator('button:has-text("USD/JPY"), button:has-text("USDJPY")').first();
      if ((await usdJpyOpt.count()) > 0) {
        await usdJpyOpt.click();
      }
    }
    await sleep(500);

    // 可変ロット
    await page.locator('button:has-text("リスク計算")').click().catch(() => {});
    await sleep(200);

    // 15分足
    await page.locator('select').filter({ has: page.locator('option[value="15m"]') }).selectOption('15m').catch(() => {});
    await sleep(200);

    // ========== バックテスト実行 ==========
    console.log('\n[3] バックテスト実行');
    const runBtn = page.locator('button:has-text("バックテスト実行")');
    await runBtn.click();
    await sleep(3000);

    // データ不足ダイアログ
    const apiFetchBtn = page.locator('button:has-text("APIからデータ取得")');
    if ((await apiFetchBtn.count()) > 0 && (await apiFetchBtn.isVisible())) {
      console.log('  → データ不足。API取得を実行...');
      await apiFetchBtn.click();
      for (let i = 0; i < 180; i++) {
        await sleep(1000);
        if ((await page.locator('text=勝率').count()) > 0) break;
        if (i % 20 === 0 && i > 0) console.log(`    待機: ${i}s`);
      }
    }

    // 完了待機（最大5分）
    for (let i = 0; i < 300; i++) {
      await sleep(1000);
      const running = page.locator('text=実行中...');
      const winRate = page.locator('text=勝率');
      if ((await winRate.count()) > 0 && (await winRate.first().isVisible())) {
        if ((await running.count()) === 0 || !(await running.first().isVisible())) {
          console.log('  ✓ バックテスト完了');
          break;
        }
      }
      if (i % 30 === 0 && i > 0) console.log(`    待機: ${i}s`);
      if (i >= 299) console.log('  ⚠ タイムアウト');
    }
    await sleep(2000);

    // ========== モンテカルロ ==========
    console.log('\n[4] モンテカルロ分析');
    await page.locator('button:has-text("モンテカルロ")').click();
    await sleep(2000);
    const mcBtn = page.locator('button:has-text("シミュレーション実行"), button:has-text("実行")').first();
    if ((await mcBtn.count()) > 0 && (await mcBtn.isEnabled())) {
      await mcBtn.click();
      await sleep(8000);
      console.log('  ✓ モンテカルロ完了');
    }

    // ========== ウォークフォワード ==========
    console.log('\n[5] ウォークフォワード分析');
    await page.locator('button:has-text("ウォークフォワード")').click();
    await sleep(2000);
    const wfBtn = page.locator('button:has-text("ウォークフォワード実行"), button:has-text("実行")').first();
    if ((await wfBtn.count()) > 0 && (await wfBtn.isEnabled())) {
      await wfBtn.click();
      await sleep(15000);
      console.log('  ✓ ウォークフォワード完了');
    }

    console.log('\n========================================');
    console.log('  バックテスト実行 完了');
    console.log('  ブラウザは開いたままです。確認後に手動で閉じてください。');
    console.log('========================================\n');

    await sleep(30000);
  } catch (e) {
    console.error('エラー:', e);
    await sleep(10000);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
