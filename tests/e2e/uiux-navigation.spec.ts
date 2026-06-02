import { test, expect, type Page } from "@playwright/test";

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

const sideAAuthToken = "e2e-side-a-token";

interface ApiCallRecord {
  readonly method: string;
  readonly pathname: string;
  readonly authorization: string | null;
}

const sideANote = {
  id: "note-e2e-1",
  symbol: "EURUSD",
  side: "buy",
  entryPrice: 1.082,
  timestamp: "2026-06-02T09:00:00.000Z",
  createdAt: "2026-06-02T09:00:00.000Z",
  aiSummary: "E2E押し目ノート",
  status: "draft",
};

const sideAStrategy = {
  id: "strategy-e2e-1",
  name: "E2E ブレイクアウト",
  description: "E2E用の最小ストラテジー",
  symbol: "EURUSD",
  side: "buy",
  status: "active",
  currentVersionId: "strategy-version-e2e-1",
  currentVersion: {
    id: "strategy-version-e2e-1",
    versionNumber: 1,
    entryConditions: {
      operator: "AND",
      conditions: [],
    },
    exitSettings: {
      stopLoss: { type: "atr_multiple", value: 1.5 },
      takeProfit: { type: "rr_ratio", value: 2 },
    },
    entryTiming: {
      type: "immediate",
    },
    createdAt: "2026-06-02T09:00:00.000Z",
    changeNote: null,
  },
  versions: [],
  createdAt: "2026-06-02T09:00:00.000Z",
  updatedAt: "2026-06-02T09:00:00.000Z",
  tags: ["e2e"],
};

const sideASettings = {
  notification: {
    enabled: true,
    scoreThreshold: 75,
    maxPerDay: 10,
  },
  timeframes: {
    primary: "1h",
    secondary: ["4h", "1d"],
  },
  display: {
    darkMode: true,
    compactView: false,
    showAiSuggestions: true,
  },
  updatedAt: "2026-06-02T09:00:00.000Z",
};

function jsonResponse(body: object, status = 200): {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
} {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

async function mockSideAApi(page: Page): Promise<ApiCallRecord[]> {
  const calls: ApiCallRecord[] = [];

  await page.addInitScript((token) => {
    localStorage.setItem("auth_token", token);
  }, sideAAuthToken);

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const method = request.method();

    calls.push({
      method,
      pathname,
      authorization: request.headers().authorization ?? null,
    });

    if (method === "GET" && pathname === "/api/auth/me") {
      await route.fulfill(jsonResponse({ user: mockUser }));
      return;
    }

    if (method === "GET" && pathname === "/api/trades/notes/status-counts") {
      await route.fulfill(jsonResponse({ draft: 1, active: 0, archived: 0 }));
      return;
    }

    if (method === "GET" && pathname === "/api/trades/notes") {
      await route.fulfill(jsonResponse({ notes: [sideANote] }));
      return;
    }

    if (method === "GET" && pathname === "/api/notifications/unread-count") {
      await route.fulfill(jsonResponse({ data: { unreadCount: 1 } }));
      return;
    }

    if (method === "GET" && pathname === "/api/notifications") {
      await route.fulfill(jsonResponse({
        notifications: [
          {
            id: "notification-e2e-1",
            matchResultId: "match-e2e-1",
            sentAt: "2026-06-02T10:00:00.000Z",
            channel: "in_app",
            isRead: false,
            readAt: null,
            createdAt: "2026-06-02T10:00:00.000Z",
            matchResult: {
              score: 0.92,
              evaluatedAt: "2026-06-02T10:00:00.000Z",
            },
            tradeNote: {
              symbol: "EURUSD",
              side: "BUY",
              timeframe: "1h",
            },
            reasonSummary: "押し目条件が一致",
          },
        ],
      }));
      return;
    }

    if (method === "GET" && pathname === "/api/side-b/hypotheses/pending-validation") {
      await route.fulfill(jsonResponse({ hypotheses: [] }));
      return;
    }

    if (method === "GET" && pathname === "/api/daily-status") {
      await route.fulfill(jsonResponse({ status: "EURUSDの押し目候補を確認" }));
      return;
    }

    if (method === "GET" && pathname === "/api/strategies") {
      await route.fulfill(jsonResponse({ data: { strategies: [sideAStrategy] } }));
      return;
    }

    if (method === "GET" && pathname === "/api/settings") {
      await route.fulfill(jsonResponse({ data: sideASettings }));
      return;
    }

    if (method === "GET" && pathname === "/api/indicators/metadata") {
      await route.fulfill(jsonResponse({ data: { indicators: [], categories: [] } }));
      return;
    }

    if (method === "GET" && pathname === "/api/indicators/settings") {
      await route.fulfill(jsonResponse({ data: { activeSet: { configs: [] } } }));
      return;
    }

    await route.fulfill(jsonResponse({ error: `E2E未mock API: ${method} ${pathname}` }, 500));
  });

  return calls;
}

async function mockAuthMe(page: Page) {
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

async function mockSideBAgentDashboardApis(page: Page) {
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

  // 旧「運転席タブのみ aria-current」テストは上部タブ strip 廃止 (2026-05-31) に伴い削除。
  // ナビは左サイドバーに一本化されたため、タブ strip の testid (side-b-agent-tab-*) は存在しない。

  test("/side-b/dashboard のパンくずは統計（プランのラベルではない）", async ({
    page,
  }) => {
    await page.goto("/side-b/dashboard");
    const bc = page.getByTestId("side-b-breadcrumb");
    await expect(bc).toContainText("統計");
    await expect(bc).not.toContainText("プラン");
  });

  test("パンくずが表示される", async ({ page }) => {
    await page.goto("/side-b/validation");
    const bc = page.getByTestId("side-b-breadcrumb");
    await expect(bc).toBeVisible();
    await expect(bc).toContainText("Side-B");
    await expect(bc).toContainText("検証");
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

test.describe("Side-A UX最小導線（モック認証）", () => {
  test("ホームの主要CTAとKPIが表示され、Side-A APIに認証ヘッダーが付く", async ({ page }) => {
    const apiCalls = await mockSideAApi(page);

    await page.goto("/");

    await expect(page.getByRole("heading", { name: /TradeAssist/ })).toBeVisible();
    await expect(page.getByText("下書きノート")).toBeVisible();
    await expect(page.getByText("未読通知")).toBeVisible();
    await expect(page.getByText("AI 要確認")).toBeVisible();
    await expect(page.getByText("EURUSDの押し目候補を確認")).toBeVisible();
    await expect(page.getByRole("link", { name: /トレードノート/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /市場を見る/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /ストラテジーを確認/ })).toBeVisible();
    await expect(page.getByText("EURUSD").first()).toBeVisible();

    await expect.poll(() => apiCalls.some((call) => call.pathname === "/api/trades/notes")).toBe(true);
    await expect.poll(() => apiCalls.some((call) => call.pathname === "/api/notifications/unread-count")).toBe(true);

    expect(apiCalls.length).toBeGreaterThan(0);
    expect(apiCalls.every((call) => call.authorization === `Bearer ${sideAAuthToken}`)).toBe(true);
  });

  test("主要Side-Aページが実DBなしのAPI mockで表示できる", async ({ page }) => {
    await mockSideAApi(page);

    await page.goto("/notes");
    await expect(page.getByRole("heading", { name: /トレードノート/ })).toBeVisible();
    await expect(page.getByText("EURUSD").first()).toBeVisible();

    await page.goto("/strategies");
    await expect(page.getByRole("heading", { name: /ストラテジー/ })).toBeVisible();
    await expect(page.getByText("E2E ブレイクアウト")).toBeVisible();

    await page.goto("/notifications");
    await expect(page.getByRole("heading", { name: /通知一覧/ })).toBeVisible();
    await expect(page.getByText("押し目条件が一致")).toBeVisible();

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();
    await expect(page.getByText("通知設定")).toBeVisible();
    await expect(page.getByRole("button", { name: "設定を保存" })).toBeVisible();
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
    test(`Side-B 運転席 ${vp.name} (${vp.w}px): ヘッダーのワークスペースタブが見える`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto("/side-b");
      await expect(page.getByTestId("workspace-tabs")).toBeVisible();
    });
  }
});
