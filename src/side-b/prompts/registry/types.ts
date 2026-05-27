/**
 * Phase 6: プロンプトバージョン台帳の型定義
 *
 * 各エージェントのシステムプロンプトをバージョン管理するための共通型。
 * DB(Prisma PromptVersion)とアプリケーション層で共有する。
 *
 * 設計原則:
 * - agentName は列挙型で固定しない(将来エージェント追加に備える)
 * - ステータスは 'active' | 'experimental' | 'deprecated' | 'rejected' の 4 種
 * - active は 1 エージェント 1 件(アプリケーション層で保証)
 */

export type PromptStatus = 'active' | 'experimental' | 'deprecated' | 'rejected';

export type PromptCreatedBy = 'human' | 'mutation';

export const PROMPT_STATUSES: PromptStatus[] = [
  'active',
  'experimental',
  'deprecated',
  'rejected',
];

export const PROMPT_CREATED_BY_VALUES: PromptCreatedBy[] = [
  'human',
  'mutation',
];

/**
 * プロンプトバージョン本体
 *
 * - `parentVersionId`: 変異元プロンプトの ID
 * - `avgScore` / `usageCount` / `successCount`: `recordUsage` で逐次更新
 * - `approvedAt` / `approvedBy`: 人間承認フロー経由で設定される
 */
export interface PromptVersion {
  id: string;
  agentName: string;
  version: string;
  content: string;
  parentVersionId?: string;
  createdBy: PromptCreatedBy;
  status: PromptStatus;
  notes?: string;
  usageCount: number;
  successCount: number;
  avgScore: number;
  lastUsedAt?: Date;
  approvedAt?: Date;
  approvedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** PromptRegistry.register() への入力(id/updatedAt は自動生成)。 */
export interface RegisterPromptInput {
  agentName: string;
  version: string;
  content: string;
  parentVersionId?: string;
  createdBy: PromptCreatedBy;
  status?: PromptStatus;
  notes?: string;
}

/** 記録された使用成績の差分。 */
export interface RecordUsageInput {
  /** 今回観測されたスコア(0-1 想定、エージェント毎に解釈) */
  score: number;
  /** 成功判定(true なら successCount += 1) */
  success: boolean;
}
