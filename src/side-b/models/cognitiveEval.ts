/**
 * 認知層出力の評価 (LLM-as-judge) スキーマ — P1: 認知層評価ハーネス
 *
 * 背景: 進化ループの戦略は BT (WF/OOS/MC/BH) で客観評価できるが、認知層の
 * 「解釈・提案」出力 (researchAIService の MarketAnalysis、将来の FundamentalsThesis 等) は
 * BT で測れない。Anthropic「Building Effective Agents」/「Multi-agent research system」の
 * 推奨に沿い、LLM-as-judge で rubric の各次元を 0..1 採点する。
 *
 * ドメイン原則との整合: **LLM は各次元の採点 (構造発見/解釈) のみ**を行い、
 * **総合スコアと合否は重み付け集計 (決定論コード)** で決める (`aggregateVerdict`)。
 * LLM が出す overall 値は信用しない。
 */
import { z } from 'zod';

/** rubric の 1 次元。weight は次元間の相対重み (合計が 1 でなくてよい、集計時に正規化)。 */
export const RubricDimensionSchema = z.object({
  /** 機械可読キー (judge 出力との突き合わせに使う) */
  key: z.string().min(1),
  /** 人間可読ラベル (日本語) */
  label: z.string().min(1),
  /** judge への採点基準説明 (何を 1.0 / 0.0 とみなすか) */
  description: z.string().min(1),
  /** 相対重み (>0)。集計時に総和で正規化する */
  weight: z.number().positive(),
});
export type RubricDimension = z.infer<typeof RubricDimensionSchema>;

/** 評価 rubric。対象 (MarketAnalysis / FundamentalsThesis 等) ごとに定義する。 */
export const CognitiveRubricSchema = z.object({
  /** rubric 識別名 (例: 'market_analysis_v1') */
  name: z.string().min(1),
  /** 評価対象の説明 (judge プロンプトに注入) */
  targetDescription: z.string().min(1),
  dimensions: z.array(RubricDimensionSchema).min(1),
  /** 合否しきい値 (正規化後 overallScore がこれ以上で passed=true)。既定 0.6。 */
  passThreshold: z.number().min(0).max(1).default(0.6),
});
export type CognitiveRubric = z.infer<typeof CognitiveRubricSchema>;

/** judge が 1 次元に付ける採点。 */
export const DimensionScoreSchema = z.object({
  dimension: z.string().min(1),
  /** 0.0 (不可) 〜 1.0 (理想) */
  score: z.number().min(0).max(1),
  /** 採点理由 (日本語、接地の根拠) */
  reason: z.string(),
});
export type DimensionScore = z.infer<typeof DimensionScoreSchema>;

/**
 * judge LLM の生出力スキーマ。**dimensionScores のみ** を LLM に出させ、
 * overall / passed は決定論集計するため judge には出させない (出しても無視)。
 */
export const JudgeRawOutputSchema = z.object({
  dimensionScores: z.array(DimensionScoreSchema).min(1),
  /** 全体所感 (人間が読むサマリ、判定には使わない) */
  summary: z.string().default(''),
});
export type JudgeRawOutput = z.infer<typeof JudgeRawOutputSchema>;

/** 集計後の最終評定。overallScore / passed は決定論集計の結果。 */
export const CognitiveEvalVerdictSchema = z.object({
  rubricName: z.string(),
  /** 次元別スコア (judge 由来、欠落次元は score=0 で補完される) */
  dimensionScores: z.array(DimensionScoreSchema),
  /** 重み正規化した加重平均 (0..1)。決定論集計。 */
  overallScore: z.number().min(0).max(1),
  /** overallScore >= passThreshold */
  passed: z.boolean(),
  /** 集計に使った閾値 (監査用) */
  passThreshold: z.number().min(0).max(1),
  /** judge の所感 */
  summary: z.string(),
  /** judge 由来で欠落し score=0 補完された次元キー (観測用) */
  missingDimensions: z.array(z.string()),
});
export type CognitiveEvalVerdict = z.infer<typeof CognitiveEvalVerdictSchema>;
