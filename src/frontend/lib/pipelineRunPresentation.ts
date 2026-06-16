/**
 * MatchingPipelineRun の表示用変換。
 *
 * 責務: backend の reason code を Home などの UI で読める日本語に変換する。
 * DB/API の契約ではなく表示層の都合なので、型は `PipelineRunDTO` に閉じる。
 */

import type { PipelineRunDTO } from "./api";

export type PipelineRunCoverageSeverity = "ok" | "warning" | "critical";

export interface PipelineRunSkipReasonItem {
  code: string;
  label: string;
  count: number;
  severity: PipelineRunCoverageSeverity;
}

export interface PipelineRunCoverageSummary {
  severity: PipelineRunCoverageSeverity;
  label: string;
  message: string;
  marketDataUnavailableCount: number;
  degradedEvaluationCount: number;
  totalReasonCount: number;
}

const SKIP_REASON_LABELS: Record<string, string> = {
  market_data_unavailable: "市場データ未取得",
  lens_snapshot_missing: "ノート特徴量不足",
  lens_evaluation_error: "評価エラー",
  missing_market_snapshot_id: "市場スナップショット欠落",
  side_b_excluded: "Side-B通知対象外",
  simultaneous_hit: "同時ヒット制御",
  send_failed: "通知作成失敗",
  notify_error: "通知処理エラー",
  daily_limit: "日次上限",
  score_below_threshold: "しきい値未満",
  duplicate: "重複通知",
  recent_duplicate: "直近重複",
  cooldown: "クールダウン",
  other: "その他",
};

const CRITICAL_REASON_CODES = new Set([
  "market_data_unavailable",
]);

const WARNING_REASON_CODES = new Set([
  "lens_snapshot_missing",
  "lens_evaluation_error",
  "missing_market_snapshot_id",
  "send_failed",
  "notify_error",
]);

function reasonSeverity(code: string): PipelineRunCoverageSeverity {
  if (CRITICAL_REASON_CODES.has(code)) return "critical";
  if (WARNING_REASON_CODES.has(code)) return "warning";
  return "ok";
}

function reasonLabel(code: string): string {
  return SKIP_REASON_LABELS[code] ?? code;
}

function countFor(skipReasons: Record<string, number> | null, code: string): number {
  return skipReasons?.[code] ?? 0;
}

/**
 * skipReasons を件数の多い順に表示用へ変換する。
 */
export function buildSkipReasonItems(
  skipReasons: Record<string, number> | null
): PipelineRunSkipReasonItem[] {
  return Object.entries(skipReasons ?? {})
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .map(([code, count]) => ({
      code,
      label: reasonLabel(code),
      count,
      severity: reasonSeverity(code),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ja"));
}

/**
 * 市場データの可用性と評価カバレッジを、ユーザー向けの短い状態にまとめる。
 */
export function buildPipelineCoverageSummary(run: PipelineRunDTO): PipelineRunCoverageSummary {
  const marketDataUnavailableCount = countFor(run.skipReasons, "market_data_unavailable");
  const degradedEvaluationCount =
    countFor(run.skipReasons, "lens_snapshot_missing") +
    countFor(run.skipReasons, "lens_evaluation_error") +
    countFor(run.skipReasons, "missing_market_snapshot_id");
  const totalReasonCount = buildSkipReasonItems(run.skipReasons)
    .reduce((sum, item) => sum + item.count, 0);

  if (run.status === "failed") {
    return {
      severity: "critical",
      label: "失敗",
      message: marketDataUnavailableCount > 0
        ? `マッチング実行が失敗しました。市場データを取得できなかった評価も ${marketDataUnavailableCount} 件あります。`
        : "マッチング実行が失敗しました。市場データ以外のエラーも含めて確認してください。",
      marketDataUnavailableCount,
      degradedEvaluationCount,
      totalReasonCount,
    };
  }

  if (marketDataUnavailableCount > 0) {
    return {
      severity: "critical",
      label: "要確認",
      message: `市場データを取得できなかった評価が ${marketDataUnavailableCount} 件あります。該当シンボルは今回のマッチング対象から外れています。`,
      marketDataUnavailableCount,
      degradedEvaluationCount,
      totalReasonCount,
    };
  }

  if (degradedEvaluationCount > 0 || run.status === "partial_failure" || run.errorCount > 0) {
    return {
      severity: "warning",
      label: "注意",
      message: "一部の評価で特徴量または実行ログに不足があります。通知結果は通常より保守的に見てください。",
      marketDataUnavailableCount,
      degradedEvaluationCount,
      totalReasonCount,
    };
  }

  return {
    severity: "ok",
    label: "正常",
    message: "直近のマッチングで市場データ取得の失敗は検出されていません。",
    marketDataUnavailableCount,
    degradedEvaluationCount,
    totalReasonCount,
  };
}
