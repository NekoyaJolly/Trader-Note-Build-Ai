/**
 * StatusBadge のユニットテスト
 *
 * 確認事項:
 *   - 8 ステータス全てがレンダリング可能で、日本語ラベルが正しい
 *   - data-status 属性と aria-label が付与される
 *   - testing はパルス表現(animate-pulse クラス)を持つ
 *   - not_testable は打ち消し線(line-through)を持つ
 *   - size prop による class 切替え
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { StatusBadge, STATUS_BADGE_LABEL } from "@/components/side-b/StatusBadge";
import { EDGE_STATUSES } from "@/types/sideB";

describe("StatusBadge", () => {
    it("全 8 ステータスで日本語ラベルが表示される", () => {
        for (const status of EDGE_STATUSES) {
            const { unmount } = render(<StatusBadge status={status} />);
            expect(screen.getByText(STATUS_BADGE_LABEL[status])).toBeInTheDocument();
            unmount();
        }
    });

    it("data-status 属性と aria-label が付与される", () => {
        render(<StatusBadge status="confirmed" />);
        const el = screen.getByRole("status");
        expect(el).toHaveAttribute("data-status", "confirmed");
        expect(el).toHaveAttribute("aria-label", "ステータス: 採用");
    });

    it("testing はパルス表現を持つ（進行中の視覚的ヒント）", () => {
        render(<StatusBadge status="testing" />);
        const el = screen.getByRole("status");
        expect(el.className).toContain("animate-pulse");
    });

    it("not_testable は line-through（斜線）を持つ", () => {
        render(<StatusBadge status="not_testable" />);
        const el = screen.getByRole("status");
        expect(el.className).toContain("line-through");
    });

    it("size=sm は sm 用のサイズクラスになる", () => {
        render(<StatusBadge status="confirmed" size="sm" />);
        const el = screen.getByRole("status");
        expect(el.className).toMatch(/text-\[10px\]/);
    });

    it("size=lg は lg 用のサイズクラスになる", () => {
        render(<StatusBadge status="confirmed" size="lg" />);
        const el = screen.getByRole("status");
        expect(el.className).toContain("text-sm");
    });

    it("className prop で追加スタイルを merge できる", () => {
        render(<StatusBadge status="confirmed" className="custom-class" />);
        const el = screen.getByRole("status");
        expect(el.className).toContain("custom-class");
    });
});
