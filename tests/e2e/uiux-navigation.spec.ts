import { test, expect } from "@playwright/test";

/**
 * UI 再設計（P1〜P4）の導線・リダイレクト・ナビ整合 E2E
 *
 * 認証は /api/auth/me をモックしてクライアントをログイン相当にする。
 * 実行: ルートで `npx playwright test tests/e2e/uiux-navigation.spec.ts`
 * バックエンド不要: SKIP_WEBSERVER=1 で既存 dev サーバに撃つ場合も、auth のモックはブラウザ内 fetch に効く。
 */

const mockUser = {
  id: "e2e-user",
  primaryAccountId: "e2e-acc",
  displayName: "E2E User",
  email: "e2e@example.com",
  role: "user" as const,
  active: true,
  lastLoginAt: null as string | null,
  ctraderAccounts: [] as unknown[],
};

async function mockAuthMe(page: import("@playwright/test").Page) {
  await page.route("**/api/auth/me", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: mockUser }),
    });
  });
}

/** /side-b 運転席ページはデータ取得完了までタブを描画しないため、遅延・初回のみ失敗を防ぐ */
const mockAgentStatusBody = JSON.stringify({
  isRunning: false,
  state: "IDLE",
  cycleCount: 0,
  watchSymbols: [] as string[],
  memory: {
    currentState: "IDLE",
    recentTradeResults: [] as unknown[],
    openPositions: [] as unknown[],
    lessonsBySymbol: {} as Record<string, unknown>,
    totalEntries: 0,
    totalConsolidated: 0,
    cycleCount: 0,
  },
});

async function mockSideBAgentDashboardApis(page: import("@playwright/test").Page) {
  await page.route("**/api/side-b/agent/status", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: mockAgentStatusBody,
    });
  });
  await page.route("**/api/side-b/agent/thinking-log**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ log: [], count: 0 }),
    });
  });
  await page.route("**/api/side-b/agent/lessons", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ lessonsBySymbol: {} }),
    });
  });
}

test.describe("未認証リダイレクト", () => {
  test("保護ページは /login?next= に誘導される", async ({ browser }) => {
    // 既存 Cookie・バックエンド有無に依存しないよう未認証を固定する
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route("**/api/auth/me", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Unauthorized" }),
      });
    });
    await page.goto("/side-b/validation?filter=pending");
    await expect(page).toHaveURL(/\/login\?next=/);
    const url = new URL(page.url());
    const next = url.searchParams.get("next");
    expect(next).toBeTruthy();
    const decoded = decodeURIComponent(next!);
    expect(decoded).toContain("/side-b/validation");
    expect(decoded).toContain("filter=pending");
    await context.close();
  });
});

test.describe("ログイン後・不正 next（モック認証）", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthMe(page);
  });

  test("next=https://evil.com では evil に飛ばない", async ({ page }) => {
    await page.goto(
      "/login?next=" + encodeURIComponent("https://evil.com/path"),
    );
    // ログイン済みなら resolve 後にホーム系へ（クエリに evil が残った状態は終端URLではない）
    await expect(page).toHaveURL(
      /^http:\/\/localhost:3102\/($|market-analysis\/?$)/,
      { timeout: 8000 },
    );
    expect(page.url()).toMatch(/^http:\/\/localhost:3102/);
  });

  test("next=//evil.com では外部に飛ばない", async ({ page }) => {
    await page.goto("/login?next=" + encodeURIComponent("//evil.com/x"));
    await expect(page).toHaveURL(
      /^http:\/\/localhost:3102\/($|market-analysis\/?$)/,
      { timeout: 8000 },
    );
  });

  test("next=%2F%2Fevil.com デコード後に拒否", async ({ page }) => {
    await page.goto("/login?next=%2F%2Fevil.com");
    await expect(page).toHaveURL(
      /^http:\/\/localhost:3102\/($|market-analysis\/?$)/,
      { timeout: 8000 },
    );
  });

  test("next=/login はループ回避でフォールバック", async ({ page }) => {
    await page.goto("/login?next=" + encodeURIComponent("/login"));
    await expect(page).toHaveURL(
      /^http:\/\/localhost:3102\/($|market-analysis\/?$)/,
      { timeout: 8000 },
    );
  });

  test("next=/auth/ctrader/callback はフォールバック", async ({ page }) => {
    await page.goto(
      "/login?next=" + encodeURIComponent("/auth/ctrader/callback"),
    );
    await expect(page).toHaveURL(
      /^http:\/\/localhost:3102\/($|market-analysis\/?$)/,
      { timeout: 8000 },
    );
  });
});

test.describe("Side-B ナビ（モック認証）", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthMe(page);
    await mockSideBAgentDashboardApis(page);
  });

  test("/side-b では運転席タブのみ aria-current", async ({ page }) => {
    await page.goto("/side-b");
    const agentTab = page.getByTestId("side-b-agent-tab-agent");
    await expect(agentTab).toHaveAttribute("aria-current", "page");
    const dashTab = page.getByTestId("side-b-agent-tab-dashboard");
    await expect(dashTab).not.toHaveAttribute("aria-current", "page");
  });

  test("/side-b/dashboard のパンくずは台帳（運転席のラベルではない）", async ({
    page,
  }) => {
    await page.goto("/side-b/dashboard");
    const bc = page.getByTestId("side-b-breadcrumb");
    await expect(bc).toContainText("台帳ダッシュボード");
    await expect(bc).not.toContainText("エージェント（運転席）");
  });

  test("パンくずが表示される", async ({ page }) => {
    await page.goto("/side-b/validation");
    const bc = page.getByTestId("side-b-breadcrumb");
    await expect(bc).toBeVisible();
    await expect(bc).toContainText("Side-B");
    await expect(bc).toContainText("検証キュー");
  });
});

test.describe("ホーム・lastSideAPath（モック認証）", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthMe(page);
  });

  test("許可外パスは前回の続きを出さない", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "tradeassist:side_a_last_path",
        JSON.stringify({
          path: "/admin/should-not-exist",
          savedAt: new Date().toISOString(),
        }),
      );
    });
    await page.goto("/");
    await expect(page.getByTestId("home-last-continue")).toHaveCount(0);
  });
});

const viewports: { w: number; h: number; name: string }[] = [
  { w: 375, h: 667, name: "mobile-s" },
  { w: 768, h: 900, name: "tablet" },
  { w: 1024, h: 900, name: "md" },
  { w: 1440, h: 900, name: "xl" },
];

test.describe("主要ビューポートのレイアウト露出", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthMe(page);
    await mockSideBAgentDashboardApis(page);
  });

  for (const vp of viewports) {
    test(`Side-B 運転席 ${vp.name} (${vp.w}px): ヘッダータブとエージェントタブが見える`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto("/side-b");
      await expect(page.getByTestId("workspace-tabs")).toBeVisible();
      await expect(page.getByTestId("side-b-agent-tab-agent")).toBeVisible();
    });
  }
});
