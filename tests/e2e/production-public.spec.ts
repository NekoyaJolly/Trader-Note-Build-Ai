import { expect, test } from '@playwright/test';

const productionApiUrl = process.env.PRODUCTION_API_URL ?? 'https://trader-note-571157808050.asia-northeast1.run.app';

test.describe('本番公開面 smoke', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'production-chromium', 'production config 専用のため通常E2Eでは実行しない');
  });

  test('API の health / ready が 200 を返す', async ({ request }) => {
    const health = await request.get(`${productionApiUrl}/health`);
    expect(health.status()).toBe(200);
    await expect(health).toBeOK();

    const ready = await request.get(`${productionApiUrl}/ready`);
    expect(ready.status()).toBe(200);
    await expect(ready).toBeOK();
  });

  test('未認証の protected API は拒否される', async ({ request }) => {
    const notes = await request.get(`${productionApiUrl}/api/trades/notes`);
    expect(notes.status()).toBe(401);

    const notifications = await request.get(`${productionApiUrl}/api/notifications`);
    expect(notifications.status()).toBe(401);
  });

  test('mail webhook は token なしで拒否される', async ({ request }) => {
    const response = await request.post(`${productionApiUrl}/api/mail/receive`, {
      data: {
        from: 'smoke@example.com',
        subject: 'smoke',
        text: 'ACTION: STOP',
      },
    });
    expect(response.status()).toBe(401);
  });

  test('cron API は secret なしで拒否される', async ({ request }) => {
    const matchingPipeline = await request.get(`${productionApiUrl}/api/cron/matching-pipeline`);
    expect(matchingPipeline.status()).toBe(401);

    const strategyAlerts = await request.get(`${productionApiUrl}/api/cron/strategy-alerts`);
    expect(strategyAlerts.status()).toBe(401);
  });

  test('本番UIのHTMLが配信される', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toBeVisible();
  });
});
