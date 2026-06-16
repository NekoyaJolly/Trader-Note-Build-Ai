import type { Request, Response } from 'express';
import { z } from 'zod';
import type { OrderPreset, OrderPresetConfidenceSource, TradeNote } from '../../models/types';
import { TradeNoteService } from '../../services/tradeNoteService';
import { MarketDataService } from '../../services/marketDataService';
import {
  MatchResultRepository,
  type LatestMatchForNote,
} from '../repositories/matchResultRepository';

// 注文確認リクエストボディ（参考情報生成用）
// 自動売買ではなく、フロント表示用の概算計算用のため緩めの検証に留める。
const ConfirmationBodySchema = z.object({
  symbol: z.string().min(1, 'symbol は必須です'),
  side: z.string().min(1, 'side は必須です'),
  price: z.number().positive('price は正の数値で指定してください'),
  quantity: z.number().positive('quantity は正の数値で指定してください'),
});

export class OrderController {
  private noteService: TradeNoteService;
  private marketService: MarketDataService;
  private matchResultRepository: MatchResultRepository;

  constructor() {
    this.noteService = new TradeNoteService();
    this.marketService = new MarketDataService();
    this.matchResultRepository = new MatchResultRepository();
  }

  /**
   * 一致ノートをもとに注文プリセットを生成する
   */
  generatePreset = async (req: Request, res: Response): Promise<void> => {
    try {
      const { noteId } = req.params;
      const note = await this.noteService.getNoteById(noteId, req.user!.userId);

      if (!note) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }

      // 現在の市場データを取得
      const currentMarket = await this.marketService.getCurrentMarketData(note.symbol);

      const latestMatch = await this.matchResultRepository.findLatestForNote(
        note.id,
        req.user!.userId
      );

      const confidenceDetail = calculateOrderPresetConfidenceDetail({
        note,
        currentPrice: currentMarket.close,
        latestMatch,
      });

      // 過去ノートと現在市場データに基づいてプリセットを生成
      const preset: OrderPreset = {
        symbol: note.symbol,
        side: note.side,
        suggestedPrice: currentMarket.close,
        suggestedQuantity: note.quantity,
        basedOnNoteId: note.id,
        confidence: confidenceDetail.confidence,
        confidenceSource: confidenceDetail.source,
        confidenceReasons: confidenceDetail.reasons,
      };

      res.json({ preset });
    } catch (error) {
      console.error('Error generating preset:', error);
      // 本番環境では内部エラーの詳細を隠蔽
      res.status(500).json({ error: '注文プリセットの生成に失敗しました' });
    }
  };

  /**
   * 注文確認データを取得
   * 注意: 本システムは自動売買を行いません。これは参考情報のみを提供します。
   */
  getConfirmation = (req: Request, res: Response): Promise<void> => {
    try {
      // Zod で req.body を具体型に narrow
      const parsed = ConfirmationBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: '必須項目が不足しています（symbol, side, price, quantity）',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
        return Promise.resolve();
      }
      const { symbol, side, price, quantity } = parsed.data;

      // 概算コストを計算（参考値）
      const estimatedCost = price * quantity;
      const estimatedFee = estimatedCost * 0.001; // 0.1% 手数料想定

      res.json({
        confirmation: {
          symbol,
          side,
          price,
          quantity,
          estimatedCost,
          estimatedFee,
          total: estimatedCost + estimatedFee,
          // 重要: 自動売買ではなく参考情報であることを明示
          warning: 'これは参考情報です。本システムは自動売買を行いません。実際の注文は取引所で行ってください。',
        }
      });
    } catch (error) {
      console.error('Error getting confirmation:', error);
      // 本番環境では内部エラーの詳細を隠蔽
      res.status(500).json({ error: '注文確認情報の取得に失敗しました' });
    }
    return Promise.resolve();
  };
}

function clampConfidence(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0.05;
  return Math.min(max, Math.max(0.05, value));
}

function roundConfidence(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function confidencePercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function statusAdjustment(status: TradeNote['status']): number {
  switch (status) {
    case 'active':
      return 0;
    case 'draft':
      return -0.1;
    case 'archived':
      return -0.2;
  }
}

function statusAdjustmentReason(status: TradeNote['status']): string | null {
  switch (status) {
    case 'active':
      return null;
    case 'draft':
      return '下書きノートのため信頼度を10.0%減点';
    case 'archived':
      return 'アーカイブ済みノートのため信頼度を20.0%減点';
  }
}

function hasIndicatorEvidence(note: TradeNote): boolean {
  const baseIndicatorFound = note.marketContext.indicators
    ? Object.values(note.marketContext.indicators).some(
      (value) => typeof value === 'number' && Number.isFinite(value)
    )
    : false;

  const customIndicatorFound = note.marketContext.calculatedIndicators
    ? Object.values(note.marketContext.calculatedIndicators).some(
      (value) => typeof value === 'number' && Number.isFinite(value)
    )
    : false;

  return baseIndicatorFound || customIndicatorFound;
}

function finiteFeatureRatio(features: number[]): number {
  if (features.length === 0) return 0;
  const validCount = features.filter((value) => Number.isFinite(value)).length;
  return validCount / features.length;
}

function priceProximityScore(noteEntryPrice: number, currentPrice: number): number {
  if (noteEntryPrice <= 0 || currentPrice <= 0) return 0;
  const deviation = Math.abs(currentPrice - noteEntryPrice) / noteEntryPrice;
  // 10% 以上乖離している場合は価格近接度を加点しない
  return Math.max(0, 1 - deviation / 0.1);
}

interface OrderPresetConfidenceDetail {
  readonly confidence: number;
  readonly source: OrderPresetConfidenceSource;
  readonly reasons: string[];
}

/**
 * 注文プリセットの信頼度と表示用の算出根拠を返す。
 * 最新マッチがある場合は一致判定スコアを主軸にし、無い場合はノートの情報量から保守的に推定する。
 */
export function calculateOrderPresetConfidenceDetail(input: {
  readonly note: TradeNote;
  readonly currentPrice: number;
  readonly latestMatch: LatestMatchForNote | null;
}): OrderPresetConfidenceDetail {
  const { note, currentPrice, latestMatch } = input;

  if (latestMatch) {
    let confidence = latestMatch.score;
    const reasons = [
      `最新マッチスコア ${confidencePercent(latestMatch.score)} を主軸に算出`,
    ];
    if (latestMatch.score < latestMatch.threshold) {
      confidence = Math.min(confidence, 0.49);
      reasons.push(`一致しきい値 ${confidencePercent(latestMatch.threshold)} 未満のため上限を49.0%に制限`);
    }
    if (!latestMatch.trendMatched) {
      confidence -= 0.05;
      reasons.push('トレンド不一致のため信頼度を5.0%減点');
    }
    if (!latestMatch.priceRangeMatched) {
      confidence -= 0.05;
      reasons.push('価格レンジ不一致のため信頼度を5.0%減点');
    }

    const noteStatusAdjustment = statusAdjustment(note.status);
    confidence += noteStatusAdjustment;
    const noteStatusReason = statusAdjustmentReason(note.status);
    if (noteStatusReason) reasons.push(noteStatusReason);

    if (confidence > 0.95) {
      reasons.push('最新マッチ由来の信頼度上限を95.0%に制限');
    }

    return {
      confidence: roundConfidence(clampConfidence(confidence, 0.95)),
      source: 'latest_match',
      reasons,
    };
  }

  let confidence = 0.35;
  const reasons = ['最新マッチが無いためノート情報量から保守的に推定'];
  if (note.status === 'active') {
    confidence += 0.15;
    reasons.push('有効ノートのため信頼度を15.0%加点');
  }
  if (note.quantity > 0) {
    confidence += 0.05;
    reasons.push('数量が記録されているため信頼度を5.0%加点');
  }
  if (note.aiSummary.trim().length > 0) {
    confidence += 0.05;
    reasons.push('AI要約が記録されているため信頼度を5.0%加点');
  }

  const featureCoverage = finiteFeatureRatio(note.features);
  confidence += featureCoverage * 0.2;
  if (featureCoverage > 0) {
    reasons.push(`特徴量カバレッジ ${confidencePercent(featureCoverage)} を反映`);
  }

  if (hasIndicatorEvidence(note)) {
    confidence += 0.1;
    reasons.push('インジケーター根拠があるため信頼度を10.0%加点');
  }

  const proximityScore = priceProximityScore(note.entryPrice, currentPrice);
  confidence += proximityScore * 0.2;
  if (proximityScore > 0) {
    reasons.push(`現在価格とノート価格の近接度 ${confidencePercent(proximityScore)} を反映`);
  } else {
    reasons.push('現在価格とノート価格の乖離が大きいため価格近接の加点なし');
  }

  const noteStatusAdjustment = statusAdjustment(note.status);
  confidence += noteStatusAdjustment;
  const noteStatusReason = statusAdjustmentReason(note.status);
  if (noteStatusReason) reasons.push(noteStatusReason);

  // 最新マッチが無い推定値は過信しない。実際の一致スコアが出たら上限 0.95 まで使う。
  if (confidence > 0.85) {
    reasons.push('最新マッチが無い推定値のため上限を85.0%に制限');
  }

  return {
    confidence: roundConfidence(clampConfidence(confidence, 0.85)),
    source: 'note_quality',
    reasons,
  };
}

/**
 * 注文プリセットの信頼度だけを返す後方互換ヘルパー。
 */
export function calculateOrderPresetConfidence(input: {
  readonly note: TradeNote;
  readonly currentPrice: number;
  readonly latestMatch: LatestMatchForNote | null;
}): number {
  return calculateOrderPresetConfidenceDetail(input).confidence;
}
