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
  canonicalizeCacheKey,
  extractConditionRequirements,
  makeIndicatorCacheKey,
  parseCandlesResponse,
  stableParamsKey,
  toOhlcvPoints,
  type IndicatorSeriesResponse,
} from "@/lib/previewIndicatorSeries";
import type { ChartCandle } from "@/schemas/api/chartCandles";

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

  it("レンズ条件の lensId を収集し重複排除する（レンズ条件タイプ #3）", () => {
    const group: ConditionGroup = {
      groupId: "g1",
      operator: "AND",
      conditions: [
        { conditionId: "l1", type: "lens", lensId: "ind:rsi#p14", featureKey: "rsi_zone", operator: "=", value: "oversold" },
        { conditionId: "l2", type: "lens", lensId: "ind:rsi#p14", featureKey: "rsi_value", operator: "<", value: 0.3 },
        { conditionId: "l3", type: "lens", lensId: "ind:bb#p20", featureKey: "bb_position", operator: "<", value: 0.2 },
      ],
    };
    const { lensIds, specs } = extractConditionRequirements(group);
    expect(lensIds.sort()).toEqual(["ind:bb#p20", "ind:rsi#p14"]);
    // レンズ条件は指標 spec には乗らない（必要系列の解決は backend が行う）
    expect(specs).toHaveLength(0);
  });
});

describe("ローソク足ペイロード (Zod 検証 + 欠損足の扱い)", () => {
  it("parseCandlesResponse: OHLC が null の欠損足を含んでも有効 (欠損は許容)", () => {
    const payload = {
      candles: [
        { time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
        { time: 2, open: null, high: null, low: null, close: null, volume: 0 }, // 休場ギャップ
      ],
    };
    expect(parseCandlesResponse(payload)).not.toBeNull();
  });

  it("parseCandlesResponse: OHLC が文字列/未定義、candles 非配列、null は弾く (型安全)", () => {
    expect(parseCandlesResponse({ candles: [{ time: 1, open: "x", high: 2, low: 1, close: 1 }] })).toBeNull();
    expect(parseCandlesResponse({ candles: [{ open: 1 }] })).toBeNull(); // time 欠落
    expect(parseCandlesResponse({ candles: "x" })).toBeNull();
    expect(parseCandlesResponse(null)).toBeNull();
  });

  it("toOhlcvPoints: 欠損足を除外し、time を ms 化、volume null→0 にする", () => {
    const candles: ChartCandle[] = [
      { time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: null },
      { time: 200, open: null, high: null, low: null, close: null, volume: 0 }, // 除外される
      { time: 300, open: 3, high: 4, low: 2.5, close: 3.5, volume: 7 },
    ];
    const points = toOhlcvPoints(candles);
    expect(points).toHaveLength(2); // null 足は除外
    expect(points[0]).toEqual({ timestamp: 100_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 });
    expect(points[1].timestamp).toBe(300_000);
    expect(points[1].volume).toBe(7);
  });

  it("toOhlcvPoints: time が NaN/Infinity の足も除外する (timestamp 不正回避)", () => {
    const candles: ChartCandle[] = [
      { time: Number.NaN, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 },
      { time: Number.POSITIVE_INFINITY, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 },
      { time: 300, open: 3, high: 4, low: 2.5, close: 3.5, volume: 7 },
    ];
    const points = toOhlcvPoints(candles);
    expect(points).toHaveLength(1);
    expect(points[0].timestamp).toBe(300_000);
  });
});

describe("canonicalizeCacheKey (Python float キー ↔ JS int キーの吸収)", () => {
  it("整数パラメータの float 表記 (14.0) を JS 正規形 (14) に揃える", () => {
    // analysis-engine (Pydantic float) が返すキー → 評価エンジンが引ける JS キーに一致させる
    expect(canonicalizeCacheKey('rsi_{"period":14.0}_value')).toBe(
      makeIndicatorCacheKey("rsi", { period: 14 }, "value"),
    );
    expect(canonicalizeCacheKey('rsi_{"period":14.0}_value')).toBe('rsi_{"period":14}_value');
  });

  it("非整数の float (0.02) はそのまま保持する", () => {
    expect(canonicalizeCacheKey('psar_{"step":0.02}_value')).toBe('psar_{"step":0.02}_value');
  });

  it("id_params_field 形でない不正キーは元キーをそのまま返す (化けさせない)", () => {
    // 区切り `_` が無い / 足りないキーは正規化対象外
    expect(canonicalizeCacheKey("foo")).toBe("foo");
    expect(canonicalizeCacheKey("foo_bar")).toBe("foo_bar");
  });

  it("params JSON がパース不能なら元キーをそのまま返す", () => {
    expect(canonicalizeCacheKey("rsi_notjson_value")).toBe("rsi_notjson_value");
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

  it("Python float キーの series を JS 正規キーで引ける (評価エンジン互換)", () => {
    // analysis-engine が返す実際のキー形式 (period が float 14.0)
    const floatKeyed: IndicatorSeriesResponse = {
      timestamps: response.timestamps,
      series: { 'rsi_{"period":14.0}_value': [10, 20, 30] },
      patterns: {},
    };
    const { indicatorCache } = alignSeriesToCandles(floatKeyed, [BASE, BASE + HOUR, BASE + 2 * HOUR]);
    // 評価エンジンが makeIndicatorCacheKey('rsi',{period:14},'value') で引くキーで取得できる
    const evalKey = makeIndicatorCacheKey("rsi", { period: 14 }, "value");
    expect(indicatorCache.get(evalKey)).toEqual([10, 20, 30]);
  });

  it("lensSeries はキーをそのまま保ち、ローソク足 index に揃える（canonicalize しない）", () => {
    const withLens: IndicatorSeriesResponse = {
      timestamps: response.timestamps,
      series: {},
      patterns: {},
      // lensId は `_` や `#` を含むため、canonicalizeCacheKey を通すとキーが壊れる
      lensSeries: { "lens:ind:ma_cross#ema20xsma75:ma_cross": [null, 1, 0] },
    };
    const { indicatorCache } = alignSeriesToCandles(withLens, candleTs);
    const lens = indicatorCache.get("lens:ind:ma_cross#ema20xsma75:ma_cross");
    expect(lens).toBeDefined();
    expect(Number.isNaN(lens![0])).toBe(true); // null → NaN
    expect(lens![1]).toBe(1);
    expect(lens![2]).toBe(0);
    expect(Number.isNaN(lens![3])).toBe(true); // response に無い bar → NaN
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
