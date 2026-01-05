/**
 * AIトレードノート テスト
 * 
 * Phase C: AIトレードノート機能のユニットテスト
 * - 型定義・ユーティリティ関数
 * - 統計計算
 * - 類似度計算
 * 
 * @see src/side-b/models/aiTradeNote.ts
 * @see docs/side-b/phase-c-ai-trade-note.md
 */

import {
  // 型定義
  TradeOutcome,
  TimingEvaluation,
  ExitTimingEvaluation,
  AccuracyEvaluation,
  ExitType,
  SummaryPeriod,
  AITradeNote,
  TradeResult,
  EntryAnalysis,
  ExitAnalysis,
  PlanEvaluation,
  MarketReview,
  Learnings,
  SummaryStatistics,
  
  // ユーティリティ関数
  outcomeToJapanese,
  timingToJapanese,
  exitTimingToJapanese,
  accuracyToJapanese,
  exitTypeToJapanese,
  periodToJapanese,
  determineOutcome,
  calculateHoldingDuration,
  calculateActualRR,
  createDefaultLearnings,
  createDefaultStatistics,
  calculateStatisticsFromNotes,
  calculateNoteSimilarity,
} from '../models';

// ===== テストヘルパー =====

/**
 * テスト用のダミーノートを作成
 */
function createMockNote(overrides: Partial<AITradeNote> = {}): AITradeNote {
  return {
    id: 'note-001',
    virtualTradeId: 'vt-001',
    planId: 'plan-001',
    date: '2024-01-15',
    symbol: 'XAUUSD',
    direction: 'long',
    result: createMockResult(),
    entryAnalysis: createMockEntryAnalysis(),
    exitAnalysis: createMockExitAnalysis(),
    planEvaluation: createMockPlanEvaluation(),
    marketReview: createMockMarketReview(),
    learnings: createMockLearnings(),
    aiModel: 'gpt-4o-mini',
    createdAt: new Date('2024-01-15T12:00:00Z'),
    ...overrides,
  };
}

function createMockResult(overrides: Partial<TradeResult> = {}): TradeResult {
  return {
    outcome: 'win',
    pnlPips: 50,
    pnlPercentage: 1.5,
    riskRewardActual: 2.0,
    holdingDuration: 120,
    ...overrides,
  };
}

function createMockEntryAnalysis(overrides: Partial<EntryAnalysis> = {}): EntryAnalysis {
  return {
    timing: 'good',
    priceVsPlan: 5,
    marketConditionAtEntry: 'トレンド相場、上昇モメンタム',
    evaluation: 'エントリーは計画通りに実行された',
    ...overrides,
  };
}

function createMockExitAnalysis(overrides: Partial<ExitAnalysis> = {}): ExitAnalysis {
  return {
    type: 'take_profit',
    timing: 'optimal',
    evaluation: 'TPで利確、価格はその後反転',
    ...overrides,
  };
}

function createMockPlanEvaluation(overrides: Partial<PlanEvaluation> = {}): PlanEvaluation {
  return {
    scenarioAccuracy: 'accurate',
    levelAccuracy: 'accurate',
    directionCorrect: true,
    evaluation: 'プラン通りのトレードが実行できた',
    ...overrides,
  };
}

function createMockMarketReview(overrides: Partial<MarketReview> = {}): MarketReview {
  return {
    regimeActual: 'trending_up',
    regimePredicted: 'trending_up',
    keyEventsImpact: ['FOMC後のドル安継続'],
    volatilityNote: '通常レベルのボラティリティ',
    ...overrides,
  };
}

function createMockLearnings(overrides: Partial<Learnings> = {}): Learnings {
  return {
    whatWorked: ['トレンドに沿ったエントリー', '適切なSL設定'],
    whatDidntWork: [],
    keyInsight: 'トレンド相場では順張りが有効',
    actionItems: ['同様のセットアップを継続'],
    ...overrides,
  };
}

// ===== テスト =====

describe('AITradeNote モデル', () => {
  describe('outcomeToJapanese', () => {
    it('win → 勝ち', () => {
      expect(outcomeToJapanese('win')).toBe('勝ち');
    });

    it('loss → 負け', () => {
      expect(outcomeToJapanese('loss')).toBe('負け');
    });

    it('breakeven → 同値撤退', () => {
      expect(outcomeToJapanese('breakeven')).toBe('同値撤退');
    });
  });

  describe('timingToJapanese', () => {
    it('good → 良好', () => {
      expect(timingToJapanese('good')).toBe('良好');
    });

    it('fair → 普通', () => {
      expect(timingToJapanese('fair')).toBe('普通');
    });

    it('poor → 不良', () => {
      expect(timingToJapanese('poor')).toBe('不良');
    });
  });

  describe('exitTimingToJapanese', () => {
    it('optimal → 最適', () => {
      expect(exitTimingToJapanese('optimal')).toBe('最適');
    });

    it('early → 早すぎ', () => {
      expect(exitTimingToJapanese('early')).toBe('早すぎ');
    });

    it('late → 遅すぎ', () => {
      expect(exitTimingToJapanese('late')).toBe('遅すぎ');
    });
  });

  describe('accuracyToJapanese', () => {
    it('accurate → 正確', () => {
      expect(accuracyToJapanese('accurate')).toBe('正確');
    });

    it('partial → 部分的', () => {
      expect(accuracyToJapanese('partial')).toBe('部分的');
    });

    it('inaccurate → 不正確', () => {
      expect(accuracyToJapanese('inaccurate')).toBe('不正確');
    });
  });

  describe('exitTypeToJapanese', () => {
    it('take_profit → 利確', () => {
      expect(exitTypeToJapanese('take_profit')).toBe('利確');
    });

    it('stop_loss → 損切り', () => {
      expect(exitTypeToJapanese('stop_loss')).toBe('損切り');
    });

    it('manual → 手動決済', () => {
      expect(exitTypeToJapanese('manual')).toBe('手動決済');
    });

    it('trailing_stop → トレーリング', () => {
      expect(exitTypeToJapanese('trailing_stop')).toBe('トレーリング');
    });

    it('time_expiry → 期限切れ', () => {
      expect(exitTypeToJapanese('time_expiry')).toBe('期限切れ');
    });
  });

  describe('periodToJapanese', () => {
    it('daily → 日次', () => {
      expect(periodToJapanese('daily')).toBe('日次');
    });

    it('weekly → 週次', () => {
      expect(periodToJapanese('weekly')).toBe('週次');
    });

    it('monthly → 月次', () => {
      expect(periodToJapanese('monthly')).toBe('月次');
    });
  });
});

describe('determineOutcome', () => {
  it('プラス pips は win', () => {
    expect(determineOutcome(50)).toBe('win');
    expect(determineOutcome(1)).toBe('win');
  });

  it('マイナス pips は loss', () => {
    expect(determineOutcome(-50)).toBe('loss');
    expect(determineOutcome(-1)).toBe('loss');
  });

  it('ほぼゼロ（±0.5以内）は breakeven', () => {
    expect(determineOutcome(0)).toBe('breakeven');
    expect(determineOutcome(0.3)).toBe('breakeven');
    expect(determineOutcome(-0.3)).toBe('breakeven');
    expect(determineOutcome(0.5)).toBe('breakeven');
    expect(determineOutcome(-0.5)).toBe('breakeven');
  });
});

describe('calculateHoldingDuration', () => {
  it('保有時間を分で計算', () => {
    const entry = new Date('2024-01-15T10:00:00Z');
    const exit = new Date('2024-01-15T12:00:00Z');
    
    expect(calculateHoldingDuration(entry, exit)).toBe(120); // 2時間 = 120分
  });

  it('短時間の保有', () => {
    const entry = new Date('2024-01-15T10:00:00Z');
    const exit = new Date('2024-01-15T10:15:00Z');
    
    expect(calculateHoldingDuration(entry, exit)).toBe(15);
  });

  it('長時間の保有', () => {
    const entry = new Date('2024-01-15T10:00:00Z');
    const exit = new Date('2024-01-16T10:00:00Z');
    
    expect(calculateHoldingDuration(entry, exit)).toBe(1440); // 24時間 = 1440分
  });
});

describe('calculateActualRR', () => {
  describe('ロングトレード', () => {
    it('利益トレードのRRを計算', () => {
      // エントリー: 2620, 決済: 2650, SL: 2600
      // リスク: 20, リワード: 30 → RR = 1.5
      const rr = calculateActualRR('long', 2620, 2650, 2600);
      expect(rr).toBe(1.5);
    });

    it('損失トレードのRRを計算', () => {
      // エントリー: 2620, 決済: 2600, SL: 2600
      // リスク: 20, リワード: -20 → RR = -1.0
      const rr = calculateActualRR('long', 2620, 2600, 2600);
      expect(rr).toBe(-1);
    });

    it('リスクがゼロの場合は0を返す', () => {
      const rr = calculateActualRR('long', 2620, 2650, 2620);
      expect(rr).toBe(0);
    });
  });

  describe('ショートトレード', () => {
    it('利益トレードのRRを計算', () => {
      // エントリー: 2650, 決済: 2620, SL: 2680
      // リスク: 30, リワード: 30 → RR = 1.0
      const rr = calculateActualRR('short', 2650, 2620, 2680);
      expect(rr).toBe(1);
    });

    it('損失トレードのRRを計算', () => {
      // エントリー: 2650, 決済: 2680, SL: 2680
      // リスク: 30, リワード: -30 → RR = -1.0
      const rr = calculateActualRR('short', 2650, 2680, 2680);
      expect(rr).toBe(-1);
    });
  });
});

describe('createDefaultLearnings', () => {
  it('空の学びオブジェクトを作成', () => {
    const learnings = createDefaultLearnings();
    
    expect(learnings.whatWorked).toEqual([]);
    expect(learnings.whatDidntWork).toEqual([]);
    expect(learnings.keyInsight).toBe('');
    expect(learnings.actionItems).toEqual([]);
  });
});

describe('createDefaultStatistics', () => {
  it('ゼロ初期化された統計を作成', () => {
    const stats = createDefaultStatistics();
    
    expect(stats.totalTrades).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.profitFactor).toBe(0);
    expect(stats.averageWin).toBe(0);
    expect(stats.averageLoss).toBe(0);
    expect(stats.largestWin).toBe(0);
    expect(stats.largestLoss).toBe(0);
    expect(stats.totalPnl).toBe(0);
  });
});

describe('calculateStatisticsFromNotes', () => {
  it('空配列の場合はデフォルト統計を返す', () => {
    const stats = calculateStatisticsFromNotes([]);
    
    expect(stats.totalTrades).toBe(0);
    expect(stats.winRate).toBe(0);
  });

  it('全勝の場合', () => {
    const notes = [
      createMockNote({ result: createMockResult({ outcome: 'win', pnlPips: 50 }) }),
      createMockNote({ result: createMockResult({ outcome: 'win', pnlPips: 30 }) }),
    ];
    
    const stats = calculateStatisticsFromNotes(notes);
    
    expect(stats.totalTrades).toBe(2);
    expect(stats.winRate).toBe(100);
    expect(stats.averageWin).toBe(40); // (50 + 30) / 2
    expect(stats.largestWin).toBe(50);
    expect(stats.totalPnl).toBe(80);
    expect(stats.profitFactor).toBe(0); // 負けなし
  });

  it('全敗の場合', () => {
    const notes = [
      createMockNote({ result: createMockResult({ outcome: 'loss', pnlPips: -50 }) }),
      createMockNote({ result: createMockResult({ outcome: 'loss', pnlPips: -30 }) }),
    ];
    
    const stats = calculateStatisticsFromNotes(notes);
    
    expect(stats.totalTrades).toBe(2);
    expect(stats.winRate).toBe(0);
    expect(stats.averageLoss).toBe(40); // (50 + 30) / 2
    expect(stats.largestLoss).toBe(50);
    expect(stats.totalPnl).toBe(-80);
    expect(stats.profitFactor).toBe(0); // 勝ちなし
  });

  it('勝敗混在の場合', () => {
    const notes = [
      createMockNote({ result: createMockResult({ outcome: 'win', pnlPips: 100 }) }),
      createMockNote({ result: createMockResult({ outcome: 'win', pnlPips: 60 }) }),
      createMockNote({ result: createMockResult({ outcome: 'loss', pnlPips: -40 }) }),
      createMockNote({ result: createMockResult({ outcome: 'loss', pnlPips: -20 }) }),
    ];
    
    const stats = calculateStatisticsFromNotes(notes);
    
    expect(stats.totalTrades).toBe(4);
    expect(stats.winRate).toBe(50); // 2/4 = 50%
    expect(stats.averageWin).toBe(80); // (100 + 60) / 2
    expect(stats.averageLoss).toBe(30); // (40 + 20) / 2
    expect(stats.largestWin).toBe(100);
    expect(stats.largestLoss).toBe(40);
    expect(stats.totalPnl).toBe(100); // 160 - 60
    expect(stats.profitFactor).toBeCloseTo(2.67, 1); // 160 / 60
  });

  it('同値撤退を含む場合', () => {
    const notes = [
      createMockNote({ result: createMockResult({ outcome: 'win', pnlPips: 50 }) }),
      createMockNote({ result: createMockResult({ outcome: 'breakeven', pnlPips: 0 }) }),
      createMockNote({ result: createMockResult({ outcome: 'loss', pnlPips: -25 }) }),
    ];
    
    const stats = calculateStatisticsFromNotes(notes);
    
    expect(stats.totalTrades).toBe(3);
    expect(stats.winRate).toBeCloseTo(33.33, 1); // 1/3
    expect(stats.totalPnl).toBe(25);
  });
});

describe('calculateNoteSimilarity', () => {
  it('同一ベクトルは100%類似', () => {
    const features = [1, 2, 3, 4, 5];
    const similarity = calculateNoteSimilarity(features, features);
    
    expect(similarity).toBe(100);
  });

  it('異なるベクトル間の類似度を計算', () => {
    const features1 = [1, 0, 1, 0, 1];
    const features2 = [1, 1, 0, 0, 1];
    const similarity = calculateNoteSimilarity(features1, features2);
    
    // コサイン類似度: (1+0+0+0+1) / sqrt(3) * sqrt(3) = 2/3 ≈ 67%
    expect(similarity).toBeCloseTo(67, -1);
  });

  it('直交ベクトルは0%類似', () => {
    const features1 = [1, 0, 0];
    const features2 = [0, 1, 0];
    const similarity = calculateNoteSimilarity(features1, features2);
    
    expect(similarity).toBe(0);
  });

  it('長さが異なる場合は0を返す', () => {
    const features1 = [1, 2, 3];
    const features2 = [1, 2];
    const similarity = calculateNoteSimilarity(features1, features2);
    
    expect(similarity).toBe(0);
  });

  it('ゼロベクトルは0を返す', () => {
    const zero = [0, 0, 0];
    const nonZero = [1, 2, 3];
    
    expect(calculateNoteSimilarity(zero, nonZero)).toBe(0);
    expect(calculateNoteSimilarity(nonZero, zero)).toBe(0);
  });
});

describe('AITradeNote 型の検証', () => {
  it('有効なノートオブジェクトを作成できる', () => {
    const note = createMockNote();
    
    expect(note.id).toBe('note-001');
    expect(note.virtualTradeId).toBe('vt-001');
    expect(note.direction).toBe('long');
    expect(note.result.outcome).toBe('win');
    expect(note.entryAnalysis.timing).toBe('good');
    expect(note.exitAnalysis.type).toBe('take_profit');
    expect(note.planEvaluation.scenarioAccuracy).toBe('accurate');
    expect(note.learnings.whatWorked).toContain('トレンドに沿ったエントリー');
  });

  it('カスタム値でノートを作成できる', () => {
    const note = createMockNote({
      direction: 'short',
      result: createMockResult({ outcome: 'loss', pnlPips: -30 }),
      entryAnalysis: createMockEntryAnalysis({ timing: 'poor' }),
    });
    
    expect(note.direction).toBe('short');
    expect(note.result.outcome).toBe('loss');
    expect(note.entryAnalysis.timing).toBe('poor');
  });
});
