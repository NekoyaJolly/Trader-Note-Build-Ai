/**
 * 条件ツリーのフラット ⇄ ツリー変換（接合点ごとの AND/OR）のユニットテスト。
 *
 * 重点:
 *  - 往復安定性: flatten → normalize → flatten で items 順序・接合点・リーフ ID が保たれること
 *  - 優先順位: OR が外・AND が内（`A かつ B または C` = `(A かつ B) または C`）に正規化されること
 *  - 後方互換: 旧来の単一演算子グループ（全 AND / 全 OR）も正しくフラット化されること
 *  - ネスト保持: `(A または B) かつ C` のような OR ブロックは潰さず 1 要素として残すこと
 */

import { describe, it, expect } from "vitest";
import {
  flattenConditionGroup,
  normalizeFlatConditions,
  isFlattenableGroup,
  evaluateTimeConditionAt,
  type ConditionGroup,
  type IndicatorCondition,
  type TimeCondition,
} from "@/types/strategy";

// テスト用のリーフ条件を作る（ID で同一性を追えるようにする）
function cond(id: string): IndicatorCondition {
  return {
    conditionId: id,
    indicatorId: "rsi",
    params: { period: 14 },
    field: "value",
    operator: "<",
    compareTarget: { type: "fixed", value: 30 },
  };
}

// items を ID 列に落として比較しやすくする
function ids(items: ReadonlyArray<{ conditionId?: string; groupId?: string }>): string[] {
  return items.map((it) => it.conditionId ?? it.groupId ?? "?");
}

describe("flattenConditionGroup", () => {
  it("全 AND の単一グループ → 1 列・接合点すべて AND", () => {
    const g: ConditionGroup = {
      groupId: "g",
      operator: "AND",
      conditions: [cond("a"), cond("b"), cond("c")],
    };
    const flat = flattenConditionGroup(g);
    expect(ids(flat.items)).toEqual(["a", "b", "c"]);
    expect(flat.junctions).toEqual(["AND", "AND"]);
  });

  it("全 OR の単一グループ → 1 列・接合点すべて OR", () => {
    const g: ConditionGroup = {
      groupId: "g",
      operator: "OR",
      conditions: [cond("a"), cond("b"), cond("c")],
    };
    const flat = flattenConditionGroup(g);
    expect(ids(flat.items)).toEqual(["a", "b", "c"]);
    expect(flat.junctions).toEqual(["OR", "OR"]);
  });

  it("OR-of-AND 標準形 → AND ラン内は AND・ラン境界は OR", () => {
    // (a かつ b) または (c かつ d)
    const g: ConditionGroup = {
      groupId: "g",
      operator: "OR",
      conditions: [
        { groupId: "and1", operator: "AND", conditions: [cond("a"), cond("b")] },
        { groupId: "and2", operator: "AND", conditions: [cond("c"), cond("d")] },
      ],
    };
    const flat = flattenConditionGroup(g);
    expect(ids(flat.items)).toEqual(["a", "b", "c", "d"]);
    expect(flat.junctions).toEqual(["AND", "OR", "AND"]);
  });

  it("OR の下の AND ラン内に OR ブロックがあれば 1 要素として保持する", () => {
    // a かつ (b または c) → items: [a, ORブロック], 接合点 [AND]
    const orBlock: ConditionGroup = {
      groupId: "orb",
      operator: "OR",
      conditions: [cond("b"), cond("c")],
    };
    const g: ConditionGroup = {
      groupId: "g",
      operator: "AND",
      conditions: [cond("a"), orBlock],
    };
    const flat = flattenConditionGroup(g);
    expect(ids(flat.items)).toEqual(["a", "orb"]);
    expect(flat.junctions).toEqual(["AND"]);
  });

  it("入れ子の AND は結合則で平坦化する", () => {
    const g: ConditionGroup = {
      groupId: "g",
      operator: "AND",
      conditions: [cond("a"), { groupId: "inner", operator: "AND", conditions: [cond("b"), cond("c")] }],
    };
    const flat = flattenConditionGroup(g);
    expect(ids(flat.items)).toEqual(["a", "b", "c"]);
    expect(flat.junctions).toEqual(["AND", "AND"]);
  });
});

describe("normalizeFlatConditions", () => {
  it("単一 AND ラン → AND グループ", () => {
    const g = normalizeFlatConditions(
      { items: [cond("a"), cond("b")], junctions: ["AND"] },
      "root",
    );
    expect(g.operator).toBe("AND");
    expect(g.groupId).toBe("root");
    expect(ids(g.conditions)).toEqual(["a", "b"]);
  });

  it("OR を含む → OR を外・AND を内に束ねる（優先順位 AND>OR）", () => {
    // a かつ b または c → (a かつ b) または c
    const g = normalizeFlatConditions(
      { items: [cond("a"), cond("b"), cond("c")], junctions: ["AND", "OR"] },
      "root",
    );
    expect(g.operator).toBe("OR");
    expect(g.conditions).toHaveLength(2);
    const [arm1, arm2] = g.conditions;
    expect("operator" in arm1 && arm1.operator).toBe("AND");
    expect(ids((arm1 as ConditionGroup).conditions)).toEqual(["a", "b"]);
    // 長さ 1 のアームは AND で包まず直接 OR の子に置く
    expect((arm2 as IndicatorCondition).conditionId).toBe("c");
  });

  it("空の items → 空 AND グループ", () => {
    const g = normalizeFlatConditions({ items: [], junctions: [] }, "root");
    expect(g.operator).toBe("AND");
    expect(g.conditions).toEqual([]);
  });

  it("AND ラッパーの groupId は決定的（同入力なら同 ID）", () => {
    const flat = { items: [cond("a"), cond("b"), cond("c")], junctions: ["OR", "AND"] as ("AND" | "OR")[] };
    const g1 = normalizeFlatConditions(flat, "root");
    const g2 = normalizeFlatConditions(flat, "root");
    expect(JSON.stringify(g1)).toBe(JSON.stringify(g2));
  });
});

describe("往復安定性 (flatten → normalize → flatten)", () => {
  const cases: { name: string; items: string[]; junctions: ("AND" | "OR")[] }[] = [
    { name: "全 AND", items: ["a", "b", "c"], junctions: ["AND", "AND"] },
    { name: "全 OR", items: ["a", "b", "c"], junctions: ["OR", "OR"] },
    { name: "混在 AND→OR", items: ["a", "b", "c"], junctions: ["AND", "OR"] },
    { name: "混在 OR→AND", items: ["a", "b", "c"], junctions: ["OR", "AND"] },
    { name: "複数アーム", items: ["a", "b", "c", "d"], junctions: ["AND", "OR", "AND"] },
    { name: "単一リーフ", items: ["a"], junctions: [] },
  ];

  cases.forEach(({ name, items, junctions }) => {
    it(`${name}: 接合点と items 順序が保たれる`, () => {
      const flat = { items: items.map(cond), junctions };
      const tree = normalizeFlatConditions(flat, "root");
      const reflat = flattenConditionGroup(tree);
      expect(ids(reflat.items)).toEqual(items);
      expect(reflat.junctions).toEqual(junctions);
    });
  });
});

describe("evaluateTimeConditionAt（JST基準）", () => {
  // epoch(ms) を UTC で組み立てるヘルパー。evaluateTimeConditionAt は内部で +9h して JST にする。
  // 例: UTC 2026-01-01 00:00 → JST 2026-01-01 09:00（木曜）
  const utc = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo, d, h, mi);

  it("時間帯（09:00–15:00 JST）: 範囲内 true / 終端は排他 / 範囲外 false", () => {
    const c: TimeCondition = { conditionId: "t", type: "time", kind: "time_range", startMinutes: 9 * 60, endMinutes: 15 * 60 };
    expect(evaluateTimeConditionAt(c, utc(2026, 0, 1, 0))).toBe(true); // JST 09:00
    expect(evaluateTimeConditionAt(c, utc(2026, 0, 1, 6))).toBe(false); // JST 15:00（end 排他）
    expect(evaluateTimeConditionAt(c, utc(2026, 0, 1, 10))).toBe(false); // JST 19:00
  });

  it("時間帯の日跨ぎ（22:00–翌05:00 JST）", () => {
    const c: TimeCondition = { conditionId: "t", type: "time", kind: "time_range", startMinutes: 22 * 60, endMinutes: 5 * 60 };
    expect(evaluateTimeConditionAt(c, utc(2026, 0, 1, 14))).toBe(true); // JST 23:00
    expect(evaluateTimeConditionAt(c, utc(2025, 11, 31, 18))).toBe(true); // JST 2026-01-01 03:00
    expect(evaluateTimeConditionAt(c, utc(2026, 0, 1, 3))).toBe(false); // JST 12:00
  });

  it("negate（以外で成立）は真偽を反転する", () => {
    const c: TimeCondition = { conditionId: "t", type: "time", kind: "time_range", startMinutes: 9 * 60, endMinutes: 15 * 60, negate: true };
    expect(evaluateTimeConditionAt(c, utc(2026, 0, 1, 0))).toBe(false); // JST 09:00 は範囲内→反転
    expect(evaluateTimeConditionAt(c, utc(2026, 0, 1, 10))).toBe(true); // JST 19:00 は範囲外→反転
  });

  it("曜日（月〜金）: 木曜 true / 土曜 false", () => {
    const c: TimeCondition = { conditionId: "t", type: "time", kind: "day_of_week", days: [1, 2, 3, 4, 5] };
    expect(evaluateTimeConditionAt(c, utc(2026, 0, 1, 1))).toBe(true); // JST 2026-01-01 木曜
    expect(evaluateTimeConditionAt(c, utc(2026, 0, 3, 1))).toBe(false); // JST 2026-01-03 土曜
  });

  it("セッション: 東京(8-17) と NY(21-翌6, 日跨ぎ)", () => {
    const tokyo: TimeCondition = { conditionId: "t", type: "time", kind: "session", session: "tokyo" };
    expect(evaluateTimeConditionAt(tokyo, utc(2026, 0, 1, 1))).toBe(true); // JST 10:00
    expect(evaluateTimeConditionAt(tokyo, utc(2026, 0, 1, 11))).toBe(false); // JST 20:00

    const ny: TimeCondition = { conditionId: "t", type: "time", kind: "session", session: "newyork" };
    expect(evaluateTimeConditionAt(ny, utc(2026, 0, 1, 14))).toBe(true); // JST 23:00
    expect(evaluateTimeConditionAt(ny, utc(2026, 0, 1, 3))).toBe(false); // JST 12:00
  });
});

describe("isFlattenableGroup", () => {
  it("AND / OR は展開可能", () => {
    expect(isFlattenableGroup({ groupId: "g", operator: "AND", conditions: [] })).toBe(true);
    expect(isFlattenableGroup({ groupId: "g", operator: "OR", conditions: [] })).toBe(true);
  });
  it("NOT / IF_THEN / SEQUENCE は展開不可（従来 UI にフォールバック）", () => {
    expect(isFlattenableGroup({ groupId: "g", operator: "NOT", conditions: [] })).toBe(false);
    expect(isFlattenableGroup({ groupId: "g", operator: "IF_THEN", conditions: [] })).toBe(false);
    expect(isFlattenableGroup({ groupId: "g", operator: "SEQUENCE", conditions: [] })).toBe(false);
  });
});
