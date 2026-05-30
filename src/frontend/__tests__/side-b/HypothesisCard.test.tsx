/**
 * HypothesisCard のユニットテスト
 *
 * 確認事項:
 *   - 必須フィールドのみで描画できる (pending-validation 応答相当)
 *   - full / compact variant の切替え（statement 長さとメトリクス表示）
 *   - 勝率は 0-1 / 0-100 表記どちらでも正しく % 変換される
 *   - href 指定時は Link、onClick 指定時はカード自体がクリック可能
 *   - 長い statement は短縮される
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { HypothesisCard } from "@/components/side-b/HypothesisCard";
import type { HypothesisCardData } from "@/components/side-b/HypothesisCard";

const minimal: HypothesisCardData = {
    id: "h1",
    statement: "ロンドン寄り後15分のブレイクアウトは勝率が高い",
    category: "time",
};

describe("HypothesisCard", () => {
    it("必須フィールドだけで描画できる", () => {
        render(<HypothesisCard hypothesis={minimal} />);
        expect(screen.getByTestId("hypothesis-card")).toBeInTheDocument();
        expect(screen.getByTestId("hypothesis-card")).toHaveAttribute(
            "data-hypothesis-id",
            "h1",
        );
        expect(screen.getByText(/ロンドン寄り後15分のブレイクアウト/)).toBeInTheDocument();
        expect(screen.getByText("時間")).toBeInTheDocument();
    });

    it("status を渡すと StatusBadge が表示される", () => {
        render(
            <HypothesisCard
                hypothesis={{ ...minimal, status: "confirmed" }}
            />,
        );
        expect(screen.getByRole("status")).toHaveAttribute("data-status", "confirmed");
    });

    it("source を渡すと日本語ラベルが表示される", () => {
        render(
            <HypothesisCard
                hypothesis={{ ...minimal, source: "ai_generated" }}
            />,
        );
        expect(screen.getByText("AI 生成")).toBeInTheDocument();
    });

    it("statusNote を渡すと状態理由が表示される", () => {
        render(
            <HypothesisCard
                hypothesis={{
                    ...minimal,
                    status: "rejected",
                    statusNote: "検証期間 PF が 1.3 を下回ったため棄却",
                }}
            />,
        );
        const note = screen.getByTestId("status-note");
        expect(note).toBeInTheDocument();
        expect(note).toHaveTextContent("検証期間 PF が 1.3 を下回ったため棄却");
    });

    it("statusNote が無ければ状態理由は描画されない", () => {
        render(<HypothesisCard hypothesis={minimal} />);
        expect(screen.queryByTestId("status-note")).not.toBeInTheDocument();
    });

    it("winCount/lossCount から観測勝率を算出して % 表示する", () => {
        render(
            <HypothesisCard
                hypothesis={{
                    ...minimal,
                    observationCount: 10,
                    winCount: 7,
                    lossCount: 3,
                }}
            />,
        );
        expect(screen.getByText("観測")).toBeInTheDocument();
        expect(screen.getByText("10")).toBeInTheDocument();
        expect(screen.getByText("70.0%")).toBeInTheDocument();
    });

    it("screeningResult の winRate が 0-100 表記でも % 変換せずに渡す (>1 はそのまま)", () => {
        render(
            <HypothesisCard
                hypothesis={{
                    ...minimal,
                    screeningResult: {
                        executedAt: "2026-01-01T00:00:00Z",
                        tradeNoteId: "t1",
                        passed: true,
                        metrics: { pf: 1.82, winRate: 65, tradeCount: 50 },
                    },
                }}
            />,
        );
        // winCount/lossCount が無いので screeningResult の winRate が使われる
        expect(screen.getByText("65.0%")).toBeInTheDocument();
        expect(screen.getByText("1.82")).toBeInTheDocument();
    });

    it("screeningResult の winRate が 0-1 表記でも正しく % に変換される", () => {
        render(
            <HypothesisCard
                hypothesis={{
                    ...minimal,
                    screeningResult: {
                        executedAt: "2026-01-01T00:00:00Z",
                        tradeNoteId: "t1",
                        passed: true,
                        metrics: { pf: 1.82, winRate: 0.55, tradeCount: 50 },
                    },
                }}
            />,
        );
        expect(screen.getByText("55.0%")).toBeInTheDocument();
    });

    it("長い statement は full 時 60 文字、compact 時 30 文字で短縮される", () => {
        const long = "あ".repeat(80);
        const { rerender } = render(
            <HypothesisCard hypothesis={{ ...minimal, statement: long }} variant="full" />,
        );
        // 60 文字 + 省略記号
        expect(screen.getByText(`${"あ".repeat(60)}…`)).toBeInTheDocument();

        rerender(
            <HypothesisCard hypothesis={{ ...minimal, statement: long }} variant="compact" />,
        );
        expect(screen.getByText(`${"あ".repeat(30)}…`)).toBeInTheDocument();
    });

    it("compact 時は symbols / timeframes / avgRR / 日時が非表示", () => {
        render(
            <HypothesisCard
                hypothesis={{
                    ...minimal,
                    symbols: ["XAU/USD"],
                    timeframes: ["15m"],
                    avgRR: 1.8,
                    lastTestedAt: "2026-04-01T00:00:00Z",
                }}
                variant="compact"
            />,
        );
        expect(screen.queryByTestId("symbols")).not.toBeInTheDocument();
        expect(screen.queryByTestId("timeframes")).not.toBeInTheDocument();
        expect(screen.queryByText(/avgRR/)).not.toBeInTheDocument();
        expect(screen.queryByTestId("timestamps")).not.toBeInTheDocument();
    });

    it("full 時は symbols / timeframes が表示される", () => {
        render(
            <HypothesisCard
                hypothesis={{
                    ...minimal,
                    symbols: ["XAU/USD", "EUR/USD"],
                    timeframes: ["15m", "1h"],
                }}
            />,
        );
        expect(screen.getByTestId("symbols")).toHaveTextContent("XAU/USD, EUR/USD");
        expect(screen.getByTestId("timeframes")).toHaveTextContent("15m, 1h");
    });

    it("href 指定時はカードが Link でラップされる", () => {
        const { container } = render(
            <HypothesisCard hypothesis={minimal} href="/side-b/hypotheses/h1" />,
        );
        const link = container.querySelector("a");
        expect(link).not.toBeNull();
        expect(link).toHaveAttribute("href", "/side-b/hypotheses/h1");
    });

    it("href 未指定時は onClick が発火する", () => {
        const handler = vi.fn();
        render(<HypothesisCard hypothesis={minimal} onClick={handler} />);
        fireEvent.click(screen.getByTestId("hypothesis-card"));
        expect(handler).toHaveBeenCalledOnce();
    });
});
