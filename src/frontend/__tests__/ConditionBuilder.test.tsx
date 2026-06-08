/**
 * ConditionBuilder の操作テスト（接合点ごとの AND/OR）。
 *
 * 実コンポーネントを controlled な harness で包み、実際のクリック/セレクト操作を通して
 * 「親に渡るツリー（onChange の結果）」が正しく正規化されるかを固定する。
 *
 * 重点（Neko さんの指摘そのもの）:
 *  - 条件を増やしても接合点が一括変更されず、接合点ごとに独立して AND/OR を選べる
 *  - `A かつ B または C` が `(A かつ B) または C`（AND を内・OR を外）に正規化される
 *  - 高度モード（SEQUENCE 等）へ切替・復帰できる
 */

import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import ConditionBuilder from "@/components/strategy/ConditionBuilder";
import {
  createDefaultConditionGroup,
  isConditionGroup,
  type ConditionGroup,
} from "@/types/strategy";
import type { IndicatorMetadata } from "@/types/indicator";

// 表示に必要な最小メタデータ（id / displayName / defaultParams のみ実利用）
const META = [
  { id: "rsi", displayName: "RSI", category: "momentum", description: "", defaultParams: { period: 14 }, paramConstraints: {} },
  { id: "ema", displayName: "EMA", category: "trend", description: "", defaultParams: { period: 20 }, paramConstraints: {} },
] as IndicatorMetadata[];

const JUNCTION_TITLE = "この接合点の論理条件（かつ / または）";

// 親の state を持つ harness。現在のツリーを JSON で露出して検証に使う。
function Harness({ initial }: { initial?: ConditionGroup }) {
  const [group, setGroup] = useState<ConditionGroup>(initial ?? createDefaultConditionGroup());
  return (
    <div>
      <div data-testid="json">{JSON.stringify(group)}</div>
      <ConditionBuilder value={group} onChange={setGroup} indicatorMetadata={META} />
    </div>
  );
}

function currentGroup(): ConditionGroup {
  return JSON.parse(screen.getByTestId("json").textContent || "{}") as ConditionGroup;
}

describe("ConditionBuilder（接合点ごとの AND/OR）", () => {
  it("デフォルトは条件1件・接合点なしで描画され、クラッシュしない", () => {
    render(<Harness />);
    expect(screen.queryAllByTitle(JUNCTION_TITLE)).toHaveLength(0);
    expect(currentGroup().conditions).toHaveLength(1);
  });

  it("条件を追加すると接合点が1つ現れ、デフォルトは AND", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("条件を追加"));

    const junctions = screen.getAllByTitle(JUNCTION_TITLE) as HTMLSelectElement[];
    expect(junctions).toHaveLength(1);
    expect(junctions[0].value).toBe("AND");

    const g = currentGroup();
    expect(g.operator).toBe("AND");
    expect(g.conditions).toHaveLength(2);
  });

  it("接合点を OR にすると OR グループへ正規化される（一括変更されない）", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("条件を追加"));

    const junction = screen.getAllByTitle(JUNCTION_TITLE)[0] as HTMLSelectElement;
    fireEvent.change(junction, { target: { value: "OR" } });

    const g = currentGroup();
    expect(g.operator).toBe("OR");
    expect(g.conditions).toHaveLength(2); // 2 アーム

    // AND へ戻す
    const junctionAfter = screen.getAllByTitle(JUNCTION_TITLE)[0] as HTMLSelectElement;
    fireEvent.change(junctionAfter, { target: { value: "AND" } });
    expect(currentGroup().operator).toBe("AND");
  });

  it("`A かつ B または C` が `(A かつ B) または C` に正規化される", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("条件を追加"));
    fireEvent.click(screen.getByText("条件を追加")); // 3件

    // 接合点は [AND, AND]。2つ目（B-C 間）を OR にする
    const junctions = screen.getAllByTitle(JUNCTION_TITLE) as HTMLSelectElement[];
    expect(junctions).toHaveLength(2);
    fireEvent.change(junctions[1], { target: { value: "OR" } });

    const g = currentGroup();
    expect(g.operator).toBe("OR");
    expect(g.conditions).toHaveLength(2);
    // アーム1 = AND グループ(2件), アーム2 = リーフ
    const [arm1, arm2] = g.conditions;
    expect(isConditionGroup(arm1)).toBe(true);
    expect((arm1 as ConditionGroup).operator).toBe("AND");
    expect((arm1 as ConditionGroup).conditions).toHaveLength(2);
    expect(isConditionGroup(arm2)).toBe(false);

    // AND ラン（2件）が枠で強調されている（青枠）
    const orJunction = screen.getAllByTitle(JUNCTION_TITLE).find((s) => (s as HTMLSelectElement).value === "OR");
    expect(orJunction).toBeTruthy();
  });

  it("高度モード（SEQUENCE）へ切替・復帰できる", () => {
    render(<Harness />);
    const modeSelect = screen.getByDisplayValue("AND / OR を個別に指定（推奨）") as HTMLSelectElement;
    fireEvent.change(modeSelect, { target: { value: "SEQUENCE" } });
    expect(currentGroup().operator).toBe("SEQUENCE");

    // 通常へ復帰（operator は AND に寄る）
    const modeSelect2 = screen.getByDisplayValue(/順序/) as HTMLSelectElement;
    fireEvent.change(modeSelect2, { target: { value: "MIXED" } });
    expect(currentGroup().operator).toBe("AND");
  });

  it("条件を削除すると接合点も連動して減る", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("条件を追加")); // 2件・接合点1
    expect(screen.getAllByTitle(JUNCTION_TITLE)).toHaveLength(1);

    // 1件目を削除（削除ボタンの title="条件を削除"）
    const removeButtons = screen.getAllByTitle("条件を削除");
    fireEvent.click(removeButtons[0]);

    expect(currentGroup().conditions).toHaveLength(1);
    expect(screen.queryAllByTitle(JUNCTION_TITLE)).toHaveLength(0);
  });
});
