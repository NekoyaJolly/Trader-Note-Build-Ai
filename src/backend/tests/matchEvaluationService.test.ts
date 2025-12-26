import { MatchResult, MarketSnapshot, TradeNote, Prisma } from '@prisma/client';
import { RuleBasedMatchEvaluator, MatchEvaluationService } from '../services/matching/matchEvaluationService';

// 日本語コメント必須: 判定ロジックの単体テスト
// 高一致 / 低一致 / 境界値（閾値ちょうど） / 理由生成をカバーする

describe('RuleBasedMatchEvaluator', () => {
  const evaluator = new RuleBasedMatchEvaluator();

  test('高一致ケースは閾値を大きく上回る', () => {
    const noteVector = [0.05, 0.6, 0.65, 0.1, 1, 0.2, 0];
    const marketVector = [0.055, 0.62, 0.66, 0.12, 1, 0.21, 0];

    const result = evaluator.evaluate(noteVector, marketVector);

    expect(result.score).toBeGreaterThan(0.9);
    expect(result.trendMatched).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  test('低一致ケースは閾値を下回る', () => {
    const noteVector = [0.2, 0.9, 0.8, 0.5, 1, 0.4, 1];
    const marketVector = [-0.2, 0.1, 0.2, -0.5, -1, 0.05, 0];

    const result = evaluator.evaluate(noteVector, marketVector);

    expect(result.score).toBeLessThan(0.3);
    expect(result.trendMatched).toBe(false);
    expect(result.reasons.some((r) => r.includes('不一致') || r.includes('乖離'))).toBe(true);
  });
});

describe('MatchEvaluationService', () => {
  const evaluator = new RuleBasedMatchEvaluator();

  // テスト用の TradeNote を組み立てる（featureVector は正規化済み 7 次元）
  const note: TradeNote = {
    id: 'note-1',
    tradeId: 'trade-1',
    symbol: 'BTCUSDT',
    entryPrice: new Prisma.Decimal(100),
    side: 'buy',
    indicators: {},
    featureVector: [0.05, 0.6, 0.65, 0.1, 1, 0.2, 1],
    timeframe: '15m',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // 市場スナップショット（平均出来高や前日終値を含め、FeatureExtractor と同スケールにする）
  const snapshot: MarketSnapshot = {
    id: 'snapshot-1',
    symbol: 'BTCUSDT',
    timeframe: '15m',
    close: new Prisma.Decimal(105),
    volume: new Prisma.Decimal(600),
    indicators: {
      previousClose: 100,
      averageVolume: 600,
      rsi: 65,
      macd: 1.2,
      trend: 'bullish',
      marketHours: { isNearOpen: false, isNearClose: false },
    },
    fetchedAt: new Date(),
    createdAt: new Date(),
  };

  test('境界値: スコアが閾値と等しい場合でも保存される', async () => {
    const marketVector = evaluator.buildMarketFeatureVector(snapshot);
    const preEvaluation = evaluator.evaluate(note.featureVector, marketVector);
    const boundaryThreshold = preEvaluation.score; // スコアと同じ値を閾値として設定

    // リポジトリをモックして永続化呼び出しを検証
    const mockMatchResultRepo = {
      upsertByNoteAndSnapshot: jest.fn(async (input) => {
        const stored: MatchResult = {
          id: 'match-1',
          noteId: input.noteId,
          marketSnapshotId: input.marketSnapshotId,
          symbol: input.symbol,
          score: input.score,
          threshold: input.threshold,
          trendMatched: input.trendMatched,
          priceRangeMatched: input.priceRangeMatched,
          reasons: input.reasons,
          evaluatedAt: input.evaluatedAt,
          decidedAt: input.evaluatedAt,
          createdAt: input.evaluatedAt,
        };
        return stored;
      }),
    };

    // スナップショット取得をモック（評価対象を直接渡すため findLatest は不要）
    const service = new MatchEvaluationService(
      {} as any,
      {} as any,
      mockMatchResultRepo as any,
      evaluator,
      boundaryThreshold
    );

    const evaluatedAt = new Date('2024-01-01T00:00:00Z');
    const saved = await service.evaluateAndPersist(note, snapshot, evaluatedAt);

    expect(saved.score).toBeCloseTo(boundaryThreshold, 5);
    expect(mockMatchResultRepo.upsertByNoteAndSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        noteId: note.id,
        marketSnapshotId: snapshot.id,
        threshold: boundaryThreshold,
        reasons: expect.arrayContaining([expect.any(String)]),
      })
    );
  });
});
