/**
 * NoteEvaluator テスト
 * 
 * 目的:
 * - NoteEvaluator インターフェースの振る舞いを検証
 * - LegacyNoteEvaluator（12次元固定）の動作確認
 * - UserIndicatorNoteEvaluator（可変次元）の動作確認
 * - ファクトリ関数の分岐ロジック検証
 */

import { NoteStatus, TradeSide, Prisma } from '@prisma/client';
import {
  NoteEvaluator,
  NoteIndicatorConfig,
  MarketSnapshot,
  cosineSimilarity,
  getSimilarityLevel,
  createDefaultNoteConfig,
  DEFAULT_THRESHOLDS,
} from '../../domain/noteEvaluator';
import {
  LegacyNoteEvaluator,
  UserIndicatorNoteEvaluator,
  createNoteEvaluator,
  createNoteEvaluators,
} from '../../services/legacyNoteEvaluatorAdapter';
import { Decimal } from '@prisma/client/runtime/library';

// ============================================================================
// テストヘルパー
// ============================================================================

/**
 * テスト用の TradeNote モックを生成
 * Prisma の TradeNote 型に準拠（indicatorConfig は JsonValue）
 */
function createMockNote(overrides: Partial<{
  id: string;
  symbol: string;
  featureVector: number[];
  indicatorConfig: Prisma.JsonValue;
}> = {}) {
  return {
    id: overrides.id ?? 'test-note-id',
    tradeId: 'test-trade-id',
    symbol: overrides.symbol ?? 'BTCUSDT',
    entryPrice: new Decimal(43000),
    side: 'buy' as TradeSide,
    indicators: { rsi: 50, macd: 0.5 } as Prisma.JsonValue,
    featureVector: overrides.featureVector ?? [0.5, 0.6, 0.5, 0.1, 0.5, 0.5, 0.5, 0.5, 0.3, 0.6, 0.5, 0.5],
    timeframe: '15m',
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    lastEditedAt: null,
    marketContext: { trend: 'bullish', timeframe: '15m' } as Prisma.JsonValue,
    rejectedAt: null,
    status: 'approved' as NoteStatus,
    tags: [],
    userNotes: null,
    indicatorConfig: overrides.indicatorConfig ?? null,
    // フェーズ8: 優先度/有効無効管理
    priority: 5,
    enabled: true,
    pausedUntil: null,
  };
}

/**
 * テスト用の MarketSnapshot を生成
 */
function createMockSnapshot(overrides: Partial<{
  symbol: string;
  indicators: Record<string, number | null>;
}> = {}): MarketSnapshot {
  return {
    symbol: overrides.symbol ?? 'BTCUSDT',
    timestamp: new Date(),
    timeframe: '15m',
    ohlcv: {
      open: 42900,
      high: 43200,
      low: 42800,
      close: 43100,
      volume: 1000000,
    },
    indicators: overrides.indicators ?? {
      'RSI(14)': 52,
      'MACD_line': 150,
      'MACD_signal': 120,
      'MACD_histogram': 30,
      'BB_upper': 45000,
      'BB_middle': 43000,
      'BB_lower': 41000,
      'SMA(20)': 42800,
      'EMA(20)': 42900,
      'ATR(14)': 500,
    },
  };
}

// ============================================================================
// cosineSimilarity テスト
// ============================================================================

describe('cosineSimilarity', () => {
  test('同一ベクトルの類似度は 1.0', () => {
    const vec = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0, 5);
  });
  
  test('正規化されたベクトルの類似度計算', () => {
    const vecA = [1, 0, 0];
    const vecB = [0, 1, 0];
    // 直交ベクトルの類似度は 0
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(0.0, 5);
  });
  
  test('類似したベクトルは高い類似度', () => {
    const vecA = [1, 2, 3];
    const vecB = [1.1, 2.1, 3.1];
    const similarity = cosineSimilarity(vecA, vecB);
    expect(similarity).toBeGreaterThan(0.99);
  });
  
  test('次元数が異なる場合は 0 を返す', () => {
    const vecA = [1, 2, 3];
    const vecB = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(vecA, vecB)).toBe(0);
  });
  
  test('空ベクトルの場合は 0 を返す', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
  
  test('ゼロベクトルの場合は 0 を返す', () => {
    const zero = [0, 0, 0];
    const vec = [1, 2, 3];
    expect(cosineSimilarity(zero, vec)).toBe(0);
  });
});

// ============================================================================
// getSimilarityLevel テスト
// ============================================================================

describe('getSimilarityLevel', () => {
  const thresholds = {
    strong: 0.90,
    medium: 0.80,
    weak: 0.70,
  };
  
  test('0.90以上は strong', () => {
    expect(getSimilarityLevel(0.95, thresholds)).toBe('strong');
    expect(getSimilarityLevel(0.90, thresholds)).toBe('strong');
  });
  
  test('0.80-0.90は medium', () => {
    expect(getSimilarityLevel(0.85, thresholds)).toBe('medium');
    expect(getSimilarityLevel(0.80, thresholds)).toBe('medium');
  });
  
  test('0.70-0.80は weak', () => {
    expect(getSimilarityLevel(0.75, thresholds)).toBe('weak');
    expect(getSimilarityLevel(0.70, thresholds)).toBe('weak');
  });
  
  test('0.70未満は none', () => {
    expect(getSimilarityLevel(0.65, thresholds)).toBe('none');
    expect(getSimilarityLevel(0.0, thresholds)).toBe('none');
  });
});

// ============================================================================
// createDefaultNoteConfig テスト
// ============================================================================

describe('createDefaultNoteConfig', () => {
  test('グローバル設定からノート設定を生成', () => {
    const globalConfigs = [
      {
        configId: 'rsi-14',
        indicatorId: 'rsi' as const,
        params: { period: 14 },
        enabled: true,
      },
      {
        configId: 'sma-20',
        indicatorId: 'sma' as const,
        params: { period: 20 },
        enabled: false, // 無効
      },
    ];
    
    const config = createDefaultNoteConfig(globalConfigs, 0.80);
    
    expect(config.version).toBe(1);
    expect(config.threshold).toBe(0.80);
    expect(config.similarityMethod).toBe('cosine');
    // enabled: true のみが含まれる
    expect(config.indicators).toHaveLength(1);
    expect(config.indicators[0].indicatorId).toBe('rsi');
  });
  
  test('デフォルト閾値は 0.75', () => {
    const config = createDefaultNoteConfig([]);
    expect(config.threshold).toBe(0.75);
  });
});

// ============================================================================
// LegacyNoteEvaluator テスト
// ============================================================================

describe('LegacyNoteEvaluator', () => {
  test('requiredIndicators は固定のインジケーター仕様を返す', () => {
    const note = createMockNote();
    const evaluator = new LegacyNoteEvaluator(note);
    
    const specs = evaluator.requiredIndicators();
    
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.some(s => s.indicatorId === 'rsi')).toBe(true);
    expect(specs.some(s => s.indicatorId === 'macd')).toBe(true);
    expect(specs.some(s => s.indicatorId === 'bb')).toBe(true);
  });
  
  test('getThresholds は SIMILARITY_THRESHOLDS を返す', () => {
    const note = createMockNote();
    const evaluator = new LegacyNoteEvaluator(note);
    
    const thresholds = evaluator.getThresholds();
    
    expect(thresholds.strong).toBe(0.90);
    expect(thresholds.medium).toBe(0.80);
    expect(thresholds.weak).toBe(0.70);
  });
  
  test('similarity はコサイン類似度を計算', () => {
    const note = createMockNote();
    const evaluator = new LegacyNoteEvaluator(note);
    
    const vecA = [1, 2, 3];
    const vecB = [1, 2, 3];
    
    expect(evaluator.similarity(vecA, vecB)).toBeCloseTo(1.0, 5);
  });
  
  test('isTriggered は閾値以上で true', () => {
    const note = createMockNote();
    const evaluator = new LegacyNoteEvaluator(note, 0.75);
    
    expect(evaluator.isTriggered(0.80)).toBe(true);
    expect(evaluator.isTriggered(0.75)).toBe(true);
    expect(evaluator.isTriggered(0.70)).toBe(false);
  });
  
  test('evaluate は評価結果を返す', () => {
    const note = createMockNote({
      featureVector: Array(12).fill(0.5),
    });
    const evaluator = new LegacyNoteEvaluator(note);
    const snapshot = createMockSnapshot();
    
    const result = evaluator.evaluate(snapshot);
    
    expect(result.noteId).toBe(note.id);
    expect(result.vectorDimension).toBe(12);
    expect(result.usedIndicators.length).toBeGreaterThan(0);
    expect(typeof result.similarity).toBe('number');
    expect(['strong', 'medium', 'weak', 'none']).toContain(result.level);
    expect(typeof result.triggered).toBe('boolean');
  });
  
  test('buildFeatureVector は12次元ベクトルを生成', () => {
    const note = createMockNote();
    const evaluator = new LegacyNoteEvaluator(note);
    const snapshot = createMockSnapshot();
    
    const vector = evaluator.buildFeatureVector(snapshot);
    
    expect(vector).toHaveLength(12);
    expect(vector.every(v => typeof v === 'number')).toBe(true);
  });
});

// ============================================================================
// UserIndicatorNoteEvaluator テスト
// ============================================================================

describe('UserIndicatorNoteEvaluator', () => {
  const mockConfig: NoteIndicatorConfig = {
    version: 1,
    indicators: [
      { configId: 'rsi-14', indicatorId: 'rsi', params: { period: 14 }, enabled: true },
      { configId: 'sma-20', indicatorId: 'sma', params: { period: 20 }, enabled: true },
      { configId: 'ema-50', indicatorId: 'ema', params: { period: 50 }, enabled: false }, // 無効
    ],
    threshold: 0.80,
    similarityMethod: 'cosine',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  test('requiredIndicators は enabled のみを返す', () => {
    const note = createMockNote();
    const evaluator = new UserIndicatorNoteEvaluator(note, mockConfig, [50, 42800]);
    
    const specs = evaluator.requiredIndicators();
    
    expect(specs).toHaveLength(2);
    expect(specs.map(s => s.indicatorId)).toEqual(['rsi', 'sma']);
  });
  
  test('buildFeatureVector は設定に基づいた可変長ベクトルを生成', () => {
    const note = createMockNote();
    const evaluator = new UserIndicatorNoteEvaluator(note, mockConfig, [50, 42800]);
    const snapshot = createMockSnapshot({
      indicators: {
        'RSI(14)': 55,
        'SMA(20)': 43000,
      },
    });
    
    const vector = evaluator.buildFeatureVector(snapshot);
    
    // enabled が 2 つなので 2 次元
    expect(vector).toHaveLength(2);
    expect(vector[0]).toBe(55);   // RSI(14)
    expect(vector[1]).toBe(43000); // SMA(20)
  });
  
  test('getThresholds はノート設定に基づいた閾値を返す', () => {
    const note = createMockNote();
    const evaluator = new UserIndicatorNoteEvaluator(note, mockConfig, [50, 42800]);
    
    const thresholds = evaluator.getThresholds();
    
    expect(thresholds.medium).toBeCloseTo(0.80, 5);
    expect(thresholds.strong).toBeCloseTo(0.90, 5);
    expect(thresholds.weak).toBeCloseTo(0.70, 5);
  });
  
  test('evaluate は不足インジケーターを検出', () => {
    const note = createMockNote();
    const evaluator = new UserIndicatorNoteEvaluator(note, mockConfig, [50, 42800]);
    const snapshot = createMockSnapshot({
      indicators: {
        'RSI(14)': 55,
        // SMA(20) が欠落
      },
    });
    
    const result = evaluator.evaluate(snapshot);
    
    expect(result.diagnostics?.missingIndicators).toContain('SMA(20)');
  });
});

// ============================================================================
// ファクトリ関数テスト
// ============================================================================

describe('createNoteEvaluator', () => {
  test('indicatorConfig が null の場合は LegacyNoteEvaluator を返す', () => {
    const note = createMockNote({ indicatorConfig: null });
    const evaluator = createNoteEvaluator(note);
    
    expect(evaluator).toBeInstanceOf(LegacyNoteEvaluator);
  });
  
  test('indicatorConfig が設定されている場合は UserIndicatorNoteEvaluator を返す', () => {
    const config: NoteIndicatorConfig = {
      version: 1,
      indicators: [
        { configId: 'rsi-14', indicatorId: 'rsi', params: { period: 14 }, enabled: true },
      ],
      threshold: 0.75,
      similarityMethod: 'cosine',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // NoteIndicatorConfig を JsonValue として渡す
    const note = createMockNote({ indicatorConfig: config as unknown as Prisma.JsonValue });
    const evaluator = createNoteEvaluator(note);
    
    expect(evaluator).toBeInstanceOf(UserIndicatorNoteEvaluator);
  });
  
  test('不正な indicatorConfig の場合は LegacyNoteEvaluator にフォールバック', () => {
    const note = createMockNote({
      indicatorConfig: { invalid: true } as Prisma.JsonValue,
    });
    const evaluator = createNoteEvaluator(note);
    
    expect(evaluator).toBeInstanceOf(LegacyNoteEvaluator);
  });
});

describe('createNoteEvaluators', () => {
  test('複数ノートから Map を生成', () => {
    const notes = [
      createMockNote({ id: 'note-1', indicatorConfig: null }),
      createMockNote({ id: 'note-2', indicatorConfig: null }),
    ];
    
    const evaluators = createNoteEvaluators(notes);
    
    expect(evaluators.size).toBe(2);
    expect(evaluators.get('note-1')).toBeInstanceOf(LegacyNoteEvaluator);
    expect(evaluators.get('note-2')).toBeInstanceOf(LegacyNoteEvaluator);
  });
});

// ============================================================================
// 統合テスト
// ============================================================================

describe('NoteEvaluator 統合テスト', () => {
  test('同じインジケーター値なら高い類似度', () => {
    const noteVector = [0.5, 0.6, 0.5, 0.1, 0.5, 0.5, 0.5, 0.5, 0.3, 0.6, 0.5, 0.5];
    const note = createMockNote({ featureVector: noteVector });
    const evaluator = new LegacyNoteEvaluator(note);
    
    // ノートベクトル同士を比較
    const result = evaluator.evaluate(createMockSnapshot(), noteVector);
    
    // 同じベクトルなら類似度は 1.0
    // ただし市場から生成されるベクトルは異なるので、noteVector を直接渡す
    const selfSimilarity = evaluator.similarity(noteVector, noteVector);
    expect(selfSimilarity).toBeCloseTo(1.0, 5);
  });
  
  test('ノート主体の評価フロー', () => {
    // 1. ノートを取得
    const note = createMockNote({ id: 'test-flow-note' });
    
    // 2. NoteEvaluator を生成（ノートが評価の主語）
    const evaluator = createNoteEvaluator(note);
    
    // 3. このノートが必要とするインジケーターを取得
    const requiredIndicators = evaluator.requiredIndicators();
    expect(requiredIndicators.length).toBeGreaterThan(0);
    
    // 4. 市場データを取得（実際は MarketDataService から）
    const snapshot = createMockSnapshot({ symbol: note.symbol });
    
    // 5. ノート固有のロジックで評価
    const result = evaluator.evaluate(snapshot);
    
    // 6. 結果の検証
    expect(result.noteId).toBe(note.id);
    expect(typeof result.triggered).toBe('boolean');
    expect(result.usedIndicators.length).toBeGreaterThan(0);
  });
});
