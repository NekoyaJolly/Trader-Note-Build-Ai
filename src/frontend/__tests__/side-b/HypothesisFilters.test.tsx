/**
 * HypothesisFilters のユニットテスト
 *
 * 確認事項:
 *   - 8 ステータス / 8 カテゴリ / 5 ソースのチップが描画される
 *   - チップクリックで value.statuses 等がトグルされる
 *   - 同じチップ 2 回押しで配列から除外される (全外しで undefined)
 *   - 検索 input / ソート select の onChange
 *   - シンボルはカンマ区切りを onBlur / Enter でコミット
 *   - フィルタ変更時 page=1 にリセット
 *   - クリアボタンで全フィルタが消える
 *   - 確信度順 ('confidence') は選択肢に含まれない（future work）
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { HypothesisFilters } from "@/components/side-b/HypothesisFilters";
import { EDGE_STATUSES, EDGE_CATEGORIES, EDGE_SOURCES } from "@/types/sideB";

describe("HypothesisFilters", () => {
    it("全ステータス/カテゴリ/ソースのチップが描画される", () => {
        render(<HypothesisFilters value={{}} onChange={() => { }} />);
        for (const s of EDGE_STATUSES) {
            expect(screen.getByTestId(`filter-status-${s}`)).toBeInTheDocument();
        }
        for (const c of EDGE_CATEGORIES) {
            expect(screen.getByTestId(`filter-category-${c}`)).toBeInTheDocument();
        }
        for (const s of EDGE_SOURCES) {
            expect(screen.getByTestId(`filter-source-${s}`)).toBeInTheDocument();
        }
    });

    it("確信度順は sort 選択肢に含まれない (future work)", () => {
        render(<HypothesisFilters value={{}} onChange={() => { }} />);
        const select = screen.getByTestId("filter-sort") as HTMLSelectElement;
        const options = Array.from(select.options).map((o) => o.value);
        expect(options).toEqual(["newest", "oldest", "observation"]);
        expect(options).not.toContain("confidence");
    });

    it("ステータスチップ押下で onChange に統合された配列が渡る", () => {
        const onChange = vi.fn();
        render(<HypothesisFilters value={{}} onChange={onChange} />);
        fireEvent.click(screen.getByTestId("filter-status-confirmed"));
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ statuses: ["confirmed"], page: 1 }),
        );
    });

    it("同じチップを再度押すと配列から外れる（空 → undefined）", () => {
        const onChange = vi.fn();
        render(
            <HypothesisFilters
                value={{ statuses: ["confirmed"] }}
                onChange={onChange}
            />,
        );
        fireEvent.click(screen.getByTestId("filter-status-confirmed"));
        const callArg = onChange.mock.calls[0][0];
        expect(callArg.statuses).toBeUndefined();
    });

    it("フィルタ変更時は page を 1 に戻す", () => {
        const onChange = vi.fn();
        render(
            <HypothesisFilters
                value={{ page: 5, statuses: ["confirmed"] }}
                onChange={onChange}
            />,
        );
        fireEvent.click(screen.getByTestId("filter-category-time"));
        const callArg = onChange.mock.calls[0][0];
        expect(callArg.page).toBe(1);
    });

    it("検索 input の入力で search が更新される", () => {
        const onChange = vi.fn();
        render(<HypothesisFilters value={{}} onChange={onChange} />);
        fireEvent.change(screen.getByTestId("filter-search"), {
            target: { value: "ロンドン" },
        });
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ search: "ロンドン", page: 1 }),
        );
    });

    it("検索 input を空にすると search は undefined", () => {
        const onChange = vi.fn();
        render(<HypothesisFilters value={{ search: "x" }} onChange={onChange} />);
        fireEvent.change(screen.getByTestId("filter-search"), { target: { value: "" } });
        const arg = onChange.mock.calls[0][0];
        expect(arg.search).toBeUndefined();
    });

    it("ソート select の変更で sortBy が更新される", () => {
        const onChange = vi.fn();
        render(<HypothesisFilters value={{}} onChange={onChange} />);
        fireEvent.change(screen.getByTestId("filter-sort"), {
            target: { value: "observation" },
        });
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ sortBy: "observation", page: 1 }),
        );
    });

    it("シンボル入力は onBlur でカンマ区切りに分解", () => {
        const onChange = vi.fn();
        render(<HypothesisFilters value={{}} onChange={onChange} />);
        const input = screen.getByTestId("filter-symbols") as HTMLInputElement;
        fireEvent.change(input, { target: { value: "XAU/USD, EUR/USD ,,, " } });
        fireEvent.blur(input);
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({
                symbols: ["XAU/USD", "EUR/USD"],
                page: 1,
            }),
        );
    });

    it("シンボル入力で Enter キーを押すと即コミット", () => {
        const onChange = vi.fn();
        render(<HypothesisFilters value={{}} onChange={onChange} />);
        const input = screen.getByTestId("filter-symbols") as HTMLInputElement;
        fireEvent.change(input, { target: { value: "XAU/USD" } });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ symbols: ["XAU/USD"] }),
        );
    });

    it("シンボル入力を空にすると symbols は undefined", () => {
        const onChange = vi.fn();
        render(
            <HypothesisFilters
                value={{ symbols: ["XAU/USD"] }}
                onChange={onChange}
            />,
        );
        const input = screen.getByTestId("filter-symbols") as HTMLInputElement;
        fireEvent.change(input, { target: { value: "" } });
        fireEvent.blur(input);
        expect(onChange.mock.calls[0][0].symbols).toBeUndefined();
    });

    it("クリアボタンで limit 以外の全フィルタが消える", () => {
        const onChange = vi.fn();
        render(
            <HypothesisFilters
                value={{
                    statuses: ["confirmed"],
                    categories: ["time"],
                    search: "foo",
                    sortBy: "observation",
                    limit: 25,
                    page: 3,
                }}
                onChange={onChange}
            />,
        );
        fireEvent.click(screen.getByTestId("filter-clear"));
        expect(onChange).toHaveBeenCalledWith({ page: 1, limit: 25 });
    });

    it("value.statuses に含まれるチップは active スタイル", () => {
        render(
            <HypothesisFilters
                value={{ statuses: ["confirmed", "rejected"] }}
                onChange={() => { }}
            />,
        );
        expect(screen.getByTestId("filter-status-confirmed")).toHaveAttribute(
            "data-active",
            "true",
        );
        expect(screen.getByTestId("filter-status-unverified")).toHaveAttribute(
            "data-active",
            "false",
        );
    });
});
