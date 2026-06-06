/**
 * インジケーター永続化 (条件6) のユニットテスト。
 *
 * loadPersistedIndicators が localStorage から選択インジケーターを復元し、
 * 壊れた値・不正な形は Zod で弾いて [] にフォールバックすることを確認する。
 * これによりアプリ再起動 (リロード) でインジケーターが消えないことを担保する。
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
	loadPersistedIndicators,
	SELECTED_INDICATORS_STORAGE_KEY,
} from "@/components/RealtimeChart";

describe("loadPersistedIndicators (条件6: インジケーター永続化)", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("localStorage が空なら [] を返す", () => {
		expect(loadPersistedIndicators()).toEqual([]);
	});

	it("有効な選択インジケーターを復元する", () => {
		const saved = [
			{ id: "sma", params: { period: 20 }, displaySettings: { color: "#fbbf24", lineWidth: 2 } },
			{ id: "rsi", params: { period: 14 } },
		];
		window.localStorage.setItem(SELECTED_INDICATORS_STORAGE_KEY, JSON.stringify(saved));

		const restored = loadPersistedIndicators();
		expect(restored).toHaveLength(2);
		expect(restored[0].id).toBe("sma");
		expect(restored[0].params.period).toBe(20);
		expect(restored[0].displaySettings?.color).toBe("#fbbf24");
		expect(restored[1].id).toBe("rsi");
	});

	it("壊れた JSON は [] にフォールバックする", () => {
		window.localStorage.setItem(SELECTED_INDICATORS_STORAGE_KEY, "{not valid json");
		expect(loadPersistedIndicators()).toEqual([]);
	});

	it("不正な形 (Zod 検証失敗) は [] にフォールバックする", () => {
		// id 欠落 + params が数値でない → スキーマ違反
		window.localStorage.setItem(
			SELECTED_INDICATORS_STORAGE_KEY,
			JSON.stringify([{ params: { period: "twenty" } }]),
		);
		expect(loadPersistedIndicators()).toEqual([]);
	});

	it("純粋な read で副作用を持たない (複数回呼んでも localStorage を変更しない)", () => {
		// useState lazy initializer は開発時の React StrictMode 等で複数回呼ばれうる。
		// 副作用があると 2 回目以降で設定が壊れる (旧 sentinel バグ)。複数回呼んでも
		// 同じ結果・localStorage 無変更であることを保証する。
		const saved = [{ id: "sma", params: { period: 20 }, displaySettings: { color: "#fbbf24", lineWidth: 2 } }];
		window.localStorage.setItem(SELECTED_INDICATORS_STORAGE_KEY, JSON.stringify(saved));
		const first = loadPersistedIndicators();
		const second = loadPersistedIndicators();
		expect(first).toHaveLength(1);
		expect(second).toHaveLength(1);
		// 何度呼んでも localStorage の中身は元のまま (破棄されない)
		expect(window.localStorage.getItem(SELECTED_INDICATORS_STORAGE_KEY)).toBe(JSON.stringify(saved));
	});
});
