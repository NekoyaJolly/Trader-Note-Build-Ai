/**
 * Side-B 仮説検証 API クライアント (Phase 4d Step 1)
 *
 * 対応範囲: Phase 4c 完了時点で実装済みの 3 エンドポイントのみ。
 * Phase 4d 仕様書で将来要求される一覧系・統計系 API は、各 UI Step 着手時に
 * バックエンド追加 + 本ファイル拡張する (Phase 4c 補完として追加実装許可済)。
 *
 * 実装済みエンドポイント:
 *   GET  /api/side-b/hypotheses/pending-validation
 *   GET  /api/side-b/hypotheses/:id/validation-status
 *   POST /api/side-b/hypotheses/:id/validate
 *
 * 未実装 (Step 2 以降で追加):
 *   GET  /api/side-b/hypotheses?filters...
 *   GET  /api/side-b/hypotheses/:id
 *   GET  /api/side-b/hypotheses/testing
 *   GET  /api/side-b/hypotheses/recently-validated
 *   POST /api/side-b/hypotheses/batch-validate
 *   GET  /api/side-b/stats/*
 *   GET  /api/side-b/system/health
 *
 * @see docs/design/phase_4d_specification.md §4.7
 */

import type {
  PendingValidationResponse,
  ValidateResponse,
  ValidationStatusResponse,
  HypothesisListItem,
} from "@/types/sideB";

// ===========================================
// 基盤
// ===========================================

/**
 * バックエンド API のベース URL。
 * 既存 api.ts と同じ規約。未設定時は空文字列（同一オリジン相対パス）。
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const SIDE_B_BASE = `${API_BASE_URL}/api/side-b`;

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
  const url = `${SIDE_B_BASE}${endpoint}`;
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
// エンドポイント別メソッド
// ===========================================

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

// ===========================================
// export
// ===========================================

export const sideBApi = {
  getPendingValidation,
  getValidationStatus,
  triggerValidation,
};

export type SideBApi = typeof sideBApi;
