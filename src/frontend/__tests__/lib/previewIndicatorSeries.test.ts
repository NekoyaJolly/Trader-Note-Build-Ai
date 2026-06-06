/**
 * /strategies/new プレビュー: analysis-engine 系列の抽出・整列・オーバーレイ構築のユニットテスト。
 *
 * 重点: 評価エンジンは「ローソク足と同じ index」で系列を引くため、本数や粒度がズレても
 * timestamp で正しく整列することを固定する (位置 index の取り違えは成立判定を壊すため)。
 */

import { describe, it, expect } from "vitest";
import type { ConditionGroup } from "@/types/strategy";
import {
  alignSeriesToCandles,
  buildPreviewIndicatorLines,
  extractConditionRequirements,
  makeIndicatorCacheKey,
  stableParamsKey,
  type IndicatorSeriesResponse,
} from "@/lib/previewIndicatorSeries";

const BASE = Date.parse("2026-01-01T00:00:00.000Z");
const HOUR = 3_600_000;

describe("makeIndicatorCacheKey / stableParamsKey", () => {
  it("params はキー順非依存で同一キーになる (Python sort_keys と整合)", () => {
    expect(stableParamsKey({ slow: 26, fast: 12 })).toBe('{"fast":12,"slow":26}');
    expect(makeIndicatorCacheKey("RSI", { period: 14 }, "value")).toBe('rsi_{"period":14}_value');
  });
});

describe("extractConditionRequirements", () => {
  it("左辺指標・右辺indicatorターゲット・パターンを収集し重複排除する", () => {
    const group: ConditionGroup = {
      groupId: "g1",
      operator: "AND",
      conditions: [
        {
          conditionId: "c1",
          indicatorId: "rsi",
          params: { period: 14 },
          field: "value",
          operator: "<",
          compareTarget: { type: "fixed", value: 30 },
        },
        {
          conditionId: "c2",
          indicatorId: "ema",
          params: { period: 20 },
          field: "value",
          operator: "cross_above",
          compareTarget: { type: "indicator", indicatorId: "sma", params: { period: 50 }, field: "value" },
        },
        { conditionId: "c3", type: "pattern", patternId: "hammer", operator: "is_true" },
      ],
    };

    const { specs, patternIds } = extractConditionRequirements(group);
    const ids = specs.map((s) => s.indicatorId).sort();
    expect(ids).toEqual(["ema", "rsi", "sma"]);
    expect(patternIds).toEqual(["hammer"]);
  });

  it("同一指標・同一paramsの重複条件は1つにまとまる", () => {
    const group: ConditionGroup = {
      groupId: "g1",
      operator: "OR",
      conditions: [
        { conditionId: "a", indicatorId: "rsi", params: { period: 14 }, field: "value", operator: "<", compareTarget: { type: "fixed", value: 30 } },
        { conditionId: "b", indicatorId: "rsi", params: { period: 14 }, field: "value", operator: ">", compareTarget: { type: "fixed", value: 70 } },
      ],
    };
    expect(extractConditionRequirements(group).specs).toHaveLength(1);
  });
});

describe("alignSeriesToCandles", () => {
  const response: IndicatorSeriesResponse = {
    timestamps: [
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T01:00:00.000Z",
      "2026-01-01T02:00:00.000Z",
    ],
    series: { 'rsi_{"period":14}_value': [null, 40, 55] },
    patterns: { hammer: [false, true, false] },
  };
  // ローソク足は response より 1 本多い (hour3 は response に無い)
  const candleTs = [BASE, BASE + HOUR, BASE + 2 * HOUR, BASE + 3 * HOUR];

  it("series を ローソク足 index に揃え、null と欠損は NaN にする", () => {
    const { indicatorCache } = alignSeriesToCandles(response, candleTs);
    const rsi = indicatorCache.get('rsi_{"period":14}_value');
    expect(rsi).toBeDefined();
    expect(Number.isNaN(rsi![0])).toBe(true); // null → NaN
    expect(rsi![1]).toBe(40);
    expect(rsi![2]).toBe(55);
    expect(Number.isNaN(rsi![3])).toBe(true); // response に無い bar → NaN
    expect(rsi).toHaveLength(candleTs.length);
  });

  it("pattern を ローソク足 index に揃え、欠損は false にする", () => {
    const { patternCache } = alignSeriesToCandles(response, candleTs);
    expect(patternCache.get("hammer")).toEqual([false, true, false, false]);
  });

  it("ローソク足の順序が基準。response の余分な timestamp は無視する", () => {
    // response に hour3 を足し、candles は hour0..2 のみ → hour3 は出力に現れない
    const withExtra: IndicatorSeriesResponse = {
      timestamps: [...response.timestamps, "2026-01-01T03:00:00.000Z"],
      series: { 'rsi_{"period":14}_value': [10, 20, 30, 99] },
      patterns: {},
    };
    const { indicatorCache } = alignSeriesToCandles(withExtra, [BASE, BASE + HOUR, BASE + 2 * HOUR]);
    expect(indicatorCache.get('rsi_{"period":14}_value')).toEqual([10, 20, 30]);
  });
});

describe("buildPreviewIndicatorLines", () => {
  const ts = [BASE, BASE + HOUR, BASE + 2 * HOUR];
  const cache = new Map<string, number[]>([
    ['sma_{"period":20}_value', [1, 2, 3]],
    ['rsi_{"period":14}_value', [Number.NaN, 40, 55]],
    ['macd_{"fast":12,"signal":9,"slow":26}_histogram', [0.1, -0.2, 0.3]],
    ['ema_{"period":5}_value', [Number.NaN, Number.NaN, Number.NaN]],
  ]);
  const lines = buildPreviewIndicatorLines(cache, ts);

  it("価格系はメインペイン、オシレーター系はサブペイン (indicatorId 単位)", () => {
    expect(lines.find((l) => l.id.startsWith("sma"))?.pane).toBe("main");
    const rsi = lines.find((l) => l.id.startsWith("rsi"));
    expect(rsi?.pane).toBe("sub");
    expect(rsi?.paneGroup).toBe("rsi");
    expect(rsi?.scaleRange).toEqual({ min: 0, max: 100 });
  });

  it("histogram フィールドは histogram シリーズになる", () => {
    expect(lines.find((l) => l.id.startsWith("macd"))?.seriesType).toBe("histogram");
  });

  it("NaN を除いた点のみ描画し、全 NaN の系列はスキップする", () => {
    expect(lines.find((l) => l.id.startsWith("rsi"))?.data).toHaveLength(2); // index0 の NaN を除外
    expect(lines.find((l) => l.id.startsWith("ema"))).toBeUndefined(); // 全 NaN → スキップ
  });
});
