/**
 * MaterializationService の Side-B snapshot 実値化テスト。
 *
 * DB 書き込みではなく、AITradeNote.lensSnapshot から legacy 12D featureVector を
 * 決定論的に派生する純粋部分を検証する。
 */

import { deriveFeatureVectorFromSideBLensSnapshot } from '../../bridge/MaterializationService';
import type { AITradeNote } from '../../models/aiTradeNote';

describe('deriveFeatureVectorFromSideBLensSnapshot', () => {
  it('current_analysis / indicator lens の実値を 12D featureVector に反映する', () => {
    const eventTime = new Date('2026-06-16T14:30:00Z');
    const snapshot: NonNullable<AITradeNote['lensSnapshot']> = {
      timestamp: eventTime.toISOString(),
      features: {
        current_analysis: {
          direction: 'bullish',
          trend_strength: 80,
          momentum: 65,
          volatility_score: 35,
          confidence_pct: 90,
        },
        'ind:rsi#p14': {
          rsi_value: 0.72,
          rsi_zone: 'overbought',
          rsi_divergence: 'none',
        },
        'ind:macd#default': {
          macd_cross: 'bullish',
          macd_hist_slope: 0.4,
        },
        'ind:bb#p20': {
          bb_position: 0.62,
          bb_width_norm: 0.31,
        },
      },
      totalComputeDurationMs: 8,
    };

    const vector = deriveFeatureVectorFromSideBLensSnapshot(snapshot, 'long', eventTime);

    expect(vector).toHaveLength(12);
    expect(vector).not.toEqual(Array<number>(12).fill(0.5));
    expect(vector[0]).toBe(1);
    expect(vector[1]).toBe(0.8);
    expect(vector[3]).toBe(0.4);
    expect(vector[4]).toBe(1);
    expect(vector[5]).toBe(0.72);
    expect(vector[6]).toBe(1);
    expect(vector[7]).toBe(0.62);
    expect(vector[8]).toBe(0.31);
    expect(vector[10]).toBe(1);
    expect(vector[11]).toBe(0.8);
  });

  it('snapshot が無い場合は仮値を作らず明示エラーにする', () => {
    expect(() =>
      deriveFeatureVectorFromSideBLensSnapshot(undefined, 'short', new Date('2026-06-16T14:30:00Z'))
    ).toThrow('Side-B materialize には featureVector または lensSnapshot が必要です');
  });
});
