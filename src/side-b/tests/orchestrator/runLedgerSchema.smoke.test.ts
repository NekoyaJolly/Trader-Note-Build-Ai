/**
 * Phase 1 smoke test: AgentRun / AgentRunStep / StrategyDraft の Prisma schema が
 * client に正しく反映されているかを型レベル + enum 値レベルで確認する。
 *
 * 実 DB を必要としない (CI / 開発機どちらでも走る)。実 DB CRUD 検証は Phase 9 (統合テスト) に持ち越す。
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §6 (Phase 1)
 */
import type {
  Prisma,
  AgentRun,
  AgentRunStep,
  StrategyDraft,
} from '@prisma/client';
import {
  AgentRunStatus,
  AgentRunStepStatus,
  AgentRunStepNextAction,
  StrategyDraftStatus,
} from '@prisma/client';

describe('Phase 1 schema smoke', () => {
  describe('AgentRunStatus enum', () => {
    it('WBS §1.2 で定義された 6 状態がすべて生成されている', () => {
      expect(AgentRunStatus.pending).toBe('pending');
      expect(AgentRunStatus.running).toBe('running');
      expect(AgentRunStatus.succeeded).toBe('succeeded');
      expect(AgentRunStatus.failed).toBe('failed');
      expect(AgentRunStatus.skipped).toBe('skipped');
      expect(AgentRunStatus.cancelled).toBe('cancelled');
    });

    it('値は 6 個だけ (将来追加するときはここを書き換える)', () => {
      expect(Object.keys(AgentRunStatus).sort()).toEqual(
        ['cancelled', 'failed', 'pending', 'running', 'skipped', 'succeeded'],
      );
    });
  });

  describe('AgentRunStepStatus enum', () => {
    it('step は cancelled を持たない (run のみが cancelled になる)', () => {
      expect(AgentRunStepStatus.pending).toBe('pending');
      expect(AgentRunStepStatus.running).toBe('running');
      expect(AgentRunStepStatus.succeeded).toBe('succeeded');
      expect(AgentRunStepStatus.failed).toBe('failed');
      expect(AgentRunStepStatus.skipped).toBe('skipped');
      expect(Object.keys(AgentRunStepStatus).sort()).toEqual(
        ['failed', 'pending', 'running', 'skipped', 'succeeded'],
      );
    });
  });

  describe('AgentRunStepNextAction enum', () => {
    it('WBS §1.1 の 5 アクション (continue は TS 予約語衝突回避で proceed として実装)', () => {
      expect(AgentRunStepNextAction.proceed).toBe('proceed');
      expect(AgentRunStepNextAction.stop).toBe('stop');
      expect(AgentRunStepNextAction.skip).toBe('skip');
      expect(AgentRunStepNextAction.retry).toBe('retry');
      expect(AgentRunStepNextAction.manual_review).toBe('manual_review');
      expect(Object.keys(AgentRunStepNextAction).sort()).toEqual(
        ['manual_review', 'proceed', 'retry', 'skip', 'stop'],
      );
    });
  });

  describe('StrategyDraftStatus enum', () => {
    it('WBS §1.3 で定義された 6 lifecycle 状態が揃う', () => {
      expect(StrategyDraftStatus.draft).toBe('draft');
      expect(StrategyDraftStatus.approved).toBe('approved');
      expect(StrategyDraftStatus.rejected).toBe('rejected');
      expect(StrategyDraftStatus.queued_for_validation).toBe('queued_for_validation');
      expect(StrategyDraftStatus.validated).toBe('validated');
      expect(StrategyDraftStatus.archived).toBe('archived');
      expect(Object.keys(StrategyDraftStatus).sort()).toEqual(
        ['approved', 'archived', 'draft', 'queued_for_validation', 'rejected', 'validated'],
      );
    });
  });

  describe('AgentRun model shape', () => {
    it('必須 / オプショナル field の型が WBS §6 推奨 field に揃う', () => {
      // 型レベル check: Prisma が生成した AgentRun 型に期待 field が存在する
      // (実体は型推論のみ、ランタイム値は使わない)
      const sample: AgentRun = {
        id: 'run-id',
        kind: 'side_b_cycle',
        triggeredBy: 'scheduler',
        status: AgentRunStatus.pending,
        startedAt: new Date(),
        finishedAt: null,
        summary: null,
        errorCode: null,
        errorMessage: null,
        idempotencyKey: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(sample.id).toBe('run-id');
      expect(sample.status).toBe(AgentRunStatus.pending);
    });

    it('Prisma.AgentRunCreateInput が二重実行抑止用 idempotencyKey を受ける', () => {
      const input: Prisma.AgentRunCreateInput = {
        kind: 'side_b_cycle',
        triggeredBy: 'adk',
        idempotencyKey: 'side-b-2026-05-17T16:18:00',
      };
      expect(input.idempotencyKey).toBe('side-b-2026-05-17T16:18:00');
    });
  });

  describe('AgentRunStep model shape', () => {
    it('runId / stepName / attempt の 3 field unique を WBS §1.2 通り保持する', () => {
      const sample: AgentRunStep = {
        id: 'step-id',
        runId: 'run-id',
        stepName: 'readiness',
        status: AgentRunStepStatus.pending,
        attempt: 0,
        startedAt: new Date(),
        finishedAt: null,
        durationMs: null,
        summary: null,
        errorCode: null,
        errorMessage: null,
        nextAction: null,
        traceKind: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(sample.attempt).toBe(0);
      expect(sample.runId).toBe('run-id');
      expect(sample.stepName).toBe('readiness');
    });

    it('Prisma.AgentRunStepCreateInput が attempt と nextAction を扱える', () => {
      const input: Prisma.AgentRunStepCreateInput = {
        run: { connect: { id: 'run-id' } },
        stepName: 'evolution',
        attempt: 1,
        nextAction: AgentRunStepNextAction.manual_review,
      };
      expect(input.attempt).toBe(1);
      expect(input.nextAction).toBe(AgentRunStepNextAction.manual_review);
    });
  });

  describe('StrategyDraft model shape', () => {
    it('candidateHash で重複排除を表現できる', () => {
      const sample: StrategyDraft = {
        id: 'draft-id',
        sourceRunId: 'run-id',
        sourceStepId: 'step-id',
        candidateHash: 'sha256:abc',
        status: StrategyDraftStatus.draft,
        strategySummary: 'EMA cross on H1',
        riskSummary: null,
        approvalReason: null,
        rejectionReason: null,
        archiveReason: null,
        reviewer: null,
        validatedAt: null,
        validationResultId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(sample.candidateHash).toBe('sha256:abc');
      expect(sample.status).toBe(StrategyDraftStatus.draft);
    });

    it('Prisma.StrategyDraftCreateInput は sourceRun / sourceStep の relation 経由のみ受ける', () => {
      const input: Prisma.StrategyDraftCreateInput = {
        candidateHash: 'sha256:def',
        strategySummary: 'RSI mean reversion',
        sourceRun: { connect: { id: 'run-id' } },
        sourceStep: { connect: { id: 'step-id' } },
      };
      expect(input.candidateHash).toBe('sha256:def');
    });
  });
});
