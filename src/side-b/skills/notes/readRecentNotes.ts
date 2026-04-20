/**
 * Skill: read_recent_notes (Phase 5.5)
 *
 * aiNoteRepository から直近の AI トレードノートを取得する。
 * シンボル指定時は `findAITradeNotesBySymbol`、省略時は全体から `findRecentAITradeNotes`
 * で取得する。
 */

import { z } from 'zod';
import type { Skill } from '../types';
import type { AITradeNote } from '../../models/aiTradeNote';
import {
  findRecentAITradeNotes,
  findAITradeNotesBySymbol,
} from '../../repositories/aiNoteRepository';

const InputSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  symbol: z.string().optional(),
});

export type ReadRecentNotesInput = z.infer<typeof InputSchema>;
export type ReadRecentNotesOutput = AITradeNote[];

/** リポジトリ関数の依存注入用(テストで差し替え可)。 */
export interface ReadRecentNotesDeps {
  findRecent?: (limit: number) => Promise<AITradeNote[]>;
  findBySymbol?: (symbol: string, limit: number) => Promise<AITradeNote[]>;
}

export function createReadRecentNotesSkill(
  deps: ReadRecentNotesDeps = {},
): Skill<ReadRecentNotesInput, ReadRecentNotesOutput> {
  const findRecent = deps.findRecent ?? findRecentAITradeNotes;
  const findBySymbol = deps.findBySymbol ?? findAITradeNotesBySymbol;

  return {
    name: 'read_recent_notes',
    description: [
      '直近の AI トレードノートを取得する。',
      'symbol を指定すると該当シンボルのみ、省略すると全シンボル横断。',
      '振り返りや類似パターン検索のコンテキスト取得に使用する。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: '取得件数。既定: symbol 指定時 20、省略時 50。上限 200',
        },
        symbol: { type: 'string', description: '絞り込むシンボル(省略可)' },
      },
    },
    async execute(raw) {
      const input = InputSchema.parse(raw ?? {});
      if (input.symbol) {
        return findBySymbol(input.symbol, input.limit ?? 20);
      }
      return findRecent(input.limit ?? 50);
    },
  };
}
