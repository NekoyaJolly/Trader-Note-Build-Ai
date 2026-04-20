/**
 * Skill: compute_lens_features (Phase 5.5)
 *
 * 指定シンボル・時間枠のレンズ特徴量スナップショットを計算する。
 * LensAggregator.computeAll() のラッパー。
 *
 * 入力設計:
 * - symbol, timeframe: 必須
 * - timestamp: オプショナル。省略時は現在時刻(リアルタイム計算)
 * - lenses: オプショナル。指定時はそのレンズのみ出力に含める
 *   (決定性維持のため全レンズは計算される)
 *
 * 備考:
 * - OHLCV バーは MarketDataService 経由で取得(ライブ/直近バー)
 * - 過去時点計算は現状「過去時点の timestamp を指定しつつ直近バーで計算」という
 *   簡易実装。真の時間巻き戻しは将来拡張(履歴 OHLCV 取得経路の整備が必要)
 */

import { z } from 'zod';
import type { Skill } from '../types';
import {
  defaultLensAggregator,
  registerDefaultLenses,
  serializeLensSnapshot,
  type LensFeatureSnapshot,
  type SerializedLensFeatureSnapshot,
} from '../../lenses';
import type { OHLCVBar } from '../../lenses/utils/pivotDetection';
import { MarketDataService } from '../../../services/marketDataService';
import type { MarketData } from '../../../models/types';

const DEFAULT_BAR_COUNT = 200;

const InputSchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  timestamp: z.string().datetime().optional(),
  lenses: z.array(z.string()).optional(),
  barCount: z.number().int().min(20).max(500).optional(),
});

export type ComputeLensFeaturesInput = z.infer<typeof InputSchema>;
export type ComputeLensFeaturesOutput = SerializedLensFeatureSnapshot;

/** OHLCV 取得関数の依存注入(テストで差し替え可)。 */
export interface ComputeLensFeaturesDeps {
  fetchOhlcv?: (symbol: string, timeframe: string, limit: number) => Promise<MarketData[]>;
}

function toOhlcvBar(d: MarketData): OHLCVBar {
  return {
    timestamp: d.timestamp,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volume,
  };
}

function filterSnapshot(
  snapshot: LensFeatureSnapshot,
  onlyLenses?: readonly string[],
): LensFeatureSnapshot {
  if (!onlyLenses || onlyLenses.length === 0) {
    return snapshot;
  }
  const allowed = new Set(onlyLenses);
  const filtered = new Map<string, LensFeatureSnapshot['features'] extends Map<string, infer V> ? V : never>();
  for (const [name, feature] of snapshot.features) {
    if (allowed.has(name)) filtered.set(name, feature);
  }
  return {
    ...snapshot,
    features: filtered,
  };
}

export function createComputeLensFeaturesSkill(
  deps: ComputeLensFeaturesDeps = {},
): Skill<ComputeLensFeaturesInput, ComputeLensFeaturesOutput> {
  const fetchOhlcv = deps.fetchOhlcv ?? (async (symbol, timeframe, limit) => {
    const market = new MarketDataService();
    return market.getHistoricalData(symbol, timeframe, limit);
  });

  return {
    name: 'compute_lens_features',
    description: [
      '指定シンボル・時間枠のレンズ特徴量スナップショットを計算する。',
      'timestamp 省略時はリアルタイム、指定時は当該時刻を as-of として直近バーで計算。',
      'lenses を指定するとそのレンズのみ出力に含める。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: '銘柄シンボル(例: XAUUSD)' },
        timeframe: { type: 'string', description: '時間枠(例: 15m, 1h)' },
        timestamp: {
          type: 'string',
          description: 'as-of 時刻(ISO 8601)。省略時は現在時刻',
        },
        lenses: {
          type: 'array',
          items: { type: 'string' },
          description: '出力に含めるレンズ名の絞り込み(省略時は全レンズ)',
        },
        barCount: {
          type: 'number',
          description: '計算に使う OHLCV バー数。既定 200、範囲 20-500',
        },
      },
      required: ['symbol', 'timeframe'],
    },
    async execute(raw) {
      const input = InputSchema.parse(raw);
      registerDefaultLenses();

      const barCount = input.barCount ?? DEFAULT_BAR_COUNT;
      const ohlcvData = await fetchOhlcv(input.symbol, input.timeframe, barCount);
      const ohlcvBars = ohlcvData.map(toOhlcvBar);

      const snapshot = await defaultLensAggregator.computeAll({
        symbol: input.symbol,
        timeframe: input.timeframe,
        timestamp: input.timestamp ? new Date(input.timestamp) : new Date(),
        ohlcvBars,
      });

      const filtered = filterSnapshot(snapshot, input.lenses);
      return serializeLensSnapshot(filtered);
    },
  };
}
