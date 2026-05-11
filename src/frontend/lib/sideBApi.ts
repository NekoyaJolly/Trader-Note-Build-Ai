/**
 * Side-B 仮説検証 API クライアント (Phase 4d Step 1)
 *
 * 対応範囲: Phase 4c 完了時点で実装済みの 3 エンドポイントのみ。
 * Phase 4d 仕様書で将来要求される一覧系・統計系 API は、各 UI Step 着手時に
 * バックエンド追加 + 本ファイル拡張する (Phase 4c 補完として追加実装許可済)。
 *
 * 実装済みエンドポイント:
 *   GET  /api/side-b/hypotheses                         [Phase 4d Step 3 で追加]
 *   GET  /api/side-b/hypotheses/:id                     [Phase 4d Step 4 で追加]
 *   GET  /api/side-b/hypotheses/:id/validation-history  [Phase 4d Step 4 で追加]
 *   GET  /api/side-b/hypotheses/pending-validation
 *   GET  /api/side-b/hypotheses/:id/validation-status
 *   POST /api/side-b/hypotheses/:id/validate
 *
 * Step 5/6 で追加済み:
 *   GET  /api/side-b/hypotheses/testing
 *   GET  /api/side-b/hypotheses/recently-validated
 *   POST /api/side-b/hypotheses/batch-validate
 *   GET  /api/side-b/hypotheses/recent-confirmed
 *   GET  /api/side-b/hypotheses/recent-rejected
 *   GET  /api/side-b/stats/overview, time-series, by-category, validation-activity
 *   GET  /api/side-b/discovery/latest
 *   GET  /api/side-b/system/health
 *   POST /api/side-b/plans（即時BT `plan.strategyBacktest`、Phase 6.7b）
 *
 * @see docs/design/phase_4d_specification.md §4.7
 */

import type {
  PendingValidationResponse,
  ValidateResponse,
  ValidationStatusResponse,
  HypothesisListItem,
  HypothesisListParams,
  HypothesisListResponse,
  HypothesisDetailResponse,
  ValidationHistoryResponse,
  EdgeHypothesis,
  ValidationHistoryEntry,
  HypothesesTestingResponse,
  RecentlyValidatedResponse,
  BatchValidateResponse,
  StatsOverviewResponse,
  StatsTimeSeriesResponse,
  StatsByCategoryResponse,
  StatsValidationActivityResponse,
  RecentHypothesesResponse,
  DiscoveryLatestResponse,
  SystemHealthResponse,
  GeneratePlanRequest,
  GeneratePlanResponse,
  ListPlansParams,
  ListPlansResponse,
  GetPlanResponse,
  AITradePlanPayload,
  ListGenerationLessonsQuery,
  ListEvolutionRunsQuery,
} from "@/types/sideB";
import { getPublicApiBaseUrl } from "./publicApiBaseUrl";

// ===========================================
// 基盤
// ===========================================

/**
 * エラー種別。UI のエラー表示で分岐しやすくするため区別する。
 */
export class SideBApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = "SideBApiError";
  }
}

/**
 * 共通 fetch ラッパー。
 *
 * 仕様:
 * - 4xx/5xx は SideBApiError を throw
 * - レスポンスボディの `{ success: false, error }` 形式も SideBApiError に変換
 * - 成功時はジェネリクス T にキャストして返す
 */
async function request<T>(
  endpoint: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${getPublicApiBaseUrl()}/api/side-b${endpoint}`;
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SideBApiError(`ネットワークエラー: ${msg}`, 0, endpoint);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // JSON でないレスポンス（プロキシエラー HTML 等）
    if (!response.ok) {
      throw new SideBApiError(
        `${response.status} ${response.statusText}`,
        response.status,
        endpoint,
      );
    }
    throw new SideBApiError(
      "レスポンスが JSON ではありません",
      response.status,
      endpoint,
    );
  }

  if (!response.ok) {
    const msg =
      (body as { error?: string })?.error ??
      `${response.status} ${response.statusText}`;
    throw new SideBApiError(msg, response.status, endpoint);
  }

  // バックエンドは `{ success: false, error }` の形でも 200 を返さない契約だが、
  // 念のためガードする（Phase 4c 実装はエラー時は 4xx/5xx）。
  if (
    body &&
    typeof body === "object" &&
    "success" in body &&
    (body as { success: unknown }).success === false
  ) {
    const msg = (body as { error?: string }).error ?? "API がエラーを返しました";
    throw new SideBApiError(msg, response.status, endpoint);
  }

  return body as T;
}

// ===========================================
// クエリビルダ
// ===========================================

/**
 * URLSearchParams 組み立て。
 * - 配列フィールドはカンマ区切りの単一キーで送る（バックエンドは両形式対応）
 * - undefined / 空配列 / 空文字は送信しない
 */
function buildListQuery(params: HypothesisListParams): string {
    const sp = new URLSearchParams();

    const appendArray = (key: string, values?: readonly string[]) => {
        if (!values || values.length === 0) return;
        sp.set(key, values.join(","));
    };

    appendArray("status", params.statuses);
    appendArray("category", params.categories);
    appendArray("source", params.sources);
    appendArray("symbol", params.symbols);

    if (params.search && params.search.trim()) {
        sp.set("search", params.search);
    }
    if (params.sortBy) sp.set("sortBy", params.sortBy);
    if (typeof params.page === "number") sp.set("page", String(params.page));
    if (typeof params.limit === "number") sp.set("limit", String(params.limit));

    const s = sp.toString();
    return s ? `?${s}` : "";
}

function buildPlanListQuery(params: ListPlansParams): string {
    const sp = new URLSearchParams();
    if (params.symbol?.trim()) sp.set("symbol", params.symbol.trim());
    if (params.targetDate) sp.set("targetDate", params.targetDate);
    if (params.fromDate) sp.set("fromDate", params.fromDate);
    if (params.toDate) sp.set("toDate", params.toDate);
    if (typeof params.limit === "number") sp.set("limit", String(params.limit));
    if (typeof params.offset === "number") sp.set("offset", String(params.offset));

    const s = sp.toString();
    return s ? `?${s}` : "";
}

// ===========================================
// エンドポイント別メソッド
// ===========================================

/**
 * GET /api/side-b/hypotheses
 *
 * フィルタ・検索・ソート・ページネーション付きの仮説一覧取得。
 * 仕様書 §4.2 の一覧画面用。
 */
async function listHypotheses(
    params: HypothesisListParams = {},
): Promise<HypothesisListResponse> {
    const query = buildListQuery(params);
    return request<HypothesisListResponse>(`/hypotheses${query}`);
}

/**
 * GET /api/side-b/hypotheses/:id
 *
 * 個別仮説の取得（詳細画面 §4.3）。未発見は 404 → SideBApiError(status=404)。
 */
async function getHypothesis(hypothesisId: string): Promise<EdgeHypothesis> {
    if (!hypothesisId) {
        throw new SideBApiError("hypothesisId は必須です", 400, "/hypotheses/:id");
    }
    const res = await request<HypothesisDetailResponse>(
        `/hypotheses/${encodeURIComponent(hypothesisId)}`,
    );
    return res.hypothesis;
}

/**
 * GET /api/side-b/hypotheses/:id/validation-history
 *
 * 検証履歴エントリ配列を新しい順で返す。
 * 実データが揃っていない段階では 0 件 or screening 1 件になることが多い。
 */
async function getValidationHistory(
    hypothesisId: string,
): Promise<ValidationHistoryEntry[]> {
    if (!hypothesisId) {
        throw new SideBApiError(
            "hypothesisId は必須です",
            400,
            "/hypotheses/:id/validation-history",
        );
    }
    const res = await request<ValidationHistoryResponse>(
        `/hypotheses/${encodeURIComponent(hypothesisId)}/validation-history`,
    );
    return res.history;
}

/**
 * GET /api/side-b/hypotheses/pending-validation
 *
 * screening_passed な仮説（検証待ち）一覧を取得する。
 * 仕様書 §4.4 セクション1 および §4.7 の `getPendingValidation` に対応。
 */
async function getPendingValidation(): Promise<HypothesisListItem[]> {
  const res = await request<PendingValidationResponse>("/hypotheses/pending-validation");
  return res.hypotheses;
}

/**
 * GET /api/side-b/hypotheses/:id/validation-status
 *
 * 仮説の現在の検証ステータスと既存レポートを返す。
 * polling での進行表示に利用する (§4.4 §5.4)。
 */
async function getValidationStatus(
  hypothesisId: string,
): Promise<ValidationStatusResponse> {
  if (!hypothesisId) {
    throw new SideBApiError("hypothesisId は必須です", 400, "/validation-status");
  }
  return request<ValidationStatusResponse>(
    `/hypotheses/${encodeURIComponent(hypothesisId)}/validation-status`,
  );
}

/**
 * POST /api/side-b/hypotheses/:id/validate
 *
 * 仮説を即時検証する。Python + LLM でトータル 10〜30 秒かかる点に注意。
 * UI 側はローディング必須、ボタン二重押し防止も必須。
 */
async function triggerValidation(
  hypothesisId: string,
): Promise<ValidateResponse> {
  if (!hypothesisId) {
    throw new SideBApiError("hypothesisId は必須です", 400, "/validate");
  }
  return request<ValidateResponse>(
    `/hypotheses/${encodeURIComponent(hypothesisId)}/validate`,
    { method: "POST" },
  );
}

async function getTestingHypotheses(): Promise<EdgeHypothesis[]> {
  const res = await request<HypothesesTestingResponse>("/hypotheses/testing");
  return res.hypotheses;
}

async function getRecentlyValidated(hours = 24): Promise<EdgeHypothesis[]> {
  const sp = new URLSearchParams();
  if (hours !== 24) sp.set("hours", String(hours));
  const q = sp.toString();
  const res = await request<RecentlyValidatedResponse>(
    `/hypotheses/recently-validated${q ? `?${q}` : ""}`,
  );
  return res.hypotheses;
}

async function batchValidate(ids: string[]): Promise<BatchValidateResponse> {
  if (!ids.length) {
    throw new SideBApiError("ids は1件以上必要です", 400, "/batch-validate");
  }
  return request<BatchValidateResponse>("/hypotheses/batch-validate", {
    method: "POST",
    body: JSON.stringify({ ids: ids.slice(0, 10) }),
  });
}

async function getRecentConfirmed(limit = 5): Promise<EdgeHypothesis[]> {
  const res = await request<RecentHypothesesResponse>(
    `/hypotheses/recent-confirmed?limit=${encodeURIComponent(String(limit))}`,
  );
  return res.hypotheses;
}

async function getRecentRejected(limit = 5): Promise<EdgeHypothesis[]> {
  const res = await request<RecentHypothesesResponse>(
    `/hypotheses/recent-rejected?limit=${encodeURIComponent(String(limit))}`,
  );
  return res.hypotheses;
}

async function getOverviewStats(): Promise<StatsOverviewResponse> {
  return request<StatsOverviewResponse>("/stats/overview");
}

async function getTimeSeriesStats(
  period: "daily" | "monthly" = "monthly",
  limit = 12,
): Promise<StatsTimeSeriesResponse> {
  const sp = new URLSearchParams();
  sp.set("period", period);
  sp.set("limit", String(limit));
  return request<StatsTimeSeriesResponse>(`/stats/time-series?${sp.toString()}`);
}

async function getCategoryStats(): Promise<StatsByCategoryResponse> {
  return request<StatsByCategoryResponse>("/stats/by-category");
}

async function getValidationActivity(days = 30): Promise<StatsValidationActivityResponse> {
  const sp = new URLSearchParams();
  sp.set("days", String(days));
  return request<StatsValidationActivityResponse>(
    `/stats/validation-activity?${sp.toString()}`,
  );
}

async function getLatestDiscovery(): Promise<DiscoveryLatestResponse> {
  return request<DiscoveryLatestResponse>("/discovery/latest");
}

async function getSystemHealth(): Promise<SystemHealthResponse> {
  return request<SystemHealthResponse>("/system/health");
}

/**
 * POST /api/side-b/plans
 *
 * プラン生成。`forceRefresh: true` で同日キャッシュを上書きし、即時BT（`plan.strategyBacktest`）を含めやすい。
 */
async function generatePlan(body: GeneratePlanRequest): Promise<GeneratePlanResponse> {
  if (!body?.symbol?.trim()) {
    throw new SideBApiError("symbol は必須です", 400, "/plans");
  }
  return request<GeneratePlanResponse>("/plans", {
    method: "POST",
    body: JSON.stringify({
      symbol: body.symbol.trim(),
      targetDate: body.targetDate,
      researchId: body.researchId,
      userPreferences: body.userPreferences,
      ohlcvData: body.ohlcvData,
      indicators: body.indicators,
      timeframe: body.timeframe ?? "15m",
      forceRefresh: body.forceRefresh ?? false,
    }),
  });
}

/**
 * GET /api/side-b/plans
 *
 * 保存済みの AITradePlan 一覧を取得する。
 */
async function listPlans(params: ListPlansParams = {}): Promise<ListPlansResponse> {
  return request<ListPlansResponse>(`/plans${buildPlanListQuery(params)}`);
}

/**
 * GET /api/side-b/plans/:id
 */
async function getPlan(planId: string): Promise<AITradePlanPayload> {
  if (!planId) {
    throw new SideBApiError("planId は必須です", 400, "/plans/:id");
  }
  const res = await request<GetPlanResponse>(
    `/plans/${encodeURIComponent(planId)}`,
  );
  return res.plan;
}

/**
 * GET /api/side-b/plans/today/:symbol
 */
async function getTodayPlan(symbol: string): Promise<AITradePlanPayload | null> {
  if (!symbol.trim()) {
    throw new SideBApiError("symbol は必須です", 400, "/plans/today/:symbol");
  }
  try {
    const res = await request<GetPlanResponse>(
      `/plans/today/${encodeURIComponent(symbol.trim())}`,
    );
    return res.plan;
  } catch (err) {
    if (err instanceof SideBApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

// ===========================================
// 進化エンジン (Evolution)
// ===========================================

async function getEvolutionLessons(params: ListGenerationLessonsQuery = {}): Promise<any> {
  const sp = new URLSearchParams();
  if (params.regime) sp.set("regime", params.regime);
  if (params.limit) sp.set("limit", String(params.limit));
  const query = sp.toString() ? `?${sp.toString()}` : '';
  return request<any>(`/evolution/lessons${query}`);
}

async function getEvolutionRuns(params: ListEvolutionRunsQuery = {}): Promise<any> {
  const sp = new URLSearchParams();
  if (params.limit) sp.set("limit", String(params.limit));
  const query = sp.toString() ? `?${sp.toString()}` : '';
  return request<any>(`/evolution/runs${query}`);
}

async function getEvolutionRunSummary(runId: string): Promise<any> {
  if (!runId) throw new SideBApiError("runId は必須です", 400, "/evolution/runs/:runId/summary");
  return request<any>(`/evolution/runs/${encodeURIComponent(runId)}/summary`);
}

async function getEvolutionRunCandidates(runId: string, limit?: number): Promise<any> {
  if (!runId) throw new SideBApiError("runId は必須です", 400, "/evolution/runs/:runId/candidates");
  const query = limit ? `?limit=${limit}` : '';
  return request<any>(`/evolution/runs/${encodeURIComponent(runId)}/candidates${query}`);
}


// ===========================================
// export
// ===========================================

export const sideBApi = {
  listHypotheses,
  getHypothesis,
  getValidationHistory,
  getPendingValidation,
  getValidationStatus,
  triggerValidation,
  getTestingHypotheses,
  getRecentlyValidated,
  batchValidate,
  getRecentConfirmed,
  getRecentRejected,
  getOverviewStats,
  getTimeSeriesStats,
  getCategoryStats,
  getValidationActivity,
  getLatestDiscovery,
  getSystemHealth,
  generatePlan,
  listPlans,
  getPlan,
  getTodayPlan,
  getEvolutionLessons,
  getEvolutionRuns,
  getEvolutionRunSummary,
  getEvolutionRunCandidates,
};

/** 外部テスト向け: クエリ組み立てのみ検証できるよう内部 util を露出 */
export const __test = { buildListQuery, buildPlanListQuery };

export type SideBApi = typeof sideBApi;
