/**
 * SymbolPicker のユニットテスト (チャート銘柄の動的選択, 条件7)
 *
 * 確認事項:
 *   - 現在のシンボルが input に表示される
 *   - 候補 (datalist option) と完全一致する値を入れたら即コミットされる
 *   - free-text を打って blur すると正規化 (大文字・英数字のみ) してコミットされる
 *   - 3 文字未満など無効入力は コミットせず元の symbol に戻す
 *   - 外部で symbol prop が変わったら input も追随する
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SymbolPicker } from "@/components/RealtimeChart";

const OPTIONS = [
	{ value: "XAUUSD", label: "XAU/USD" },
	{ value: "EURUSD", label: "EUR/USD" },
	{ value: "USDJPY", label: "USD/JPY" },
];

function setup(symbol = "XAUUSD") {
	const onCommit = vi.fn();
	const utils = render(
		<SymbolPicker
			symbol={symbol}
			options={OPTIONS}
			onCommit={onCommit}
			listId="test-symbols"
			className="x"
		/>,
	);
	const input = screen.getByLabelText("シンボル") as HTMLInputElement;
	return { onCommit, input, ...utils };
}

describe("SymbolPicker", () => {
	it("現在のシンボルが input に表示される", () => {
		const { input } = setup("EURUSD");
		expect(input.value).toBe("EURUSD");
	});

	it("候補と完全一致する値を入れたら即コミットされる", () => {
		const { input, onCommit } = setup("XAUUSD");
		fireEvent.change(input, { target: { value: "EURUSD" } });
		expect(onCommit).toHaveBeenCalledWith("EURUSD");
	});

	it("free-text を打って blur すると正規化してコミットされる", () => {
		const { input, onCommit } = setup("XAUUSD");
		fireEvent.change(input, { target: { value: "gbp/jpy" } });
		// 入力途中 (候補に無い) ではコミットしない
		expect(onCommit).not.toHaveBeenCalled();
		fireEvent.blur(input);
		expect(onCommit).toHaveBeenCalledWith("GBPJPY");
	});

	it("3 文字未満の無効入力はコミットせず元の symbol に戻す", () => {
		const { input, onCommit } = setup("XAUUSD");
		fireEvent.change(input, { target: { value: "ab" } });
		fireEvent.blur(input);
		expect(onCommit).not.toHaveBeenCalled();
		expect(input.value).toBe("XAUUSD");
	});

	it("同じシンボルを入れても (変化なし) コミットしない", () => {
		const { input, onCommit } = setup("XAUUSD");
		fireEvent.change(input, { target: { value: "xauusd" } });
		fireEvent.blur(input);
		expect(onCommit).not.toHaveBeenCalled();
	});

	it("外部で symbol prop が変わったら input も追随する", () => {
		const onCommit = vi.fn();
		const { rerender } = render(
			<SymbolPicker symbol="XAUUSD" options={OPTIONS} onCommit={onCommit} listId="t" className="x" />,
		);
		const input = screen.getByLabelText("シンボル") as HTMLInputElement;
		expect(input.value).toBe("XAUUSD");
		rerender(
			<SymbolPicker symbol="USDJPY" options={OPTIONS} onCommit={onCommit} listId="t" className="x" />,
		);
		expect(input.value).toBe("USDJPY");
	});
});
