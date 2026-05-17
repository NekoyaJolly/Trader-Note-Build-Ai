import type { AiDebugContext } from "@last-mile-context/schema";

import type {
  StatsOverviewResponse,
  DiscoveryLatestResponse,
  SystemHealthResponse,
} from "@/types/sideB";

/**
 * AI Debug Context の初期値 (Phase 11 / AGENTS.md §「Last-Mile Shared Context Rule」§5)。
 *
 * - `target.type='dashboard'` / `target.id='overview'` 固定 (Dashboard は単一画面)
 * - 初期 `relatedIds` / `domain` は空。load() 成功時に mergeAiDebugContext で実状態を反映
 * - token / cTrader accountId / 取引額 等の機密値は **絶対に入れない**
 * - `screen.mode` は NODE_ENV から判定 (Copilot レビュー対応: ハードコード回避)
 */
export const initialDashboardDebugContext: AiDebugContext = {
  screen: {
    name: "SideBDashboard",
    route: "/side-b/dashboard",
    mode: process.env.NODE_ENV === "production" ? "production" : "development",
  },
  target: {
    type: "dashboard",
    id: "overview",
    relatedIds: {},
  },
  action: {
    name: "idle",
    status: "idle",
    expected: "",
    actual: "",
  },
  domain: {},
  runtime: {
    latestApi: [],
    latestError: null,
    warnings: [],
  },
};

/**
 * dashboard の AI Debug Context patch を state から組み立てる純関数。
 *
 * 3 分岐:
 * - `loading=true` → action.status='pending'
 * - `error !== null` → action.status='failed' + domain にエラーサマリ
 * - 正常系 → action.status='success' + 実状態を domain / target.relatedIds に反映
 *
 * UI コンポーネントから副作用を分離するため pure に保つ。**個人情報・取引額・cTrader
 * accountId は絶対に流さない**。テスト: `__tests__/side-b/dashboardDebugContext.test.ts`
 */
export interface DashboardDebugContextInput {
  loading: boolean;
  error: string | null;
  overview: StatsOverviewResponse | null;
  health: SystemHealthResponse | null;
  discovery: DiscoveryLatestResponse | null;
  recentConfirmedCount: number;
  recentRejectedCount: number;
}

export function buildDashboardDebugContextPatch(
  input: DashboardDebugContextInput,
): Partial<AiDebugContext> {
  const { loading, error, overview, health, discovery, recentConfirmedCount, recentRejectedCount } =
    input;

  if (loading) {
    return {
      action: {
        name: "load-dashboard",
        status: "pending",
        expected: "8 種の Dashboard API がすべて成功して画面に反映される",
        actual: "API 取得中",
      },
    };
  }

  if (error !== null) {
    return {
      action: {
        name: "load-dashboard",
        status: "failed",
        expected: "8 種の Dashboard API がすべて成功して画面に反映される",
        actual: `エラー: ${error}`,
      },
      domain: {
        hypothesisCount: overview?.totalHypotheses ?? null,
        databaseHealth: health?.database ?? null,
        pythonValidatorHealth: health?.pythonValidator ?? null,
        loadError: error,
      },
      runtime: {
        latestApi: [],
        latestError: {
          message: error,
          timestamp: new Date().toISOString(),
        },
        warnings: [],
      },
    };
  }

  // 正常系: overview / health / discovery などのサマリだけを domain に流す
  // (個別の数値・取引額・個人情報・cTrader accountId は入れない原則)
  const sampleDiscoveryId = discovery?.sampleHypotheses[0]?.id;
  return {
    action: {
      name: "load-dashboard",
      status: "success",
      expected: "8 種の Dashboard API がすべて成功して画面に反映される",
      actual: overview === null ? "ロード完了だが overview なし" : "ロード完了",
    },
    target: {
      type: "dashboard",
      id: "overview",
      relatedIds:
        sampleDiscoveryId !== undefined ? { latestDiscoveryHypothesisId: sampleDiscoveryId } : {},
    },
    domain: {
      hypothesisCount: overview?.totalHypotheses ?? null,
      confirmedCount: overview?.confirmedCount ?? null,
      newHypothesesThisWeek: overview?.newHypothesesThisWeek ?? null,
      databaseHealth: health?.database ?? null,
      pythonValidatorHealth: health?.pythonValidator ?? null,
      recentConfirmedCount,
      recentRejectedCount,
      hasLatestDiscoveryWeeklyReport: discovery?.hasWeeklyReport ?? false,
    },
    runtime: {
      latestApi: [],
      latestError: null,
      warnings: [],
    },
  };
}
