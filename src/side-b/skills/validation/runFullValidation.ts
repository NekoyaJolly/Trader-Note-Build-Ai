/**
 * Skill: run_full_validation (Phase 5.5)
 *
 * Phase 4c 本格検証(WalkForward + MonteCarlo + BuyAndHold + Screening 統合)を実行する。
 * hypothesisValidationService.validateHypothesis() のラッパー。
 *
 * Step D-1: 旧 StrategistAgent を廃止し決定論検証サービスに置換。昇格判定
 * (confirmed/rejected) は BT メトリクス + StatusManager の決定論ロジックのみで行う
 * (LLM 解釈は撤廃)。
 */

import { z } from 'zod';
import type { Skill } from '../types';
import {
  validateHypothesis,
  type PromotionVerdict,
} from '../../services/hypothesisValidationService';

const InputSchema = z.object({
  hypothesisId: z.string().min(1),
  period: z
    .object({
      start: z.string(),
      end: z.string(),
    })
    .optional(),
});

export type RunFullValidationInput = z.infer<typeof InputSchema>;
export type RunFullValidationOutput = PromotionVerdict;

export function createRunFullValidationSkill(
  validateFn: typeof validateHypothesis = validateHypothesis,
): Skill<RunFullValidationInput, RunFullValidationOutput> {
  return {
    name: 'run_full_validation',
    description: [
      'Phase 4c の本格検証(WalkForward/MonteCarlo/BuyAndHold の統合)を実行する。',
      '前提: 仮説は screening_passed 以降の状態であること。',
      '結果: confirmed / rejected / insufficient_data / not_testable のいずれか。',
      '判定は BT メトリクスで機械的に行う (Step D-1 で LLM 解釈は撤廃)。',
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
      },
      required: ['hypothesisId'],
    },
    async execute(raw) {
      const input = InputSchema.parse(raw);
      return validateFn(input.hypothesisId, { period: input.period });
    },
  };
}
