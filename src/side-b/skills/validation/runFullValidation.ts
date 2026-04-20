/**
 * Skill: run_full_validation (Phase 5.5)
 *
 * Phase 4c 本格検証(WalkForward + MonteCarlo + BuyAndHold + Screening 統合)を実行する。
 * StrategistAgent.validate() のラッパー。
 *
 * 昇格判定(confirmed/rejected)は StatusManager の決定論的ロジック、
 * LLM は解釈・改善提案の言語化のみを担当する(CLAUDE.md 原則5)。
 */

import { z } from 'zod';
import type { Skill } from '../types';
import {
  StrategistAgent,
  type PromotionVerdict,
} from '../../agents/StrategistAgent';

const InputSchema = z.object({
  hypothesisId: z.string().min(1),
  period: z
    .object({
      start: z.string(),
      end: z.string(),
    })
    .optional(),
  skipLLM: z.boolean().optional(),
});

export type RunFullValidationInput = z.infer<typeof InputSchema>;
export type RunFullValidationOutput = PromotionVerdict;

export function createRunFullValidationSkill(
  agent: StrategistAgent = new StrategistAgent(),
): Skill<RunFullValidationInput, RunFullValidationOutput> {
  return {
    name: 'run_full_validation',
    description: [
      'Phase 4c の本格検証(WalkForward/MonteCarlo/BuyAndHold の統合)を実行する。',
      '前提: 仮説は screening_passed 以降の状態であること。',
      '結果: confirmed / rejected / insufficient_data / not_testable のいずれか。',
      'LLM 呼び出しは解釈目的のみで、判定には影響しない。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        hypothesisId: { type: 'string', description: '検証する仮説 ID' },
        period: {
          type: 'object',
          description: '検証期間(ISO 日付)。省略時は直近1年',
          properties: {
            start: { type: 'string' },
            end: { type: 'string' },
          },
          required: ['start', 'end'],
        },
        skipLLM: {
          type: 'boolean',
          description: 'LLM 解釈をスキップ(テスト・デバッグ用)',
        },
      },
      required: ['hypothesisId'],
    },
    async execute(raw) {
      const input = InputSchema.parse(raw);
      return agent.validate(input.hypothesisId, {
        period: input.period,
        skipLLM: input.skipLLM,
      });
    },
  };
}
