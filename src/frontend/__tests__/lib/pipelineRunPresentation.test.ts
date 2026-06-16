/**
 * MatchingPipelineRun 表示変換のテスト。
 *
 * 責務: backend の skipReasons をユーザー向けの市場データカバレッジ表示に変換する。
 * 統合しなかった理由: Home コンポーネントに埋めると reason code の翻訳を単体検証できないため。
 * 削除条件: backend API が表示用 DTO を直接返すようになり、本 helper が不要になった場合。
 */

import { describe, expect, it } from "vitest";
import type { PipelineRunDTO } from "@/lib/api";
import {
  buildPipelineCoverageSummary,
  buildSkipReasonItems,
} from "@/lib/pipelineRunPresentation";

function makeRun(overrides: Partial<PipelineRunDTO> = {}): PipelineRunDTO {
  return {
    runId: "run-1",
    trigger: "cron",
    status: "success",
    startedAt: "2026-06-16T00:00:00.000Z",
    finishedAt: "2026-06-16T00:00:02.000Z",
    durationMs: 2000,
    totalMatches: 0,
    notified: 0,
    skipped: 0,
    errorCount: 0,
    errors: [],
    skipReasons: {},
    marketStatus: null,
    ...overrides,
  };
}

describe("pipelineRunPresentation", () => {
  it("市場データ未取得は critical のカバレッジ注意として扱う", () => {
    const run = makeRun({
      status: "partial_failure",
      errorCount: 1,
      errors: ["市場データ取得エラー(lens): symbol=USDJPY, timeframe=15m, EODHD timeout"],
      skipReasons: { market_data_unavailable: 2 },
    });

    const summary = buildPipelineCoverageSummary(run);

    expect(summary.severity).toBe("critical");
    expect(summary.label).toBe("要確認");
    expect(summary.marketDataUnavailableCount).toBe(2);
    expect(summary.message).toContain("市場データを取得できなかった評価が 2 件");
  });

  it("レンズスナップショット不足は warning として扱う", () => {
    const run = makeRun({
      skipReasons: { lens_snapshot_missing: 3 },
    });

    const summary = buildPipelineCoverageSummary(run);

    expect(summary.severity).toBe("warning");
    expect(summary.degradedEvaluationCount).toBe(3);
    expect(summary.message).toContain("特徴量");
  });

  it("skipReasons を日本語ラベルと件数順に変換する", () => {
    const items = buildSkipReasonItems({
      cooldown: 1,
      market_data_unavailable: 3,
      lens_snapshot_missing: 2,
    });

    expect(items).toEqual([
      {
        code: "market_data_unavailable",
        label: "市場データ未取得",
        count: 3,
        severity: "critical",
      },
      {
        code: "lens_snapshot_missing",
        label: "ノート特徴量不足",
        count: 2,
        severity: "warning",
      },
      {
        code: "cooldown",
        label: "クールダウン",
        count: 1,
        severity: "ok",
      },
    ]);
  });

  it("問題が無い run は ok として扱う", () => {
    const summary = buildPipelineCoverageSummary(makeRun());

    expect(summary.severity).toBe("ok");
    expect(summary.label).toBe("正常");
    expect(summary.totalReasonCount).toBe(0);
  });
});
