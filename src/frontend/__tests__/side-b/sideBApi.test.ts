/**
 * sideBApi のユニットテスト（主に URL 組み立て）
 *
 * `listHypotheses` のクエリ組み立てロジックを、内部 util の
 * buildListQuery 経由で検証する。fetch 側のレスポンス処理は、
 * 同一の `request()` を通るため他メソッドでも共通ロジック。
 */

import { describe, it, expect } from "vitest";

import { __test } from "@/lib/sideBApi";
import type { HypothesisListParams } from "@/types/sideB";

const { buildListQuery } = __test;

describe("buildListQuery", () => {
    it("空オブジェクトは空文字を返す", () => {
        expect(buildListQuery({})).toBe("");
    });

    it("配列はカンマ区切り単一キーに変換される", () => {
        const q = buildListQuery({
            statuses: ["confirmed", "rejected"],
            categories: ["time"],
        });
        expect(q).toContain("status=confirmed%2Crejected");
        expect(q).toContain("category=time");
    });

    it("空配列はクエリに含まれない", () => {
        const q = buildListQuery({ statuses: [], symbols: [] });
        expect(q).toBe("");
    });

    it("空白のみの search はクエリに含まれない", () => {
        const q = buildListQuery({ search: "   " });
        expect(q).toBe("");
    });

    it("非空の search は URL エンコードされて送られる", () => {
        const q = buildListQuery({ search: "ロンドン" });
        expect(q).toContain("search=%E3%83%AD%E3%83%B3%E3%83%89%E3%83%B3");
    });

    it("sortBy / page / limit がそれぞれ付与される", () => {
        const q = buildListQuery({ sortBy: "observation", page: 3, limit: 50 });
        expect(q).toContain("sortBy=observation");
        expect(q).toContain("page=3");
        expect(q).toContain("limit=50");
    });

    it("全フィルタの組み合わせで正しい query を出す", () => {
        const params: HypothesisListParams = {
            statuses: ["confirmed"],
            categories: ["time", "volatility"],
            sources: ["ai_generated"],
            symbols: ["XAU/USD"],
            search: "ロンドン",
            sortBy: "oldest",
            page: 2,
            limit: 10,
        };
        const q = buildListQuery(params);
        expect(q.startsWith("?")).toBe(true);
        const sp = new URLSearchParams(q.slice(1));
        expect(sp.get("status")).toBe("confirmed");
        expect(sp.get("category")).toBe("time,volatility");
        expect(sp.get("source")).toBe("ai_generated");
        expect(sp.get("symbol")).toBe("XAU/USD");
        expect(sp.get("search")).toBe("ロンドン");
        expect(sp.get("sortBy")).toBe("oldest");
        expect(sp.get("page")).toBe("2");
        expect(sp.get("limit")).toBe("10");
    });
});
