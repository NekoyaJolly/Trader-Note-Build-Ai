/**
 * Skill: record_lesson (Phase 5.5)
 *
 * AgentMemory.addLesson() のラッパー。学びを記録する。
 *
 * ⚠️ 使用ガイドライン(運用ルール):
 * - 現状の想定呼び出し元は **Reflection AI** と **Strategist Agent** のみ
 *   - Reflection AI: トレード振り返りからの学び
 *   - Strategist Agent: 検証結果の解釈からの学び
 * - 他エージェントからの直接呼び出しは**非推奨**
 * - 将来、日次サマリーシステムが実装された後は、個別呼び出しは完全に非推奨となる予定
 * - スキル自体は誰からでも呼び出し可能だが、運用ルールとして上記を守ること
 *
 * メタデータ(source / linkedNoteIds / linkedHypothesisIds)は日次サマリー
 * システムでの集計・追跡のために早い段階から蓄積しておく。
 */

import { z } from 'zod';
import type { Skill } from '../types';
import {
  agentMemory as defaultAgentMemory,
  type AgentMemory,
  type LessonMetadata,
  LESSON_SOURCES,
} from '../../agent/agentMemory';

const InputSchema = z.object({
  lesson: z.string().min(1).max(500),
  symbol: z.string().min(1),
  tradeId: z.string().optional(),
  source: z.enum(LESSON_SOURCES).optional(),
  linkedNoteIds: z.array(z.string()).optional(),
  linkedHypothesisIds: z.array(z.string()).optional(),
});

export type RecordLessonInput = z.infer<typeof InputSchema>;
export interface RecordLessonOutput {
  recorded: true;
  symbol: string;
}

export function createRecordLessonSkill(
  memory: AgentMemory = defaultAgentMemory,
): Skill<RecordLessonInput, RecordLessonOutput> {
  return {
    name: 'record_lesson',
    description: [
      'AgentMemory に学びを記録する。シンボル別管理 + 類似判定 + 確信ルール昇格が自動で走る。',
      '【運用ルール】現状の呼び出し元は Reflection AI / Strategist Agent のみを想定。',
      '他エージェントからの直接呼び出しは非推奨。将来の日次サマリーシステム実装後は個別呼び出しは完全に非推奨となる予定。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        lesson: { type: 'string', description: '学びのテキスト(1-500文字)' },
        symbol: { type: 'string', description: '対象シンボル' },
        tradeId: { type: 'string', description: '関連トレード ID(任意)' },
        source: {
          type: 'string',
          enum: [...LESSON_SOURCES],
          description: '学びの発生源(reflection / strategist / discovery / other)',
        },
        linkedNoteIds: {
          type: 'array',
          items: { type: 'string' },
          description: '関連する AITradeNote の ID 群(任意)',
        },
        linkedHypothesisIds: {
          type: 'array',
          items: { type: 'string' },
          description: '関連する EdgeHypothesis の ID 群(任意)',
        },
      },
      required: ['lesson', 'symbol'],
    },
    async execute(raw) {
      const input = InputSchema.parse(raw);
      const metadata: LessonMetadata | undefined =
        input.source || input.linkedNoteIds || input.linkedHypothesisIds
          ? {
              source: input.source,
              linkedNoteIds: input.linkedNoteIds,
              linkedHypothesisIds: input.linkedHypothesisIds,
            }
          : undefined;
      await memory.addLesson(input.lesson, input.symbol, input.tradeId, metadata);
      return { recorded: true, symbol: input.symbol };
    },
  };
}
