/**
 * ストラテジーバックテストサービス テスト
 * 
 * テスト内容:
 * - 損益計算（calculatePnl）
 * - パフォーマンスサマリー計算（calculateSummary）
 * - 空サマリー生成（createEmptySummary）
 * 
 * 注意: evaluateCondition / evaluateConditionGroup は非同期でインジケーター計算を行うため、
 * 別途インジケーター計算をモックした統合テストで検証する
 */

import {
  calculatePnl,
  calculateSummary,
  createEmptySummary,
  BacktestTradeEvent,
} from '../services/backtestCalculations';

// ============================================
// calculatePnl テスト
// ============================================

describe('calculatePnl', () => {
  test('買いトレードで利益が出る場合', () => {
    // 100で買い、110で決済 → 利益10
    const pnl = calculatePnl('buy', 100, 110, 1);
    expect(pnl).toBe(10);
  });

  test('買いトレードで損失が出る場合', () => {
    // 100で買い、95で決済 → 損失5
    const pnl = calculatePnl('buy', 100, 95, 1);
    expect(pnl).toBe(-5);
  });

  test('売りトレードで利益が出る場合', () => {
    // 100で売り、90で決済 → 利益10
    const pnl = calculatePnl('sell', 100, 90, 1);
    expect(pnl).toBe(10);
  });

  test('売りトレードで損失が出る場合', () => {
    // 100で売り、105で決済 → 損失5
    const pnl = calculatePnl('sell', 100, 105, 1);
    expect(pnl).toBe(-5);
  });

  test('ポジションサイズが反映される', () => {
    // 100で買い、110で決済、ポジションサイズ2 → 利益20
    const pnl = calculatePnl('buy', 100, 110, 2);
    expect(pnl).toBe(20);
  });

  test('小数点価格でも正確に計算される', () => {
    // 150.50で買い、151.25で決済、ポジションサイズ1000 → 利益750
    const pnl = calculatePnl('buy', 150.50, 151.25, 1000);
    expect(pnl).toBeCloseTo(750, 2);
  });
});

// ============================================
// calculateSummary テスト
// ============================================

describe('calculateSummary', () => {
  test('トレードがない場合は空サマリーを返す', () => {
    const summary = calculateSummary([], 1000000);
    expect(summary.totalTrades).toBe(0);
    expect(summary.winRate).toBe(0);
    expect(summary.netProfit).toBe(0);
  });

  test('勝ちトレードのみの場合', () => {
    const trades: BacktestTradeEvent[] = [
      {
        eventId: 'e1',
        entryTime: '2024-01-01T00:00:00Z',
        entryPrice: 100,
        exitTime: '2024-01-01T01:00:00Z',
        exitPrice: 110,
        side: 'buy',
        positionSize: 1,
        pnl: 10,
        pnlPercent: 0.1,
        exitReason: 'take_profit',
      },
      {
        eventId: 'e2',
        entryTime: '2024-01-01T02:00:00Z',
        entryPrice: 110,
        exitTime: '2024-01-01T03:00:00Z',
        exitPrice: 120,
        side: 'buy',
        positionSize: 1,
        pnl: 10,
        pnlPercent: 0.091,
        exitReason: 'take_profit',
      },
    ];

    const summary = calculateSummary(trades, 1000000);
    
    // 基本カウント
    expect(summary.totalTrades).toBe(2);
    expect(summary.winningTrades).toBe(2);
    expect(summary.losingTrades).toBe(0);
    
    // 勝率100%（0〜1の小数値、フロントエンドで*100して%表示）
    expect(summary.winRate).toBe(1);
    
    // 純利益
    expect(summary.netProfit).toBe(20);
    
    // 平均勝ち（負けがないので平均損失は0）
    expect(summary.averageWin).toBe(10);
    expect(summary.averageLoss).toBe(0);
    
    // 連勝（全勝なので2）
    expect(summary.maxConsecutiveWins).toBe(2);
    expect(summary.maxConsecutiveLosses).toBe(0);
  });

  test('負けトレードのみの場合', () => {
    const trades: BacktestTradeEvent[] = [
      {
        eventId: 'e1',
        entryTime: '2024-01-01T00:00:00Z',
        entryPrice: 100,
        exitTime: '2024-01-01T01:00:00Z',
        exitPrice: 95,
        side: 'buy',
        positionSize: 1,
        pnl: -5,
        pnlPercent: -0.05,
        exitReason: 'stop_loss',
      },
      {
        eventId: 'e2',
        entryTime: '2024-01-01T02:00:00Z',
        entryPrice: 95,
        exitTime: '2024-01-01T03:00:00Z',
        exitPrice: 88,
        side: 'buy',
        positionSize: 1,
        pnl: -7,
        pnlPercent: -0.074,
        exitReason: 'stop_loss',
      },
    ];

    const summary = calculateSummary(trades, 1000000);
    
    expect(summary.totalTrades).toBe(2);
    expect(summary.winningTrades).toBe(0);
    expect(summary.losingTrades).toBe(2);
    expect(summary.winRate).toBe(0);
    expect(summary.netProfit).toBe(-12);
    expect(summary.profitFactor).toBe(0);
    expect(summary.maxConsecutiveWins).toBe(0);
    expect(summary.maxConsecutiveLosses).toBe(2);
  });

  test('勝ち負け混在の場合', () => {
    const trades: BacktestTradeEvent[] = [
      {
        eventId: 'e1',
        entryTime: '2024-01-01T00:00:00Z',
        entryPrice: 100,
        exitTime: '2024-01-01T01:00:00Z',
        exitPrice: 120,
        side: 'buy',
        positionSize: 1,
        pnl: 20,
        pnlPercent: 0.2,
        exitReason: 'take_profit',
      },
      {
        eventId: 'e2',
        entryTime: '2024-01-01T02:00:00Z',
        entryPrice: 120,
        exitTime: '2024-01-01T03:00:00Z',
        exitPrice: 110,
        side: 'buy',
        positionSize: 1,
        pnl: -10,
        pnlPercent: -0.083,
        exitReason: 'stop_loss',
      },
      {
        eventId: 'e3',
        entryTime: '2024-01-01T04:00:00Z',
        entryPrice: 110,
        exitTime: '2024-01-01T05:00:00Z',
        exitPrice: 115,
        side: 'buy',
        positionSize: 1,
        pnl: 5,
        pnlPercent: 0.045,
        exitReason: 'take_profit',
      },
    ];

    const summary = calculateSummary(trades, 1000000);
    
    // 基本カウント
    expect(summary.totalTrades).toBe(3);
    expect(summary.winningTrades).toBe(2);
    expect(summary.losingTrades).toBe(1);
    
    // 勝率 2/3 ≈ 0.667（0〜1の小数値）
    expect(summary.winRate).toBeCloseTo(0.6667, 3);
    
    // 純利益: 20 - 10 + 5 = 15
    expect(summary.netProfit).toBe(15);
    
    // プロフィットファクター: 総利益25 / 総損失10 = 2.5
    expect(summary.profitFactor).toBe(2.5);
    
    // 平均勝ち: (20 + 5) / 2 = 12.5
    expect(summary.averageWin).toBe(12.5);
    
    // 平均損失: 10（絶対値として返される）
    expect(summary.averageLoss).toBe(10);
    
    // リスクリワード比: 12.5 / 10 = 1.25
    expect(summary.riskRewardRatio).toBeCloseTo(1.25, 2);
  });

  test('連勝・連敗のカウント', () => {
    const trades: BacktestTradeEvent[] = [
      // 3連勝
      { eventId: 'e1', entryTime: '', entryPrice: 100, exitTime: '', exitPrice: 110, side: 'buy', positionSize: 1, pnl: 10, pnlPercent: 0.1, exitReason: 'take_profit' },
      { eventId: 'e2', entryTime: '', entryPrice: 100, exitTime: '', exitPrice: 110, side: 'buy', positionSize: 1, pnl: 10, pnlPercent: 0.1, exitReason: 'take_profit' },
      { eventId: 'e3', entryTime: '', entryPrice: 100, exitTime: '', exitPrice: 110, side: 'buy', positionSize: 1, pnl: 10, pnlPercent: 0.1, exitReason: 'take_profit' },
      // 2連敗
      { eventId: 'e4', entryTime: '', entryPrice: 100, exitTime: '', exitPrice: 90, side: 'buy', positionSize: 1, pnl: -10, pnlPercent: -0.1, exitReason: 'stop_loss' },
      { eventId: 'e5', entryTime: '', entryPrice: 100, exitTime: '', exitPrice: 90, side: 'buy', positionSize: 1, pnl: -10, pnlPercent: -0.1, exitReason: 'stop_loss' },
      // 1勝
      { eventId: 'e6', entryTime: '', entryPrice: 100, exitTime: '', exitPrice: 110, side: 'buy', positionSize: 1, pnl: 10, pnlPercent: 0.1, exitReason: 'take_profit' },
    ];

    const summary = calculateSummary(trades, 1000000);
    expect(summary.maxConsecutiveWins).toBe(3);
    expect(summary.maxConsecutiveLosses).toBe(2);
  });

  test('ドローダウン計算', () => {
    // 資金推移: 1000 -> 1050 -> 1025 -> 1100 -> 1000
    // 最大ドローダウン: 1100 -> 1000 = 100 (9.09%)
    const trades: BacktestTradeEvent[] = [
      { eventId: 'e1', entryTime: '', entryPrice: 100, exitTime: '', exitPrice: 105, side: 'buy', positionSize: 1, pnl: 50, pnlPercent: 0.05, exitReason: 'take_profit' },
      { eventId: 'e2', entryTime: '', entryPrice: 105, exitTime: '', exitPrice: 102.5, side: 'buy', positionSize: 1, pnl: -25, pnlPercent: -0.024, exitReason: 'stop_loss' },
      { eventId: 'e3', entryTime: '', entryPrice: 102.5, exitTime: '', exitPrice: 110, side: 'buy', positionSize: 1, pnl: 75, pnlPercent: 0.073, exitReason: 'take_profit' },
      { eventId: 'e4', entryTime: '', entryPrice: 110, exitTime: '', exitPrice: 100, side: 'buy', positionSize: 1, pnl: -100, pnlPercent: -0.091, exitReason: 'stop_loss' },
    ];

    const summary = calculateSummary(trades, 1000);
    
    // 最大ドローダウン: 1100 → 1000 = 100
    expect(summary.maxDrawdown).toBe(100);
    // ドローダウン率: 100 / 1000 = 0.1（0〜1の小数値）
    expect(summary.maxDrawdownRate).toBe(0.1);
  });
});

// ============================================
// createEmptySummary テスト
// ============================================

describe('createEmptySummary', () => {
  test('すべての値が0または初期値であること', () => {
    const summary = createEmptySummary();
    
    expect(summary.totalTrades).toBe(0);
    expect(summary.winningTrades).toBe(0);
    expect(summary.losingTrades).toBe(0);
    expect(summary.winRate).toBe(0);
    expect(summary.netProfit).toBe(0);
    expect(summary.netProfitRate).toBe(0);
    expect(summary.maxDrawdown).toBe(0);
    expect(summary.maxDrawdownRate).toBe(0);
    expect(summary.profitFactor).toBe(0);
    expect(summary.averageWin).toBe(0);
    expect(summary.averageLoss).toBe(0);
    expect(summary.riskRewardRatio).toBe(0);
    expect(summary.maxConsecutiveWins).toBe(0);
    expect(summary.maxConsecutiveLosses).toBe(0);
  });

  test('返却されたオブジェクトは独立したコピーであること', () => {
    const summary1 = createEmptySummary();
    const summary2 = createEmptySummary();
    
    // 値を変更しても他に影響しない
    summary1.totalTrades = 100;
    expect(summary2.totalTrades).toBe(0);
  });
});
