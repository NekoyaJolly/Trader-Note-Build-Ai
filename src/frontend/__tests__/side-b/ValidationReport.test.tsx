/**
 * ValidationReport のユニットテスト
 *
 * 確認事項:
 *   - データソース優先順位: fullValidationReport > screeningResult > 何も無い
 *   - fullReport あり: サマリ行 + 4 ツール全て表示
 *   - screening のみ: 本格検証未実施案内 + 4 ツール (他 3 は未実行)
 *   - 何も無い: 空状態案内 + 4 ツール全て未実行
 *   - errors フィールドがあれば表示される
 *   - screeningResult.reasons が interpretation にまとめられる
 */

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { ValidationReport } from "@/components/side-b/ValidationReport";
import type {
    EdgeHypothesis,
    ConsolidatedValidationReport,
    ScreeningResult,
} from "@/types/sideB";

function baseHypothesis(): EdgeHypothesis {
    return {
        id: "hyp-x",
        statement: "x",
        category: "time",
        conditions: [],
        expectedDirection: "long",
        status: "unverified",
        statusUpdatedAt: "2026-01-01T00:00:00Z",
        symbols: ["XAU/USD"],
        timeframes: ["15m"],
        observationCount: 0,
        winCount: 0,
        lossCount: 0,
        breakevenCount: 0,
        totalPnlPips: 0,
        avgRR: 0,
        source: "ai_generated",
        firstObservedAt: "2026-01-01T00:00:00Z",
        lastObservedAt: "2026-01-01T00:00:00Z",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
    };
}

function makeScreening(overrides: Partial<ScreeningResult> = {}): ScreeningResult {
    return {
        executedAt: "2026-01-10T10:00:00Z",
        tradeNoteId: "note-1",
        passed: true,
        metrics: { pf: 1.8, winRate: 0.55, tradeCount: 30 },
        ...overrides,
    };
}

function makeFullReport(
    overrides: Partial<ConsolidatedValidationReport> = {},
): ConsolidatedValidationReport {
    return {
        hypothesisId: "hyp-x",
        periodUsed: { start: "2025-01-01", end: "2025-12-31" },
        screening: {
            toolName: "screening",
            success: true,
            passed: true,
            metrics: { pf: 1.8, winRate: 0.55, tradeCount: 30 },
            durationMs: 0,
        },
        walkForward: {
            toolName: "walk_forward",
            success: true,
            passed: true,
            metrics: { overfitScore: 0.12, totalTradeCount: 30 },
            durationMs: 1000,
        },
        monteCarlo: {
            toolName: "monte_carlo",
            success: true,
            passed: true,
            metrics: { p5FinalPnl: 100, simulationCount: 1000 },
            durationMs: 100,
        },
        buyAndHold: {
            toolName: "buy_and_hold",
            success: true,
            passed: true,
            metrics: { outperformance: 0.02 },
            durationMs: 10,
        },
        allPassed: true,
        passedCount: 4,
        totalCount: 4,
        startedAt: "2026-02-01T00:00:00Z",
        completedAt: "2026-02-01T00:00:06Z",
        totalDurationMs: 6000,
        errors: [],
        ...overrides,
    };
}

describe("ValidationReport", () => {
    it("何も無い場合: 空状態案内 + 4 ツールすべて未実行", () => {
        render(<ValidationReport hypothesis={baseHypothesis()} />);
        expect(screen.getByTestId("validation-report-empty")).toBeInTheDocument();

        const grid = screen.getByTestId("validation-tools-grid");
        const tools = within(grid).getAllByTestId("validation-tool-result");
        expect(tools).toHaveLength(4);
        for (const t of tools) {
            expect(t).toHaveAttribute("data-state", "not_run");
        }
    });

    it("screeningResult のみ: 本格検証未実施案内 + screening 通過 / 他 3 未実行", () => {
        render(
            <ValidationReport
                hypothesis={{ ...baseHypothesis(), screeningResult: makeScreening() }}
            />,
        );

        expect(screen.getByTestId("validation-report-pending-full")).toBeInTheDocument();
        expect(screen.queryByTestId("validation-report-empty")).toBeNull();
        expect(screen.queryByTestId("validation-report-summary")).toBeNull();

        // screening は passed 状態
        const screeningCard = document.querySelector(
            '[data-tool-name="screening"]',
        ) as HTMLElement;
        expect(screeningCard).toHaveAttribute("data-state", "passed");

        // 他 3 は未実行
        for (const name of ["walk_forward", "monte_carlo", "buy_and_hold"]) {
            const card = document.querySelector(
                `[data-tool-name="${name}"]`,
            ) as HTMLElement;
            expect(card).toHaveAttribute("data-state", "not_run");
        }
    });

    it("screening.reasons が interpretation にまとめられる", () => {
        render(
            <ValidationReport
                hypothesis={{
                    ...baseHypothesis(),
                    screeningResult: makeScreening({
                        passed: false,
                        reasons: ["PF 不足", "トレード数不足"],
                    }),
                }}
            />,
        );
        const interp = document.querySelector(
            '[data-tool-name="screening"] [data-testid="interpretation"]',
        );
        expect(interp?.textContent).toContain("PF 不足");
        expect(interp?.textContent).toContain("トレード数不足");
    });

    it("fullValidationReport あり: サマリ行 + 4 ツール全 passed", () => {
        render(
            <ValidationReport
                hypothesis={{
                    ...baseHypothesis(),
                    fullValidationReport: makeFullReport(),
                }}
            />,
        );

        const summary = screen.getByTestId("validation-report-summary");
        expect(summary).toBeInTheDocument();
        expect(summary.textContent).toContain("4 / 4 ツール通過");
        expect(summary.textContent).toContain("✓ 全通過");

        // 未実施案内は出さない
        expect(screen.queryByTestId("validation-report-pending-full")).toBeNull();
        expect(screen.queryByTestId("validation-report-empty")).toBeNull();

        // 4 ツール全 passed
        for (const name of ["screening", "walk_forward", "monte_carlo", "buy_and_hold"]) {
            const card = document.querySelector(
                `[data-tool-name="${name}"]`,
            ) as HTMLElement;
            expect(card).toHaveAttribute("data-state", "passed");
        }
    });

    it("fullReport が一部失敗: サマリ行に「一部未達」、failed 状態", () => {
        render(
            <ValidationReport
                hypothesis={{
                    ...baseHypothesis(),
                    fullValidationReport: makeFullReport({
                        allPassed: false,
                        passedCount: 2,
                        totalCount: 4,
                        walkForward: {
                            toolName: "walk_forward",
                            success: true,
                            passed: false,
                            metrics: { overfitScore: 0.42 },
                            durationMs: 1000,
                        },
                        buyAndHold: {
                            toolName: "buy_and_hold",
                            success: true,
                            passed: false,
                            metrics: { outperformance: -0.003 },
                            durationMs: 10,
                        },
                    }),
                }}
            />,
        );

        const summary = screen.getByTestId("validation-report-summary");
        expect(summary.textContent).toContain("2 / 4 ツール通過");
        expect(summary.textContent).toContain("一部未達");

        expect(
            document.querySelector('[data-tool-name="walk_forward"]'),
        ).toHaveAttribute("data-state", "failed");
    });

    it("fullReport.errors があれば一覧表示する", () => {
        render(
            <ValidationReport
                hypothesis={{
                    ...baseHypothesis(),
                    fullValidationReport: makeFullReport({
                        errors: ["walkForward: python timeout", "monteCarlo: NaN"],
                        allPassed: false,
                        passedCount: 1,
                        totalCount: 4,
                    }),
                }}
            />,
        );

        const errors = screen.getByTestId("validation-report-errors");
        expect(errors.textContent).toContain("walkForward: python timeout");
        expect(errors.textContent).toContain("monteCarlo: NaN");
    });

    it("fullReport と screeningResult 両方あれば fullReport 優先", () => {
        render(
            <ValidationReport
                hypothesis={{
                    ...baseHypothesis(),
                    screeningResult: makeScreening({ passed: false }),
                    fullValidationReport: makeFullReport(),
                }}
            />,
        );
        // サマリ行が出ている = fullReport 優先
        expect(screen.getByTestId("validation-report-summary")).toBeInTheDocument();
        expect(screen.queryByTestId("validation-report-pending-full")).toBeNull();
        // screening は fullReport 側の値 (passed) を反映
        const card = document.querySelector('[data-tool-name="screening"]');
        expect(card).toHaveAttribute("data-state", "passed");
    });
});
