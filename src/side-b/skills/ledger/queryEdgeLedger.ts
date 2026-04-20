/**
 * Skill: query_edge_ledger (Phase 5.5)
 *
 * EdgeLedger.find() のラッパー。status / category / source / symbols /
 * search などの条件で仮説を検索する。
 */

import { z } from 'zod';
import type { Skill } from '../types';
import {
  edgeLedger as defaultEdgeLedger,
  type EdgeLedger,
  type EdgeFindResult,
} from '../../ledger/EdgeLedger';
import {
  EDGE_STATUSES,
  EDGE_CATEGORIES,
  EDGE_SOURCES,
  type EdgeStatus,
  type EdgeCategory,
  type EdgeSource,
} from '../../models/edgeHypothesis';

const InputSchema = z.object({
  statuses: z.array(z.enum(EDGE_STATUSES as [EdgeStatus, ...EdgeStatus[]])).optional(),
  categories: z.array(z.enum(EDGE_CATEGORIES as [EdgeCategory, ...EdgeCategory[]])).optional(),
  sources: z.array(z.enum(EDGE_SOURCES as [EdgeSource, ...EdgeSource[]])).optional(),
  symbols: z.array(z.string()).optional(),
  search: z.string().optional(),
  sortBy: z.enum(['newest', 'oldest', 'observation']).optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export type QueryEdgeLedgerInput = z.infer<typeof InputSchema>;
export type QueryEdgeLedgerOutput = EdgeFindResult;

export function createQueryEdgeLedgerSkill(
  ledger: EdgeLedger = defaultEdgeLedger,
): Skill<QueryEdgeLedgerInput, QueryEdgeLedgerOutput> {
  return {
    name: 'query_edge_ledger',
    description: [
      'EdgeLedger(エッジ台帳)から条件に合致する仮説を検索する。',
      'status / category / source / symbols による OR 絞り込み、statement の部分一致、',
      'ソート、ページネーションに対応。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        statuses: {
          type: 'array',
          items: { type: 'string', enum: [...EDGE_STATUSES] },
          description: '絞り込むステータス(OR 結合)。省略時は全て。',
        },
        categories: {
          type: 'array',
          items: { type: 'string', enum: [...EDGE_CATEGORIES] },
          description: '絞り込むカテゴリ(OR 結合)',
        },
        sources: {
          type: 'array',
          items: { type: 'string', enum: [...EDGE_SOURCES] },
          description: '絞り込むソース(OR 結合)',
        },
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'シンボル(仮説が指定シンボルのいずれかを持てばヒット)',
        },
        search: {
          type: 'string',
          description: 'statement に対する大文字小文字無視の部分一致',
        },
        sortBy: {
          type: 'string',
          enum: ['newest', 'oldest', 'observation'],
          description: '既定は newest',
        },
        page: { type: 'number', description: '1-based ページ番号。既定 1' },
        limit: { type: 'number', description: '1 ページ件数。既定 20、上限 100' },
      },
    },
    async execute(raw) {
      const input = InputSchema.parse(raw ?? {});
      return ledger.find(input);
    },
  };
}
