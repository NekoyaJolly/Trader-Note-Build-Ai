/**
 * Skill: run_screening (Phase 5.5)
 *
 * Phase 4b スクリーニング(Side-A BT による事前絞り込み)を実行する。
 * ScreeningOrchestrator.runScreening() のラッパー。
 *
 * 昇格/棄却の判定自体は StatusManager の決定論的ロジックで行われ、
 * このスキルは LLM 判断を含まない(設計原則: 判定は決定論、LLM は解釈のみ)。
 */

import { z } from 'zod';
import type { Skill } from '../types';
import {
  screeningOrchestrator as defaultOrchestrator,
  type ScreeningOrchestrator,
  type ScreeningRunResult,
} from '../../bridge/ScreeningOrchestrator';

const InputSchema = z.object({
  hypothesisId: z.string().min(1),
  period: z
    .object({
      start: z.string(),
      end: z.string(),
    })
    .optional(),
  matchThreshold: z.number().min(0).max(1).optional(),
  force: z.boolean().optional(),
});

export type RunScreeningInput = z.infer<typeof InputSchema>;
export type RunScreeningOutput = ScreeningRunResult;

export function createRunScreeningSkill(
  orchestrator: ScreeningOrchestrator = defaultOrchestrator,
): Skill<RunScreeningInput, RunScreeningOutput> {
  return {
    name: 'run_screening',
    description: [
      'Phase 4b のスクリーニング(Side-A BT 事前絞り込み)を実行する。',
      '判定は決定論的(PF/勝率/件数)で行われ、screening_passed / rejected / not_testable のいずれかを返す。',
      '結果は自動的に EdgeLedger へ永続化される。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        hypothesisId: { type: 'string', description: '検証する仮説 ID' },
        period: {
          type: 'object',
          description: 'BT 期間(ISO 日付)。省略時は直近1年',
          properties: {
            start: { type: 'string' },
            end: { type: 'string' },
          },
          required: ['start', 'end'],
        },
        matchThreshold: {
          type: 'number',
          description: 'Side-A BT のマッチ閾値。既定 0.6',
        },
        force: {
          type: 'boolean',
          description: 'unverified 以外のステータスにも強制実行する(再検証用)',
        },
      },
      required: ['hypothesisId'],
    },
    async execute(raw) {
      const input = InputSchema.parse(raw);
      return orchestrator.runScreening(input.hypothesisId, {
        period: input.period,
        matchThreshold: input.matchThreshold,
        force: input.force,
      });
    },
  };
}
