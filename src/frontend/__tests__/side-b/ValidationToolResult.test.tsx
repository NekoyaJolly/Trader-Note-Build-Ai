/**
 * ValidationToolResult のユニットテスト
 *
 * 確認事項:
 *   - 4 状態 (passed / failed / errored / not_run) のマーキング
 *   - ツール名 → 日本語ラベル変換
 *   - 主要メトリクスの表示順・フォーマット（勝率 %化、小数桁）
 *   - expanded=true で全メトリクス表示
 *   - interpretation / error の表示分岐
 */

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { ValidationToolResult } from "@/components/side-b/ValidationToolResult";
import type { ValidationToolResult as ToolResultType } from "@/types/sideB";

function makeResult(overrides: Partial<ToolResultType> = {}): ToolResultType {
    return {
        toolName: "walk_forward",
        success: true,
        passed: true,
        metrics: {
            overfitScore: 0.12345,
            avgInSampleWinRate: 0.58,
            avgOutOfSampleWinRate: 0.55,
            totalTradeCount: 42,
            splitCount: 4,
        },
        interpretation: "IS/OOS の乖離が小さく安定",
        durationMs: 1850,
        ...overrides,
    };
}

describe("ValidationToolResult", () => {
    it("result 未指定は not_run 状態になる", () => {
        render(<ValidationToolResult toolName="walk_forward" />);
        const card = screen.getByTestId("validation-tool-result");
        expect(card).toHaveAttribute("data-state", "not_run");
        expect(screen.getByText("未実行")).toBeInTheDocument();
    });

    it("passed=true は passed 状態で緑バッジ", () => {
        render(
            <ValidationToolResult toolName="walk_forward" result={makeResult()} />,
        );
        const card = screen.getByTestId("validation-tool-result");
        expect(card).toHaveAttribute("data-state", "passed");
        expect(within(screen.getByTestId("state-badge")).getByText("通過"))
            .toBeInTheDocument();
    });

    it("passed=false は failed 状態", () => {
        render(
            <ValidationToolResult
                toolName="walk_forward"
                result={makeResult({ passed: false })}
            />,
        );
        expect(screen.getByTestId("validation-tool-result")).toHaveAttribute(
            "data-state",
            "failed",
        );
        expect(screen.getByText("未達")).toBeInTheDocument();
    });

    it("success=false は errored 状態で error メッセージを表示", () => {
        render(
            <ValidationToolResult
                toolName="walk_forward"
                result={makeResult({
                    success: false,
                    passed: false,
                    error: "Python コンテナがタイムアウト",
                })}
            />,
        );
        const card = screen.getByTestId("validation-tool-result");
        expect(card).toHaveAttribute("data-state", "errored");
        expect(screen.getByTestId("error-message")).toHaveTextContent(
            "Python コンテナがタイムアウト",
        );
    });

    it("ツール名が日本語ラベルに変換される", () => {
        render(
            <ValidationToolResult
                toolName="walk_forward"
                result={makeResult()}
            />,
        );
        expect(screen.getByRole("heading", { name: "ウォークフォワード" }))
            .toBeInTheDocument();
    });

    it("勝率は 0-1 表記が % に変換される", () => {
        render(
            <ValidationToolResult
                toolName="walk_forward"
                result={makeResult({
                    metrics: {
                        overfitScore: 0.1,
                        avgInSampleWinRate: 0.58,
                        avgOutOfSampleWinRate: 0.55,
                        totalTradeCount: 42,
                    },
                })}
            />,
        );
        const cell = document.querySelector(
            '[data-metric-key="avgInSampleWinRate"]',
        );
        expect(cell?.textContent).toBe("58.0%");
    });

    it("overfitScore は小数3桁表示", () => {
        render(
            <ValidationToolResult
                toolName="walk_forward"
                result={makeResult({
                    metrics: { overfitScore: 0.12345, totalTradeCount: 20 },
                })}
            />,
        );
        const cell = document.querySelector('[data-metric-key="overfitScore"]');
        expect(cell?.textContent).toBe("0.123");
    });

    it("トレード数は整数表示", () => {
        render(
            <ValidationToolResult
                toolName="walk_forward"
                result={makeResult({ metrics: { totalTradeCount: 42.7 } })}
            />,
        );
        const cell = document.querySelector('[data-metric-key="totalTradeCount"]');
        expect(cell?.textContent).toBe("43");
    });

    it("サマリでは主要メトリクスのみ表示、expanded=true で全表示", () => {
        const result = makeResult({
            metrics: {
                overfitScore: 0.1,
                avgInSampleWinRate: 0.58,
                avgOutOfSampleWinRate: 0.55,
                totalTradeCount: 42,
                splitCount: 4, // 主要には入らない
                windowsEvaluated: 4, // 主要には入らない
            },
        });

        const { rerender } = render(
            <ValidationToolResult toolName="walk_forward" result={result} />,
        );
        expect(document.querySelector('[data-metric-key="splitCount"]')).toBeNull();

        rerender(
            <ValidationToolResult
                toolName="walk_forward"
                result={result}
                expanded
            />,
        );
        expect(document.querySelector('[data-metric-key="splitCount"]')).not.toBeNull();
        expect(
            document.querySelector('[data-metric-key="windowsEvaluated"]'),
        ).not.toBeNull();
    });

    it("buy_and_hold の outperformance は % 表示", () => {
        render(
            <ValidationToolResult
                toolName="buy_and_hold"
                result={makeResult({
                    toolName: "buy_and_hold",
                    metrics: {
                        outperformance: 0.0075,
                        strategyReturn: 0.03,
                        buyAndHoldReturn: 0.0225,
                    },
                })}
            />,
        );
        expect(
            document.querySelector('[data-metric-key="outperformance"]')?.textContent,
        ).toBe("0.75%");
        expect(
            document.querySelector('[data-metric-key="buyAndHoldReturn"]')?.textContent,
        ).toBe("2.25%");
    });

    it("interpretation が渡されれば表示される", () => {
        render(
            <ValidationToolResult
                toolName="walk_forward"
                result={makeResult({ interpretation: "特徴的な解釈" })}
            />,
        );
        expect(screen.getByTestId("interpretation")).toHaveTextContent("特徴的な解釈");
    });

    it("未知のツール名でもそのまま表示しクラッシュしない", () => {
        render(
            <ValidationToolResult
                toolName="custom_tool"
                result={makeResult({
                    toolName: "custom_tool",
                    metrics: { foo: 1.5, bar: 2 },
                })}
            />,
        );
        expect(
            screen.getByRole("heading", { name: "custom_tool" }),
        ).toBeInTheDocument();
    });
});
