/**
 * CurrentAnalysisLens - 既存 MarketAnalysis をラップするレンズ
 *
 * 責務:
 * - input.existingAnalysis に渡された MarketAnalysis を Lens インターフェースに適合させる
 * - 既存の MarketAnalysis 計算ロジックには触らない（ラップのみ）
 *
 * 設計上の決定:
 * - existingAnalysis が渡されていない場合、このレンズは副作用を起こさず
 *   confidence=0 / features={} を返す（CLAUDE.md 原則4「レンズは独立・純粋」に従い、
 *   内部で AI サービスを呼び出したりしない）
 * - 実際の MarketAnalysis 計算は Research AI の責務。このレンズは観察結果の
 *   再配信ポイントでしかない
 *
 * @see docs/design/phase_1_specification.md セクション 4.2
 */

import type { Lens, LensFeature, LensInput } from './types';

export class CurrentAnalysisLens implements Lens {
  readonly name = 'current_analysis';
  readonly version = '1.0.0';
  readonly dependencies = ['symbol', 'existingAnalysis'] as const;

  async compute(input: LensInput): Promise<LensFeature> {
    const start = Date.now();
    const computedAt = new Date();

    if (!input.existingAnalysis) {
      return {
        lensName: this.name,
        lensVersion: this.version,
        features: {},
        computedAt,
        computeDurationMs: Date.now() - start,
        confidence: 0,
      };
    }

    const analysis = input.existingAnalysis;

    const features: Record<string, number | string | boolean> = {
      regime: analysis.regime,
      direction: analysis.direction,
      volatility: analysis.volatility,
      confidence_pct: analysis.confidence,
      trend_strength: analysis.quickScores.trendStrength,
      momentum: analysis.quickScores.momentum,
      volatility_score: analysis.quickScores.volatility,
      support_proximity: analysis.quickScores.supportProximity,
      resistance_proximity: analysis.quickScores.resistanceProximity,
      key_levels_count: analysis.keyLevels.length,
      strong_supports: analysis.keyLevels.filter(
        (l) => l.type === 'support' && l.strength === 'strong'
      ).length,
      strong_resistances: analysis.keyLevels.filter(
        (l) => l.type === 'resistance' && l.strength === 'strong'
      ).length,
    };

    return {
      lensName: this.name,
      lensVersion: this.version,
      features,
      computedAt,
      computeDurationMs: Date.now() - start,
      confidence: analysis.confidence / 100,
    };
  }
}
