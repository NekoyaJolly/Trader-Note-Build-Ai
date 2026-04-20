/**
 * Skill: register_hypothesis (Phase 5.5)
 *
 * EdgeLedger.create() のラッパー。新規仮説を `unverified` で登録する。
 * LLM が発見した仮説を台帳に追加する用途を想定。
 *
 * 設計原則(CLAUDE.md 原則6): LLM が生成した仮説には必ず人間語の statement と
 * reasoning(統計的根拠)を書かせる。ブラックボックスにしない。
 */

import { z } from 'zod';
import type { Skill } from '../types';
import {
  edgeLedger as defaultEdgeLedger,
  type EdgeLedger,
} from '../../ledger/EdgeLedger';
import {
  EDGE_CATEGORIES,
  EDGE_SOURCES,
  type EdgeCategory,
  type EdgeSource,
  type EdgeHypothesis,
  type MachineReadableCondition,
} from '../../models/edgeHypothesis';

const ConditionSchema = z.object({
  lensName: z.string(),
  featureKey: z.string(),
  op: z.enum(['<', '<=', '>', '>=', '==', '!=', 'between', 'in']),
  value: z.unknown(),
});

const InputSchema = z.object({
  statement: z.string().min(1).max(500),
  category: z.enum(EDGE_CATEGORIES as [EdgeCategory, ...EdgeCategory[]]),
  conditions: z.array(ConditionSchema).min(1),
  expectedDirection: z.enum(['long', 'short', 'either']),
  symbols: z.array(z.string()).min(1),
  timeframes: z.array(z.string()).min(1),
  source: z.enum(EDGE_SOURCES as [EdgeSource, ...EdgeSource[]]),
  statusNote: z.string().optional(),
  lensRelevance: z.record(z.string(), z.number()).optional(),
  parentIds: z.array(z.string()).optional(),
  relatedNoteIds: z.array(z.string()).optional(),
});

export type RegisterHypothesisInput = z.infer<typeof InputSchema>;
export type RegisterHypothesisOutput = EdgeHypothesis;

export function createRegisterHypothesisSkill(
  ledger: EdgeLedger = defaultEdgeLedger,
): Skill<RegisterHypothesisInput, RegisterHypothesisOutput> {
  return {
    name: 'register_hypothesis',
    description: [
      '新規仮説を EdgeLedger に `unverified` ステータスで登録する。',
      'statement は人間語で、conditions はレンズ特徴量への機械判定可能な述語で記述する。',
      'source には発見経路(reflection / discovery / ai_generated 等)を明示する。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        statement: { type: 'string', description: '仮説の人間語記述(80-150文字推奨)' },
        category: { type: 'string', enum: [...EDGE_CATEGORIES] },
        conditions: {
          type: 'array',
          description: '機械判定可能な条件配列。少なくとも1件必要。',
          items: {
            type: 'object',
            properties: {
              lensName: { type: 'string' },
              featureKey: { type: 'string' },
              op: {
                type: 'string',
                enum: ['<', '<=', '>', '>=', '==', '!=', 'between', 'in'],
              },
              value: {
                description: '比較対象値(数値 / 文字列 / 真偽 / [min,max] / 配列)',
              },
            },
            required: ['lensName', 'featureKey', 'op', 'value'],
          },
        },
        expectedDirection: {
          type: 'string',
          enum: ['long', 'short', 'either'],
        },
        symbols: { type: 'array', items: { type: 'string' } },
        timeframes: { type: 'array', items: { type: 'string' } },
        source: { type: 'string', enum: [...EDGE_SOURCES] },
        statusNote: { type: 'string' },
        lensRelevance: {
          type: 'object',
          description: 'レンズごとの関連度スコア { lensName: 0-1 }',
        },
        parentIds: { type: 'array', items: { type: 'string' } },
        relatedNoteIds: { type: 'array', items: { type: 'string' } },
      },
      required: [
        'statement',
        'category',
        'conditions',
        'expectedDirection',
        'symbols',
        'timeframes',
        'source',
      ],
    },
    async execute(raw) {
      const input = InputSchema.parse(raw);
      return ledger.create({
        statement: input.statement,
        category: input.category,
        conditions: input.conditions as unknown as MachineReadableCondition[],
        expectedDirection: input.expectedDirection,
        status: 'unverified',
        statusNote: input.statusNote,
        symbols: input.symbols,
        timeframes: input.timeframes,
        observationCount: 0,
        winCount: 0,
        lossCount: 0,
        breakevenCount: 0,
        totalPnlPips: 0,
        avgRR: 0,
        source: input.source,
        lensRelevance: input.lensRelevance,
        parentIds: input.parentIds,
        relatedNoteIds: input.relatedNoteIds,
      });
    },
  };
}
