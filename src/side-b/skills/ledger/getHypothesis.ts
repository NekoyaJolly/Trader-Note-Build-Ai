/**
 * Skill: get_hypothesis (Phase 5.5)
 *
 * EdgeLedger.get(id) のラッパー。単一仮説の詳細を取得する。
 * 存在しない場合は null を返す(エラーではない)。
 */

import { z } from 'zod';
import type { Skill } from '../types';
import {
  edgeLedger as defaultEdgeLedger,
  type EdgeLedger,
} from '../../ledger/EdgeLedger';
import type { EdgeHypothesis } from '../../models/edgeHypothesis';

const InputSchema = z.object({
  id: z.string().min(1),
});

export type GetHypothesisInput = z.infer<typeof InputSchema>;
export type GetHypothesisOutput = EdgeHypothesis | null;

export function createGetHypothesisSkill(
  ledger: EdgeLedger = defaultEdgeLedger,
): Skill<GetHypothesisInput, GetHypothesisOutput> {
  return {
    name: 'get_hypothesis',
    description:
      'EdgeLedger から指定 ID の仮説を1件取得する。見つからない場合は null を返す。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '仮説 ID' },
      },
      required: ['id'],
    },
    async execute(raw) {
      const { id } = InputSchema.parse(raw);
      return ledger.get(id);
    },
  };
}
