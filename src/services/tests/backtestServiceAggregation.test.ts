/**
 * Critical-9: aggregateBacktestEvents の集計整合性テスト。
 *
 * 旧実装は winCount/lossCount を outcome 軸 ('win'/'loss')、
 * totalProfit/totalLoss を pnl 軸 (>0/<0) で計算しており、
 * 全 trade が outcome='timeout' で pnl 正負が混在すると
 * 「winCount=0 なのに PF が出る」集計矛盾が発生していた。
 * 本テストは pnl 符号統一が永続的に維持されることを担保する。
 */

import { Prisma } from '@prisma/client';
import type { BacktestEvent, BacktestOutcome } from '@prisma/client';

import { aggregateBacktestEvents } from '../backtestService';

type EventOverrides = Partial<Pick<BacktestEvent, 'outcome' | 'pnl'>>;

const baseEvent = (
  index: number,
  overrides: EventOverrides,
): BacktestEvent => ({
  id: `evt-${index}`,
  runId: 'run-1',
  entryTime: new Date(`2026-01-01T0${index % 10}:00:00Z`),
  entryPrice: new Prisma.Decimal(100),
  matchScore: 0.8,
  exitTime: new Date(`2026-01-01T0${index % 10}:30:00Z`),
  exitPrice: new Prisma.Decimal(101),
  outcome: overrides.outcome ?? 'timeout',
  pnl: overrides.pnl ?? new Prisma.Decimal(0),
  createdAt: new Date(),
});

const evt = (
  index: number,
  outcome: BacktestOutcome,
  pnl: number,
): BacktestEvent =>
  baseEvent(index, {
    outcome,
    pnl: new Prisma.Decimal(pnl),
  });

describe('aggregateBacktestEvents (Critical-9)', () => {
  it('全 trade が outcome=timeout でも pnl 符号で winCount/lossCount を集計する', () => {
    // 旧実装: winCount=0 / lossCount=0 / totalProfit=300 / totalLoss=200 / PF=1.5 という矛盾が出ていた。
    // 新実装: pnl 符号で統一し winCount=2 / lossCount=2 / PF=1.5 で整合する。
    const events: BacktestEvent[] = [
      evt(1, 'timeout', 100),
      evt(2, 'timeout', 200),
      evt(3, 'timeout', -120),
      evt(4, 'timeout', -80),
    ];

    const result = aggregateBacktestEvents('run-1', events, 0);

    expect(result.setupCount).toBe(4);
    expect(result.winCount).toBe(2);
    expect(result.lossCount).toBe(2);
    expect(result.timeoutCount).toBe(4);
    expect(result.totalProfit).toBe(300);
    expect(result.totalLoss).toBe(200);
    expect(result.profitFactor).toBeCloseTo(1.5);
    expect(result.winRate).toBeCloseTo(0.5);
  });

  it('TP/SL ヒットと timeout が混在する場合も pnl 符号で集計する', () => {
    const events: BacktestEvent[] = [
      evt(1, 'win', 50),
      evt(2, 'loss', -30),
      evt(3, 'timeout', 20),
      evt(4, 'timeout', -10),
    ];

    const result = aggregateBacktestEvents('run-1', events, 0);

    expect(result.setupCount).toBe(4);
    // pnl > 0 は win + 正 timeout の 2 件、pnl < 0 は loss + 負 timeout の 2 件。
    expect(result.winCount).toBe(2);
    expect(result.lossCount).toBe(2);
    // timeoutCount は outcome='timeout' の参考値として独立軸で残る。
    expect(result.timeoutCount).toBe(2);
    expect(result.totalProfit).toBe(70);
    expect(result.totalLoss).toBe(40);
    expect(result.profitFactor).toBeCloseTo(70 / 40);
  });

  it('events が空の場合は全て 0', () => {
    const result = aggregateBacktestEvents('run-1', [], 0);

    expect(result.setupCount).toBe(0);
    expect(result.winCount).toBe(0);
    expect(result.lossCount).toBe(0);
    expect(result.timeoutCount).toBe(0);
    expect(result.winRate).toBe(0);
    expect(result.totalProfit).toBe(0);
    expect(result.totalLoss).toBe(0);
    expect(result.profitFactor).toBe(0);
  });

  it('全敗の場合 PF=0、winCount=0', () => {
    const events: BacktestEvent[] = [
      evt(1, 'loss', -10),
      evt(2, 'loss', -20),
    ];

    const result = aggregateBacktestEvents('run-1', events, 0);

    expect(result.winCount).toBe(0);
    expect(result.lossCount).toBe(2);
    expect(result.totalProfit).toBe(0);
    expect(result.totalLoss).toBe(30);
    expect(result.profitFactor).toBe(0);
  });

  it('全勝の場合 PF=undefined（Infinity を弾く）', () => {
    const events: BacktestEvent[] = [
      evt(1, 'win', 10),
      evt(2, 'win', 20),
    ];

    const result = aggregateBacktestEvents('run-1', events, 0);

    expect(result.winCount).toBe(2);
    expect(result.lossCount).toBe(0);
    expect(result.totalProfit).toBe(30);
    expect(result.totalLoss).toBe(0);
    // Infinity は finite check で undefined に置換される。
    expect(result.profitFactor).toBeUndefined();
  });
});
