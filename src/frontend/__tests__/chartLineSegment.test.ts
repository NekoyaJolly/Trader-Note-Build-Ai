/**
 * normalizeLineSegment のユニットテスト (条件5 描画の安定化)。
 *
 * lightweight-charts は LineSeries data に昇順・重複なしの時刻を要求し、違反すると
 * setData が throw してチャートが壊れる (ローソク足が消える)。手描きラインがこの条件を
 * 破らないよう正規化することを確認する。
 */

import { describe, it, expect } from "vitest";

import { normalizeLineSegment } from "@/lib/chartLineSegment";

describe("normalizeLineSegment", () => {
	it("昇順かつ別時刻ならそのまま返す", () => {
		const [a, b] = normalizeLineSegment({ time: 100, value: 1 }, { time: 200, value: 2 }, 60);
		expect(a).toEqual({ time: 100, value: 1 });
		expect(b).toEqual({ time: 200, value: 2 });
	});

	it("同一時刻 (単発クリックの水平線等) は 2 点目を step 分ずらす", () => {
		const [a, b] = normalizeLineSegment({ time: 100, value: 5 }, { time: 100, value: 5 }, 60);
		expect(a.time).toBe(100);
		expect(b.time).toBe(160); // 100 + step(60)
		expect(b.value).toBe(5);
		expect(b.time).toBeGreaterThan(a.time); // 昇順が保証される
	});

	it("降順 (右→左に引いたトレンド) は入れ替えて昇順にする", () => {
		const [a, b] = normalizeLineSegment({ time: 300, value: 9 }, { time: 100, value: 3 }, 60);
		expect(a).toEqual({ time: 100, value: 3 });
		expect(b).toEqual({ time: 300, value: 9 });
		expect(b.time).toBeGreaterThan(a.time);
	});

	it("step が 0/負でも最低 1 秒ずらして重複を避ける", () => {
		const [a, b] = normalizeLineSegment({ time: 50, value: 1 }, { time: 50, value: 1 }, 0);
		expect(b.time).toBe(51);
		expect(b.time).toBeGreaterThan(a.time);
	});
});
