/**
 * Phase 6: エージェント別スコアリング関数
 *
 * Q5 回答に従い、MVP では以下 4 エージェント分のみ実装する:
 * - hypothesis_generator
 * - trend_specialist
 * - oscillator_specialist
 * - volatility_volume_specialist
 *
 * 他エージェントは将来追加。未定義エージェントに対しては undefined が返る。
 *
 * スコアリング原則:
 * - 決定論的である(同じ入出力に対して同じスコア)
 * - 0-1 の範囲(ABTestRunner 側でもクランプされる)
 * - 「出力がスキーマを満たしているか」「構造が豊富か」など *客観評価可能* な観点のみ
 * - 将来の「confirmed 到達率」「勝率」などは recordUsage() 側で別途記録する
 */

import type { ScoringFunction } from './types';
import type { JsonValue } from '../../../utils/jsonValue';

/**
 * HypothesisGenerator: 構造バリデーション通過率 + 仮説件数 + 推論長 の合成スコア。
 *
 * - 仮説が 0 件なら 0
 * - 仮説 3 件以上 + 全て reasoning に 20 文字以上 なら高スコア
 * - lensRelevance を含む仮説の比率でボーナス
 */
export const hypothesisGeneratorScoreFn: ScoringFunction<
  object,
  {
    hypotheses?: Array<{
      statement?: string;
      reasoning?: string;
      conditions?: JsonValue[];
      lensRelevance?: Record<string, number>;
    }>;
  }
> = (_input, output) => {
  const hypotheses = output?.hypotheses ?? [];
  if (hypotheses.length === 0) return 0;

  const countScore = Math.min(hypotheses.length / 3, 1); // 3 件以上で満点
  const reasoningScore =
    hypotheses.filter((h) => (h.reasoning ?? '').length >= 20).length /
    hypotheses.length;
  const conditionScore =
    hypotheses.filter((h) => Array.isArray(h.conditions) && h.conditions.length >= 2)
      .length / hypotheses.length;
  const relevanceScore =
    hypotheses.filter(
      (h) => h.lensRelevance && Object.keys(h.lensRelevance).length > 0,
    ).length / hypotheses.length;

  return 0.3 * countScore + 0.3 * reasoningScore + 0.3 * conditionScore + 0.1 * relevanceScore;
};

/**
 * 専門家(Trend/Oscillator/VolatilityVolume)共通のスコア関数。
 *
 * - interpretation の長さ(人間語翻訳の充実度)
 * - confidence が妥当な範囲(0.1-0.95)にあるか
 * - 必須フィールドが揃っているか
 */
function specialistScoreBase(
  output: {
    interpretation?: string;
    confidence?: number;
  },
  requiredFields: string[],
): number {
  const obj = output as Record<string, JsonValue | undefined>;
  const fieldsFilled =
    requiredFields.filter((k) => obj[k] !== undefined && obj[k] !== null).length /
    requiredFields.length;
  const interpretation = output?.interpretation ?? '';
  const interpScore = Math.min(interpretation.length / 80, 1); // 80 文字で満点
  const conf = output?.confidence ?? 0;
  const confInRange = conf >= 0.1 && conf <= 0.95 ? 1 : 0.3;

  return 0.5 * fieldsFilled + 0.3 * interpScore + 0.2 * confInRange;
}

export const trendSpecialistScoreFn: ScoringFunction<
  object,
  {
    trendState?: string;
    trendStrength?: number;
    trendMaturity?: string;
    keyLevels?: { support?: number[]; resistance?: number[] };
    interpretation?: string;
    confidence?: number;
  }
> = (_input, output) =>
  specialistScoreBase(output, [
    'trendState',
    'trendStrength',
    'trendMaturity',
    'keyLevels',
    'interpretation',
    'confidence',
  ]);

export const oscillatorSpecialistScoreFn: ScoringFunction<
  object,
  {
    momentum?: string;
    divergence?: string;
    interpretation?: string;
    confidence?: number;
  }
> = (_input, output) =>
  specialistScoreBase(output, ['momentum', 'divergence', 'interpretation', 'confidence']);

export const volatilityVolumeSpecialistScoreFn: ScoringFunction<
  object,
  {
    volatilityRegime?: string;
    breakoutRisk?: string;
    volumeSignal?: string;
    interpretation?: string;
    confidence?: number;
  }
> = (_input, output) =>
  specialistScoreBase(output, [
    'volatilityRegime',
    'breakoutRisk',
    'volumeSignal',
    'interpretation',
    'confidence',
  ]);

/** エージェント名 → スコア関数 のマッピング(MVP 実装分のみ)。 */
export const SCORING_FUNCTIONS: Record<string, ScoringFunction<object, object>> = {
  hypothesis_generator: hypothesisGeneratorScoreFn,
  trend_specialist: trendSpecialistScoreFn,
  oscillator_specialist: oscillatorSpecialistScoreFn,
  volatility_volume_specialist: volatilityVolumeSpecialistScoreFn,
};

/**
 * エージェント名に対応するスコア関数を返す。未実装エージェントは null。
 * 将来 MVP に含まれないエージェントのスコア関数を追加する場合はここに追記。
 */
export function getScoringFunction(
  agentName: string,
): ScoringFunction<object, object> | null {
  return SCORING_FUNCTIONS[agentName] ?? null;
}
