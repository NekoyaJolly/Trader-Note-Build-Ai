/**
 * DashboardCharts — ローディングと空データでも描画が破綻しない
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { DashboardCharts } from "@/components/side-b/DashboardCharts";

describe("DashboardCharts", () => {
    it("loading 時はプレースホルダが複数ある", () => {
        const { container } = render(
            <DashboardCharts timeSeries={null} byCategory={null} activity={null} loading />,
        );
        expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    });

    it("データありで見出しが表示される", () => {
        render(
            <DashboardCharts
                loading={false}
                timeSeries={{
                    success: true,
                    period: "monthly",
                    points: [{ periodStart: "2026-01-01T00:00:00.000Z", confirmedCount: 2 }],
                }}
                byCategory={{
                    success: true,
                    categories: [{ category: "time", confirmedCount: 1 }],
                }}
                activity={{
                    success: true,
                    days: 7,
                    points: [{ date: "2026-04-01", count: 1 }],
                }}
            />,
        );
        expect(screen.getByText("confirmed 件数（時系列）")).toBeInTheDocument();
        expect(screen.getByText("カテゴリ別 confirmed")).toBeInTheDocument();
    });
});
