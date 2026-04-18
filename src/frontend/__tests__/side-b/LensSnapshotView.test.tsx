/**
 * LensSnapshotView のユニットテスト
 *
 * 確認事項:
 *   - snapshot=undefined / 空 features で空状態メッセージ
 *   - 複数レンズが一覧表示される
 *   - expandedLenses でパネルの初期展開状態を制御
 *   - 数値と文字列/真偽値で表示が分かれる（文字列 → Badge）
 *   - 数値フォーマット: 整数は整数、0.01 未満は指数表記、それ以外は小数3桁
 *   - 特徴量 0 件のレンズでも破綻しない
 */

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import {
    LensSnapshotView,
    type LensSnapshot,
} from "@/components/side-b/LensSnapshotView";

describe("LensSnapshotView", () => {
    it("snapshot 未指定時は空状態", () => {
        render(<LensSnapshotView />);
        expect(screen.getByTestId("lens-snapshot-empty")).toHaveTextContent(
            "レンズスナップショットはありません",
        );
    });

    it("features が空オブジェクトの場合も空状態", () => {
        render(
            <LensSnapshotView
                snapshot={{ timestamp: "2026-01-01T00:00:00Z", features: {} }}
            />,
        );
        expect(screen.getByTestId("lens-snapshot-empty")).toHaveTextContent(
            "記録されたレンズがありません",
        );
    });

    it("複数レンズがそれぞれ details パネルで描画される", () => {
        const snapshot: LensSnapshot = {
            timestamp: "2026-01-01T12:34:56Z",
            features: {
                time_session: { session: "london", hoursFromOpen: 0.5 },
                volatility_regime: { regime: "contracting", bb_width: 0.00234 },
            },
        };
        render(<LensSnapshotView snapshot={snapshot} />);

        const panels = screen.getAllByTestId("lens-panel");
        expect(panels).toHaveLength(2);
        expect(panels[0]).toHaveAttribute("data-lens-name", "time_session");
        expect(panels[1]).toHaveAttribute("data-lens-name", "volatility_regime");
    });

    it("expandedLenses で指定したレンズだけ open 状態になる", () => {
        const snapshot: LensSnapshot = {
            timestamp: "2026-01-01T00:00:00Z",
            features: {
                time_session: { session: "london" },
                dow_theory: { trend: "up" },
            },
        };
        render(
            <LensSnapshotView
                snapshot={snapshot}
                expandedLenses={["dow_theory"]}
            />,
        );

        const panels = screen.getAllByTestId("lens-panel");
        const timeSession = panels.find(
            (p) => p.getAttribute("data-lens-name") === "time_session",
        ) as HTMLDetailsElement;
        const dowTheory = panels.find(
            (p) => p.getAttribute("data-lens-name") === "dow_theory",
        ) as HTMLDetailsElement;

        expect(timeSession.open).toBe(false);
        expect(dowTheory.open).toBe(true);
    });

    it("数値は数値として、文字列は Badge として表示される", () => {
        const snapshot: LensSnapshot = {
            timestamp: "2026-01-01T00:00:00Z",
            features: {
                volatility_regime: {
                    regime: "contracting",
                    bb_width_percentile: 45.678,
                },
            },
        };
        render(<LensSnapshotView snapshot={snapshot} expandedLenses={["volatility_regime"]} />);

        const regimeCell = document.querySelector('[data-feature-key="regime"]');
        const percentileCell = document.querySelector(
            '[data-feature-key="bb_width_percentile"]',
        );

        expect(regimeCell).not.toBeNull();
        // string は Badge（outline バリアントは text-gray-400 border-slate-600 を持つ）
        expect(within(regimeCell as HTMLElement).getByText("contracting"))
            .toBeInTheDocument();

        // 数値は小数3桁
        expect(percentileCell?.textContent).toBe("45.678");
    });

    it("整数値は整数のまま表示（末尾の .000 を付けない）", () => {
        const snapshot: LensSnapshot = {
            timestamp: "2026-01-01T00:00:00Z",
            features: { lens: { count: 10 } },
        };
        render(<LensSnapshotView snapshot={snapshot} expandedLenses={["lens"]} />);
        const cell = document.querySelector('[data-feature-key="count"]');
        expect(cell?.textContent).toBe("10");
    });

    it("0.01 未満の小さい数値は指数表記になる", () => {
        const snapshot: LensSnapshot = {
            timestamp: "2026-01-01T00:00:00Z",
            features: { lens: { tiny: 0.00123 } },
        };
        render(<LensSnapshotView snapshot={snapshot} expandedLenses={["lens"]} />);
        const cell = document.querySelector('[data-feature-key="tiny"]');
        expect(cell?.textContent).toMatch(/e-/); // 指数表記
    });

    it("真偽値は Badge で true/false 表示", () => {
        const snapshot: LensSnapshot = {
            timestamp: "2026-01-01T00:00:00Z",
            features: { lens: { flag: true } },
        };
        render(<LensSnapshotView snapshot={snapshot} expandedLenses={["lens"]} />);
        expect(screen.getByText("true")).toBeInTheDocument();
    });

    it("特徴量 0 件のレンズでも『特徴量がありません』で表示される", () => {
        const snapshot: LensSnapshot = {
            timestamp: "2026-01-01T00:00:00Z",
            features: { empty_lens: {} },
        };
        render(<LensSnapshotView snapshot={snapshot} expandedLenses={["empty_lens"]} />);
        expect(screen.getByText("特徴量がありません")).toBeInTheDocument();
    });

    it("snapshot.timestamp が日本語フォーマットで表示される", () => {
        const snapshot: LensSnapshot = {
            timestamp: "2026-01-15T05:30:00Z",
            features: { lens: { v: 1 } },
        };
        render(<LensSnapshotView snapshot={snapshot} />);
        const ts = screen.getByTestId("snapshot-timestamp");
        // ja-JP ロケールなので "2026" と "15" が含まれる
        expect(ts.textContent).toMatch(/2026/);
        expect(ts.textContent).toMatch(/記録時刻/);
    });
});
