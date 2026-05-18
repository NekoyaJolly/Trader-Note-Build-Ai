/**
 * formatPercent — 0-1 / 0-100 heuristic 吸収のテスト
 *
 * 責務: `formatPercent(value, digits)` が backend での confidence 単位混在
 * (0-1 と 0-100) に対して期待通り % 表示できることを検証する。
 *
 * 統合しなかった理由: 既存 frontend lib テスト群と並列。format.ts は新規ファイル
 * (Wave 1 G5-1) で他のテストファイルと関心事が異なる。
 * 削除条件: backend で confidence の単位が 0-1 に統一され、`formatPercent` の
 *           heuristic 補正が撤去された場合 (= 単純な `*100.toFixed()` に縮退時)。
 */

import { describe, it, expect } from "vitest";
import { formatPercent } from "@/lib/format";

describe("formatPercent", () => {
    it("undefined / null は em-dash を返す", () => {
        expect(formatPercent(undefined)).toBe("—");
        expect(formatPercent(null)).toBe("—");
    });

    it("NaN / Infinity は em-dash を返す", () => {
        expect(formatPercent(NaN)).toBe("—");
        expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("—");
        expect(formatPercent(Number.NEGATIVE_INFINITY)).toBe("—");
    });

    it("0-1 範囲の小数は 100 倍して % 表示する", () => {
        expect(formatPercent(0)).toBe("0.0%");
        expect(formatPercent(0.5)).toBe("50.0%");
        expect(formatPercent(0.66)).toBe("66.0%");
        expect(formatPercent(1)).toBe("100.0%");
    });

    it("1 より大きい値は既に 0-100 と解釈してそのまま表示する", () => {
        expect(formatPercent(1.5)).toBe("1.5%"); // ※ 1.0 ちょうどは 100% 扱い、1.5 は 1.5%
        expect(formatPercent(71)).toBe("71.0%");
        expect(formatPercent(100)).toBe("100.0%");
    });

    it("digits 引数で小数点桁数を変更できる", () => {
        expect(formatPercent(0.66666, 0)).toBe("67%");
        expect(formatPercent(0.66666, 2)).toBe("66.67%");
        expect(formatPercent(0.66666, 3)).toBe("66.666%");
    });

    it("digits=0 でも整数として % 表示", () => {
        expect(formatPercent(0.5, 0)).toBe("50%");
        expect(formatPercent(71, 0)).toBe("71%");
    });
});
