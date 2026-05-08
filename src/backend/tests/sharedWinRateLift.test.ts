/**
 * Win Rate Lift helper の単体テスト (Filter Evolution M2)。
 *
 * TS 版 (`src/shared/statistics/winRateLift.ts`) と Python 版
 * (`analysis-engine/app/statistics/win_rate_lift.py`) で同じ式が実装されていることを
 * pin する。subset 判定 / safety guard / Lift 計算の各経路をカバーする。
 *
 * 設計書: `docs/design/phase_filter_evolution_specification.md`
 */

import {
  computeWinRateLift,
  type WinRateLiftTrade,
} from '../../shared/statistics/winRateLift';

function makeTrade(
  entryTime: string,
  outcome: 'win' | 'loss' | 'timeout',
): WinRateLiftTrade {
  return { entryTime, outcome };
}

function makeTrades(
  spec: ReadonlyArray<['win' | 'loss' | 'timeout', number]>,
): WinRateLiftTrade[] {
  // [['win', 5], ['loss', 5]] → 5 勝 5 敗 (= 異なる entryTime)
  const out: WinRateLiftTrade[] = [];
  let counter = 0;
  for (const [outcome, count] of spec) {
    for (let i = 0; i < count; i++) {
      out.push(makeTrade(`2026-01-01T00:00:${counter.toString().padStart(2, '0')}.000Z`, outcome));
      counter++;
    }
  }
  return out;
}

describe('computeWinRateLift', () => {
  describe('notComputable cases', () => {
    it('parent has no trades → notComputable, lift=1.0', () => {
      const r = computeWinRateLift({ parentTrades: [], childTrades: [] });
      expect(r.lift).toBe(1.0);
      expect(r.notComputable).toBe('parent has no trades');
    });

    it('parent has zero win rate (= 全 loss) → notComputable', () => {
      const parent = makeTrades([['loss', 10]]);
      // child は parent の subset である必要があるため、parent 内から先頭 5 件抽出
      const childSubset = parent.slice(0, 5);
      const r = computeWinRateLift({ parentTrades: parent, childTrades: childSubset });
      expect(r.lift).toBe(1.0);
      expect(r.notComputable).toBe('parent has zero win rate');
    });

    it('child has no trades (= filter rejected all) → notComputable', () => {
      const parent = makeTrades([['win', 10], ['loss', 10]]);
      const r = computeWinRateLift({ parentTrades: parent, childTrades: [] });
      expect(r.lift).toBe(1.0);
      expect(r.notComputable).toContain('child has no trades');
    });

    it('child not strict subset (= 異なる entryTime あり) → notComputable', () => {
      const parent = makeTrades([['win', 10], ['loss', 10]]);
      const child: WinRateLiftTrade[] = [
        makeTrade('2026-99-99T00:00:00.000Z', 'win'), // parent に存在しない entryTime
      ];
      const r = computeWinRateLift({ parentTrades: parent, childTrades: child });
      expect(r.lift).toBe(1.0);
      expect(r.notComputable).toContain('not a strict subset');
    });
  });

  describe('safety guards', () => {
    it('child wins < 70% of parent wins → safety guard、lift=1.0', () => {
      // parent: 20 win + 20 loss、child: 10 win + 10 loss (= 50% of wins)
      const parent = makeTrades([['win', 20], ['loss', 20]]);
      const child = [...parent.slice(0, 10), ...parent.slice(20, 30)]; // win 10 + loss 10
      const r = computeWinRateLift({ parentTrades: parent, childTrades: child });
      expect(r.lift).toBe(1.0);
      expect(r.notComputable).toContain('safety guard: child wins');
    });

    it('child trades < 30% of parent trades (= ratio guard) → safety guard', () => {
      // 比率 guard を独立に発火させるため wins guard を先に通す:
      // parent: 25 win + 75 loss = 100, child: 18 win + 0 loss = 18
      // - wins: 18 >= 0.7 * 25 = 17.5 ✓ (= wins guard 通過)
      // - trades: 18 < max(20, 0.3 * 100) = 30 → trades guard 発火
      const parent = makeTrades([['win', 25], ['loss', 75]]);
      const child = parent.slice(0, 18);
      const r = computeWinRateLift({ parentTrades: parent, childTrades: child });
      expect(r.lift).toBe(1.0);
      expect(r.notComputable).toContain('safety guard: child trades');
    });

    it('child trades just below 20 absolute → safety guard', () => {
      // parent total を小さくして absolute guard 単独の発火を狙う:
      // parent: 25 win + 25 loss = 50, child: 18 win + 0 loss = 18
      // - wins: 18 >= 0.7 * 25 = 17.5 ✓
      // - trades: 18 < max(20, 0.3 * 50) = max(20, 15) = 20 → absolute guard 発火
      const parent = makeTrades([['win', 25], ['loss', 25]]);
      const child = parent.slice(0, 18);
      const r = computeWinRateLift({ parentTrades: parent, childTrades: child });
      expect(r.lift).toBe(1.0);
      expect(r.notComputable).toContain('safety guard: child trades');
    });
  });

  describe('valid lift computation', () => {
    it('完璧な filter (= 負けだけ除去、勝ち全保持) → lift > 1.0', () => {
      // parent: 30 win + 30 loss = 60 trades、winRate = 0.5
      // child: 30 win + 0 loss = 30 trades、winRate = 1.0
      // lift = 1.0 / 0.5 = 2.0
      const parent = makeTrades([['win', 30], ['loss', 30]]);
      const child = parent.slice(0, 30); // 全勝部分のみ
      const r = computeWinRateLift({ parentTrades: parent, childTrades: child });
      expect(r.notComputable).toBeNull();
      expect(r.lift).toBeCloseTo(2.0, 6);
      expect(r.parentWinRate).toBeCloseTo(0.5, 6);
      expect(r.childWinRate).toBeCloseTo(1.0, 6);
      expect(r.preserveWin).toBeCloseTo(1.0, 6);
      expect(r.specificity).toBeCloseTo(1.0, 6);
      expect(r.filterPrecision).toBeCloseTo(1.0, 6);
    });

    it('部分的 filter (= 負けの半分 + 勝ちの少し除去) → lift > 1.0 だが完璧ではない', () => {
      // parent: 40 win + 40 loss、winRate = 0.5
      // child: 35 win + 20 loss = 55 trades、winRate = 35/55 ≈ 0.636
      // lift = 0.636 / 0.5 ≈ 1.273
      const parent = makeTrades([['win', 40], ['loss', 40]]);
      const child = [...parent.slice(0, 35), ...parent.slice(40, 60)];
      const r = computeWinRateLift({ parentTrades: parent, childTrades: child });
      expect(r.notComputable).toBeNull();
      expect(r.lift).toBeGreaterThan(1.0);
      expect(r.lift).toBeLessThan(2.0);
      expect(r.parentWinRate).toBeCloseTo(0.5, 6);
      expect(r.preserveWin).toBeCloseTo(35 / 40, 6);
      expect(r.specificity).toBeCloseTo(20 / 40, 6);
    });

    it('ランダム除去 (= 比率変えず + wins guard を通る) → lift ≈ 1.0', () => {
      // parent: 30 win + 30 loss = 60、winRate = 0.5
      // child: 21 win + 21 loss = 42、winRate = 0.5
      // - wins: 21 >= 0.7 * 30 = 21 ✓
      // - trades: 42 >= max(20, 0.3 * 60) = 20 ✓
      // lift = 0.5 / 0.5 = 1.0
      const parent = makeTrades([['win', 30], ['loss', 30]]);
      const child = [...parent.slice(0, 21), ...parent.slice(30, 51)];
      const r = computeWinRateLift({ parentTrades: parent, childTrades: child });
      expect(r.notComputable).toBeNull();
      expect(r.lift).toBeCloseTo(1.0, 6);
    });

    it('timeout は total に含まれるが win/loss にはカウントされない', () => {
      // parent: 30 win + 30 loss + 30 timeout = 90 trades、winRate = 30/90 ≈ 0.333
      // child: 30 win + 0 loss + 30 timeout = 60 trades、winRate = 30/60 = 0.5
      // lift = 0.5 / 0.333 = 1.5
      const parent = makeTrades([
        ['win', 30],
        ['loss', 30],
        ['timeout', 30],
      ]);
      const child = [...parent.slice(0, 30), ...parent.slice(60, 90)];
      const r = computeWinRateLift({ parentTrades: parent, childTrades: child });
      expect(r.notComputable).toBeNull();
      expect(r.lift).toBeCloseTo(1.5, 6);
      expect(r.parentTradeCount).toBe(90);
      expect(r.childTradeCount).toBe(60);
    });
  });

  describe('safetyGuards 設定の上書き', () => {
    it('カスタム minWinPreservationRatio で 90% 要求にすると 0.85 では弾かれる', () => {
      const parent = makeTrades([['win', 20], ['loss', 20]]);
      const child = [...parent.slice(0, 17), ...parent.slice(20, 30)]; // win 17 = 85%
      const r = computeWinRateLift({
        parentTrades: parent,
        childTrades: child,
        safetyGuards: { minWinPreservationRatio: 0.9 },
      });
      expect(r.lift).toBe(1.0);
      expect(r.notComputable).toContain('safety guard: child wins');
    });

    it('カスタム minAbsoluteTradeCount=10 にすると child=15 でも guard を通過', () => {
      // parent: 50 win + 50 loss、child: 15 win + 0 loss = 15 trades
      // 既定 guard では弾かれるが、minAbsoluteTradeCount=10 にすれば通る
      // ただし minTradeCountRatio=0.3 (= 30) も適用されるため、その方で弾かれる
      const parent = makeTrades([['win', 50], ['loss', 50]]);
      const child = parent.slice(0, 15);
      const r = computeWinRateLift({
        parentTrades: parent,
        childTrades: child,
        safetyGuards: { minAbsoluteTradeCount: 10, minTradeCountRatio: 0.1 },
      });
      // minTradeCountRatio=0.1 → 100*0.1 = 10、minAbsoluteTradeCount=10、max(10, 10)=10
      // child = 15 > 10、通過するが、min_win_preservation_ratio=0.7 default で
      // 15 win >= 0.7*50=35 を満たさず弾かれる (= 別の guard で弾かれる)
      // 15 < 35 → safety guard で弾かれる
      expect(r.lift).toBe(1.0);
      expect(r.notComputable).toContain('safety guard');
    });
  });
});
