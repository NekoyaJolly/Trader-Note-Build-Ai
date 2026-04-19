/**
 * LedgerStats — ローディング / エラー / 概要表示
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { LedgerStats } from "@/components/side-b/LedgerStats";
import type { StatsOverviewResponse } from "@/types/sideB";

const emptyByStatus = {
    unverified: 0,
    screening_passed: 0,
    testing: 0,
    confirmed: 0,
    stale: 0,
    rejected: 0,
    insufficient_data: 0,
    not_testable: 0,
};

function makeOverview(partial: Partial<StatsOverviewResponse> = {}): StatsOverviewResponse {
    return {
        success: true,
        totalHypotheses: 10,
        byStatus: { ...emptyByStatus, confirmed: 3 },
        confirmedCount: 3,
        newHypothesesThisWeek: 2,
        confirmedThisWeek: 1,
        confirmedPrevWeek: 1,
        confirmedGrowthRate: 0,
        lastValidationCompletedAt: null,
        recentValidationSuccessRate: 0.5,
        ...partial,
    };
}

describe("LedgerStats", () => {
    it("loading 時はスケルトンが出る", () => {
        const { container } = render(<LedgerStats overview={null} loading />);
        expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    });

    it("overview があるとき KPI が表示される", () => {
        render(<LedgerStats overview={makeOverview({ totalHypotheses: 42 })} />);
        expect(screen.getByText("42")).toBeInTheDocument();
        expect(screen.getByText("総仮説数")).toBeInTheDocument();
    });

    it("error 時はメッセージを表示", () => {
        render(<LedgerStats overview={null} error="通信失敗" />);
        expect(screen.getByText("通信失敗")).toBeInTheDocument();
    });
});
