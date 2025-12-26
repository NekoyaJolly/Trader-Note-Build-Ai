import { MarketSnapshot, TradeNote, MatchResult } from '@prisma/client';
import { config } from '../../../config';
import { TradeNoteRepository } from '../../repositories/tradeNoteRepository';
import { MarketSnapshotRepository } from '../../repositories/marketSnapshotRepository';
import { MatchResultRepository } from '../../repositories/matchResultRepository';

/**
 * 特徴量一致度をスコアリングするための重み設定
 * 合計が 1.0 になるよう配分し、どの要素が寄与しているかを明示する。
 */
const FEATURE_WEIGHTS = {
  priceChange: 0.2,
  volume: 0.15,
  rsi: 0.2,
  macd: 0.15,
  trend: 0.1,
  volatility: 0.1,
  timeFlag: 0.1,
} as const;

/**
 * 各特徴量の許容差（正規化済み特徴量に対する閾値）
 * diff / tolerance を 1.0 でクリップし、1 - その値を部分スコアとする。
 */
const FEATURE_TOLERANCE = {
  priceChange: 0.1,   // ±10% の変化率差までは緩やかに減点
  volume: 0.5,        // 取引量は変動幅が大きいため緩めに判定
  rsi: 0.15,          // RSI は 0〜1 正規化を前提に 15% 以内を高評価
  macd: 0.3,          // MACD は -1〜1 正規化を前提に 0.3 以内を高評価
  volatility: 0.3,    // ボラティリティは変化率の絶対値を使用
  timeFlag: 1.0,      // 0 or 1 のフラグ差をそのまま使用
};

/**
 * ルールベースの一致度計算を担う純粋クラス。
 * DB や外部サービスに依存せず、再現性のあるスコアと理由を返す。
 */
export class RuleBasedMatchEvaluator {
  private static readonly VECTOR_LENGTH = 7;

  /**
   * MarketSnapshot から特徴量ベクトル (7 次元) を構築する。
   * TradeNote.featureVector と同じスケールになるよう、Phase2 の FeatureExtractor と揃えた計算を行う。
   */
  buildMarketFeatureVector(snapshot: MarketSnapshot): number[] {
    const indicators = (snapshot.indicators as any) || {};

    // Decimal を number に丸める
    const close = this.toNumber(snapshot.close);
    const volume = this.toNumber(snapshot.volume);

    // 前日終値があれば価格変化率を計算、なければ 0 とする
    const previousClose = this.toOptionalNumber(indicators.previousClose);
    const priceChange = this.calculatePriceChange(close, previousClose);

    // 平均出来高があれば正規化、なければ中立 0.5 とする
    const averageVolume = this.toOptionalNumber(indicators.averageVolume);
    const normalizedVolume = this.normalizeVolume(volume, averageVolume);

    // RSI は 0〜1 に正規化（未提供なら 0.5）
    const rsi = this.normalizeRSI(this.toOptionalNumber(indicators.rsi));

    // MACD は tanh で -1〜1 に圧縮（未提供なら 0）
    const macd = this.normalizeMACD(this.toOptionalNumber(indicators.macd));

    // トレンドは指標があればそれを優先、なければ価格変化率から推定
    const trend = this.extractTrend(indicators.trend, priceChange);

    // ボラティリティは価格変化率の絶対値で近似
    const volatility = Math.abs(priceChange);

    // 市場時間フラグ（オープン/クローズ付近なら 1）
    const timeFlag = this.extractTimeFlag(indicators.marketHours);

    return [
      priceChange,
      normalizedVolume,
      rsi,
      macd,
      trend,
      volatility,
      timeFlag,
    ];
  }

  /**
   * 2 つの特徴量ベクトルを比較し、スコアと理由を返す。
   */
  evaluate(noteVector: number[], marketVector: number[]): {
    score: number;
    reasons: string[];
    trendMatched: boolean;
    priceRangeMatched: boolean;
  } {
    if (
      noteVector.length !== RuleBasedMatchEvaluator.VECTOR_LENGTH ||
      marketVector.length !== RuleBasedMatchEvaluator.VECTOR_LENGTH
    ) {
      throw new Error('特徴量ベクトルの長さが 7 でないため評価できません');
    }

    const reasons: string[] = [];

    // 部分スコアを計算（0.0〜1.0）
    const partial = {
      priceChange: this.partialSimilarity(noteVector[0], marketVector[0], FEATURE_TOLERANCE.priceChange),
      volume: this.partialSimilarity(noteVector[1], marketVector[1], FEATURE_TOLERANCE.volume),
      rsi: this.partialSimilarity(noteVector[2], marketVector[2], FEATURE_TOLERANCE.rsi),
      macd: this.partialSimilarity(noteVector[3], marketVector[3], FEATURE_TOLERANCE.macd),
      trend: noteVector[4] === marketVector[4] ? 1 : 0,
      volatility: this.partialSimilarity(noteVector[5], marketVector[5], FEATURE_TOLERANCE.volatility),
      timeFlag: 1 - Math.min(Math.abs(noteVector[6] - marketVector[6]), 1),
    };

    // 人間が読める理由を生成（日本語）
    reasons.push(this.buildPriceReason(noteVector[0], marketVector[0], partial.priceChange));
    reasons.push(this.buildVolumeReason(noteVector[1], marketVector[1], partial.volume));
    reasons.push(this.buildRsiReason(noteVector[2], marketVector[2], partial.rsi));
    reasons.push(this.buildMacdReason(noteVector[3], marketVector[3], partial.macd));
    reasons.push(this.buildTrendReason(noteVector[4], marketVector[4], partial.trend));
    reasons.push(this.buildVolatilityReason(noteVector[5], marketVector[5], partial.volatility));
    reasons.push(this.buildTimeReason(noteVector[6], marketVector[6], partial.timeFlag));

    // 重み付き合算で最終スコアを計算
    const score = this.weightedSum(partial);
    const trendMatched = partial.trend === 1;
    const priceRangeMatched = Math.abs(noteVector[0] - marketVector[0]) <= FEATURE_TOLERANCE.priceChange / 2;

    return {
      score,
      reasons,
      trendMatched,
      priceRangeMatched,
    };
  }

  // --- 以下は特徴量変換と理由生成のユーティリティ ---

  private toNumber(value: any): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    const num = Number(value as any);
    return Number.isFinite(num) ? num : 0;
  }

  private toOptionalNumber(value: any): number | undefined {
    if (value === null || value === undefined) return undefined;
    const num = Number(value as any);
    return Number.isFinite(num) ? num : undefined;
  }

  private calculatePriceChange(currentPrice: number, previousClose?: number): number {
    if (!previousClose || previousClose <= 0) return 0;
    const change = (currentPrice - previousClose) / previousClose;
    return Math.max(-1, Math.min(1, change));
  }

  private normalizeVolume(volume: number, averageVolume?: number): number {
    if (!averageVolume || averageVolume <= 0) return 0.5;
    const normalized = volume / (averageVolume * 2);
    return Math.max(0, Math.min(1, normalized));
  }

  private normalizeRSI(rsi?: number): number {
    if (rsi === undefined || rsi === null) return 0.5;
    const normalized = rsi > 1 ? rsi / 100 : rsi;
    return Math.max(0, Math.min(1, normalized));
  }

  private normalizeMACD(macd?: number): number {
    if (macd === undefined || macd === null) return 0;
    return Math.tanh(macd / 10);
  }

  private extractTrend(trendValue: any, priceChange: number): number {
    if (trendValue === 'bullish' || trendValue === 'uptrend') return 1;
    if (trendValue === 'bearish' || trendValue === 'downtrend') return -1;
    if (trendValue === 'neutral') return 0;
    if (typeof trendValue === 'number') {
      if (trendValue > 0) return 1;
      if (trendValue < 0) return -1;
      return 0;
    }

    // トレンド情報がなければ価格変化率で近似
    if (priceChange > 0.01) return 1;
    if (priceChange < -0.01) return -1;
    return 0;
  }

  private extractTimeFlag(marketHours: any): number {
    if (!marketHours) return 0;
    if (marketHours.isNearOpen || marketHours.isNearClose) return 1;
    return 0;
  }

  private partialSimilarity(noteValue: number, marketValue: number, tolerance: number): number {
    const diff = Math.abs(noteValue - marketValue);
    const normalized = Math.min(1, diff / tolerance);
    return 1 - normalized;
  }

  private weightedSum(partial: Record<keyof typeof FEATURE_WEIGHTS, number>): number {
    const score =
      partial.priceChange * FEATURE_WEIGHTS.priceChange +
      partial.volume * FEATURE_WEIGHTS.volume +
      partial.rsi * FEATURE_WEIGHTS.rsi +
      partial.macd * FEATURE_WEIGHTS.macd +
      partial.trend * FEATURE_WEIGHTS.trend +
      partial.volatility * FEATURE_WEIGHTS.volatility +
      partial.timeFlag * FEATURE_WEIGHTS.timeFlag;

    // 浮動小数の誤差を抑えるため、0〜1 にクリップ
    return Math.max(0, Math.min(1, Number(score.toFixed(4))));
  }

  private buildPriceReason(note: number, market: number, score: number): string {
    const diffPct = (Math.abs(note - market) * 100).toFixed(2);
    const status = score >= 0.8 ? '近似' : score >= 0.5 ? '差あり' : '乖離';
    return `価格変化率が${status}（ノート: ${(note * 100).toFixed(2)}%、市場: ${(market * 100).toFixed(2)}%、差: ${diffPct}%）`;
  }

  private buildVolumeReason(note: number, market: number, score: number): string {
    const diffPct = (Math.abs(note - market) * 100).toFixed(1);
    const status = score >= 0.8 ? '類似' : score >= 0.5 ? 'やや差異' : '大きな差異';
    return `取引量の正規化値が${status}（ノート: ${(note * 100).toFixed(1)}%、市場: ${(market * 100).toFixed(1)}%、差: ${diffPct}%）`;
  }

  private buildRsiReason(note: number, market: number, score: number): string {
    const diff = Math.abs(note - market) * 100;
    const status = score >= 0.8 ? '近い RSI' : score >= 0.5 ? 'やや異なる RSI' : '乖離した RSI';
    return `${status}（ノート: ${(note * 100).toFixed(1)}, 市場: ${(market * 100).toFixed(1)}, 差: ${diff.toFixed(1)}）`;
  }

  private buildMacdReason(note: number, market: number, score: number): string {
    const diff = Math.abs(note - market);
    const status = score >= 0.8 ? 'MACD が近い' : score >= 0.5 ? 'MACD が少し異なる' : 'MACD が大きく異なる';
    return `${status}（ノート: ${note.toFixed(3)}, 市場: ${market.toFixed(3)}, 差: ${diff.toFixed(3)}）`;
  }

  private buildTrendReason(note: number, market: number, score: number): string {
    const label = (value: number) => (value > 0 ? '上昇' : value < 0 ? '下降' : '横ばい');
    return score === 1
      ? `トレンド一致（ノート: ${label(note)}, 市場: ${label(market)}）`
      : `トレンド不一致（ノート: ${label(note)}, 市場: ${label(market)}）`;
  }

  private buildVolatilityReason(note: number, market: number, score: number): string {
    const diff = Math.abs(note - market);
    const status = score >= 0.8 ? '同程度のボラティリティ' : score >= 0.5 ? 'ボラティリティがやや異なる' : 'ボラティリティが大きく異なる';
    return `${status}（ノート: ${(note * 100).toFixed(2)}%、市場: ${(market * 100).toFixed(2)}%、差: ${(diff * 100).toFixed(2)}%）`;
  }

  private buildTimeReason(note: number, market: number, score: number): string {
    const describe = (value: number) => (value >= 0.5 ? 'オープン/クローズ付近' : '通常時間');
    return score === 1
      ? `時間帯フラグ一致（ノート: ${describe(note)}, 市場: ${describe(market)}）`
      : `時間帯フラグ不一致（ノート: ${describe(note)}, 市場: ${describe(market)}）`;
  }
}

/**
 * TradeNote と MarketSnapshot を突き合わせ、結果を DB に保存するサービス。
 * 通知や AI 呼び出しは行わず、スコアリングと理由保存に専念する。
 */
export class MatchEvaluationService {
  private readonly tradeNoteRepository: TradeNoteRepository;
  private readonly marketSnapshotRepository: MarketSnapshotRepository;
  private readonly matchResultRepository: MatchResultRepository;
  private readonly evaluator: RuleBasedMatchEvaluator;
  private readonly threshold: number;

  constructor(
    tradeNoteRepository?: TradeNoteRepository,
    marketSnapshotRepository?: MarketSnapshotRepository,
    matchResultRepository?: MatchResultRepository,
    evaluator?: RuleBasedMatchEvaluator,
    threshold: number = config.matching.threshold
  ) {
    this.tradeNoteRepository = tradeNoteRepository || new TradeNoteRepository();
    this.marketSnapshotRepository = marketSnapshotRepository || new MarketSnapshotRepository();
    this.matchResultRepository = matchResultRepository || new MatchResultRepository();
    this.evaluator = evaluator || new RuleBasedMatchEvaluator();
    this.threshold = threshold;
  }

  /**
   * すべての TradeNote を最新の 15m/60m スナップショットと突き合わせ、MatchResult を保存する。
   * 戻り値には保存済みの MatchResult を配列で返す。
   */
  async evaluateAllNotes(): Promise<MatchResult[]> {
    const notes = await this.tradeNoteRepository.findAll(1000, 0);
    const results: MatchResult[] = [];

    for (const note of notes) {
      const evaluationTimestamp = new Date();
      const snapshots = await this.fetchSnapshots(note.symbol);

      for (const snapshot of snapshots) {
        const saved = await this.evaluateAndPersist(note, snapshot, evaluationTimestamp);
        results.push(saved);
      }
    }

    return results;
  }

  /**
   * 単一ノートと単一スナップショットを評価し、結果を永続化する。
   * テスト容易性のため公開メソッドにしている。
   */
  async evaluateAndPersist(
    note: TradeNote,
    snapshot: MarketSnapshot,
    evaluatedAt: Date = new Date()
  ): Promise<MatchResult> {
    const marketVector = this.evaluator.buildMarketFeatureVector(snapshot);
    const evaluation = this.evaluator.evaluate(note.featureVector, marketVector);

    return this.matchResultRepository.upsertByNoteAndSnapshot({
      noteId: note.id,
      marketSnapshotId: snapshot.id,
      symbol: note.symbol,
      score: evaluation.score,
      threshold: this.threshold,
      trendMatched: evaluation.trendMatched,
      priceRangeMatched: evaluation.priceRangeMatched,
      reasons: evaluation.reasons,
      evaluatedAt,
    });
  }

  // --- 内部ヘルパー ---

  private async fetchSnapshots(symbol: string): Promise<MarketSnapshot[]> {
    const timeframes: Array<'15m' | '60m'> = ['15m', '60m'];
    const snapshots: MarketSnapshot[] = [];

    for (const timeframe of timeframes) {
      const snapshot = await this.marketSnapshotRepository.findLatest(symbol, timeframe);
      if (snapshot) {
        snapshots.push(snapshot);
      }
    }

    return snapshots;
  }
}
