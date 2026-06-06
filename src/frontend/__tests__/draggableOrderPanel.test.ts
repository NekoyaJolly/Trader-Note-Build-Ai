/**
 * 発注パネル (ドラッグ可能オーバーレイ) のクランプ境界値テスト。
 *
 * clampOverlayPosition がコンテナ内 (端マージン込み) に left/top を収めることを、
 * 正常系 / 境界値 / 異常系 (コンテナよりパネルが大きい) で確認する。
 * ドラッグ移動・初期配置はこの純関数に依存するため、これが UI 配置の正しさを担保する。
 */

import { describe, it, expect } from "vitest";

import { clampOverlayPosition } from "@/components/chart/DraggableOrderPanel";

const BOUNDS = { containerWidth: 800, containerHeight: 500, panelWidth: 192, panelHeight: 120 };
const MARGIN = 8;

describe("clampOverlayPosition (発注パネルの境界クランプ)", () => {
	it("コンテナ内に収まる希望位置はそのまま返す", () => {
		expect(clampOverlayPosition({ left: 300, top: 200 }, BOUNDS, MARGIN)).toEqual({ left: 300, top: 200 });
	});

	it("左上に飛び出す位置は margin にクランプする", () => {
		expect(clampOverlayPosition({ left: -50, top: -50 }, BOUNDS, MARGIN)).toEqual({ left: 8, top: 8 });
	});

	it("右下に飛び出す位置は (コンテナ寸 - パネル寸 - margin) にクランプする", () => {
		// maxLeft = 800 - 192 - 8 = 600 / maxTop = 500 - 120 - 8 = 372
		expect(clampOverlayPosition({ left: 9999, top: 9999 }, BOUNDS, MARGIN)).toEqual({ left: 600, top: 372 });
	});

	it("右端ちょうどの位置は維持される (境界値)", () => {
		expect(clampOverlayPosition({ left: 600, top: 372 }, BOUNDS, MARGIN)).toEqual({ left: 600, top: 372 });
	});

	it("パネルがコンテナより大きい異常系では margin に張り付く", () => {
		const tooBig = { containerWidth: 100, containerHeight: 80, panelWidth: 300, panelHeight: 300 };
		expect(clampOverlayPosition({ left: 50, top: 50 }, tooBig, MARGIN)).toEqual({ left: 8, top: 8 });
	});
});
