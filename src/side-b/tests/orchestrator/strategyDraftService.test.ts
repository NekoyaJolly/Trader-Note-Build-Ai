/**
 * StrategyDraftService の状態遷移 / 重複排除 / lifecycle を検証する unit test。
 * 実 DB は使わず、in-memory な StrategyDraftRepository 互換オブジェクトを使う。
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §9 (Phase 4)
 */
/* eslint-disable @typescript-eslint/require-await --
 * in-memory な StrategyDraftRepository 互換オブジェクトは Promise<T> シグネチャを
 * 揃えるためだけに async を付けている (本物の Repository は Prisma で await が必要)。
 */
import type { StrategyDraft, StrategyDraftStatus } from '@prisma/client';
import {
  createStrategyDraftService,
  canTransitionDraft,
  StrategyDraftStateError,
} from '../../services/strategyDraftService';
import type { StrategyDraftRepository } from '../../repositories/strategyDraftRepository';

interface InMemoryStore {
  drafts: Map<string, StrategyDraft>;
}

function createInMemoryRepository(now: () => Date = () => new Date()): {
  repository: StrategyDraftRepository;
  store: InMemoryStore;
} {
  const store: InMemoryStore = { drafts: new Map() };
  let counter = 0;

  const repository: StrategyDraftRepository = {
    async createDraft(input) {
      counter += 1;
      const id = `draft-${counter}`;
      for (const existing of store.drafts.values()) {
        if (existing.candidateHash === input.candidateHash) {
          throw new Error('Unique constraint violation on candidateHash');
        }
      }
      const draft: StrategyDraft = {
        id,
        sourceRunId: input.sourceRunId,
        sourceStepId: input.sourceStepId,
        candidateHash: input.candidateHash,
        status: 'draft',
        strategySummary: input.strategySummary,
        riskSummary: input.riskSummary ?? null,
        approvalReason: null,
        rejectionReason: null,
        archiveReason: null,
        reviewer: null,
        validatedAt: null,
        validationResultId: null,
        createdAt: now(),
        updatedAt: now(),
      };
      store.drafts.set(id, draft);
      return draft;
    },

    async findByCandidateHash(hash) {
      for (const d of store.drafts.values()) {
        if (d.candidateHash === hash) return d;
      }
      return null;
    },

    async findById(draftId) {
      return store.drafts.get(draftId) ?? null;
    },

    async updateDraft(draftId, patch) {
      const existing = store.drafts.get(draftId);
      if (!existing) throw new Error(`Draft ${draftId} not found`);
      const updated: StrategyDraft = {
        ...existing,
        ...patch,
        updatedAt: now(),
      };
      store.drafts.set(draftId, updated);
      return updated;
    },

    async updateDraftIfStatus(draftId, expectedStatus, patch) {
      const existing = store.drafts.get(draftId);
      if (!existing) return null;
      if (existing.status !== expectedStatus) return null;
      const updated: StrategyDraft = {
        ...existing,
        ...patch,
        updatedAt: now(),
      };
      store.drafts.set(draftId, updated);
      return updated;
    },

    async listByStatus(status, limit = 50) {
      return [...store.drafts.values()]
        .filter((d) => d.status === status)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
    },
  };

  return { repository, store };
}

// ============================================================
// canTransitionDraft (pure function)
// ============================================================

describe('canTransitionDraft', () => {
  it('WBS §1.3 の lifecycle 通りに遷移許可される', () => {
    expect(canTransitionDraft('draft', 'approved')).toBe(true);
    expect(canTransitionDraft('draft', 'rejected')).toBe(true);
    expect(canTransitionDraft('draft', 'archived')).toBe(true);
    expect(canTransitionDraft('approved', 'queued_for_validation')).toBe(true);
    expect(canTransitionDraft('approved', 'archived')).toBe(true);
    expect(canTransitionDraft('queued_for_validation', 'validated')).toBe(true);
    expect(canTransitionDraft('queued_for_validation', 'rejected')).toBe(true);
    expect(canTransitionDraft('queued_for_validation', 'archived')).toBe(true);
    expect(canTransitionDraft('validated', 'archived')).toBe(true);
    expect(canTransitionDraft('rejected', 'archived')).toBe(true);
  });

  it('draft → validated / queued_for_validation のスキップは禁止', () => {
    expect(canTransitionDraft('draft', 'validated')).toBe(false);
    expect(canTransitionDraft('draft', 'queued_for_validation')).toBe(false);
  });

  it('rejected → queued_for_validation など逆方向は禁止', () => {
    expect(canTransitionDraft('rejected', 'queued_for_validation')).toBe(false);
    expect(canTransitionDraft('rejected', 'approved')).toBe(false);
    expect(canTransitionDraft('validated', 'queued_for_validation')).toBe(false);
  });

  it('archived は完全終端、どこへも遷移不可', () => {
    const targets: StrategyDraftStatus[] = [
      'draft', 'approved', 'rejected', 'queued_for_validation', 'validated', 'archived',
    ];
    for (const to of targets) {
      expect(canTransitionDraft('archived', to)).toBe(false);
    }
  });

  it('同状態への遷移は禁止', () => {
    expect(canTransitionDraft('draft', 'draft')).toBe(false);
    expect(canTransitionDraft('approved', 'approved')).toBe(false);
  });
});

// ============================================================
// createFromEvolutionCandidate
// ============================================================

describe('createFromEvolutionCandidate', () => {
  it('新規候補は kind=created で Draft を返す (status=draft, sourceRun/Step が保存される)', async () => {
    const { repository } = createInMemoryRepository();
    const service = createStrategyDraftService({ repository });
    const result = await service.createFromEvolutionCandidate(
      {
        candidateHash: 'sha256:abc',
        strategySummary: 'EMA cross H1',
        riskSummary: 'drawdown 5%',
      },
      { sourceRunId: '00000000-0000-4000-8000-000000000100', sourceStepId: '00000000-0000-4000-8000-000000000200' },
    );
    expect(result.kind).toBe('created');
    if (result.kind === 'created') {
      expect(result.draft.status).toBe<StrategyDraftStatus>('draft');
      expect(result.draft.sourceRunId).toBe('00000000-0000-4000-8000-000000000100');
      expect(result.draft.sourceStepId).toBe('00000000-0000-4000-8000-000000000200');
      expect(result.draft.strategySummary).toBe('EMA cross H1');
      expect(result.draft.riskSummary).toBe('drawdown 5%');
    }
  });

  it('同一 candidateHash の重複呼び出しは kind=duplicate で既存 Draft を返す', async () => {
    const { repository } = createInMemoryRepository();
    const service = createStrategyDraftService({ repository });
    const first = await service.createFromEvolutionCandidate(
      { candidateHash: 'sha256:def', strategySummary: 'RSI' },
      { sourceRunId: '00000000-0000-4000-8000-000000000301', sourceStepId: '00000000-0000-4000-8000-000000000401' },
    );
    const second = await service.createFromEvolutionCandidate(
      { candidateHash: 'sha256:def', strategySummary: 'RSI (duplicate)' },
      { sourceRunId: '00000000-0000-4000-8000-000000000302', sourceStepId: '00000000-0000-4000-8000-000000000402' },
    );
    expect(first.kind).toBe('created');
    expect(second.kind).toBe('duplicate');
    if (second.kind === 'duplicate' && first.kind === 'created') {
      expect(second.existing.id).toBe(first.draft.id);
      expect(second.existing.strategySummary).toBe('RSI');
    }
  });

  it('strategySummary が空文字 / 空白のみ → StrategyDraftStateError', async () => {
    const { repository } = createInMemoryRepository();
    const service = createStrategyDraftService({ repository });
    await expect(
      service.createFromEvolutionCandidate(
        { candidateHash: 'sha256:h1-empty', strategySummary: '   ' },
        { sourceRunId: '00000000-0000-4000-8000-000000000010', sourceStepId: '00000000-0000-4000-8000-000000000020' },
      ),
    ).rejects.toBeInstanceOf(StrategyDraftStateError);
  });

  it('long summary は redaction で切り詰められる', async () => {
    const { repository, store } = createInMemoryRepository();
    const service = createStrategyDraftService({ repository });
    const result = await service.createFromEvolutionCandidate(
      { candidateHash: 'sha256:h2-long', strategySummary: 'a'.repeat(2000) },
      { sourceRunId: '00000000-0000-4000-8000-000000000010', sourceStepId: '00000000-0000-4000-8000-000000000020' },
    );
    expect(result.kind).toBe('created');
    if (result.kind === 'created') {
      const stored = store.drafts.get(result.draft.id);
      expect(stored?.strategySummary.length).toBeLessThanOrEqual(1024);
      expect(stored?.strategySummary.endsWith('...')).toBe(true);
    }
  });
});

// ============================================================
// approveDraft / rejectDraft / queueForValidation / markValidated / archiveDraft
// ============================================================

describe('lifecycle transitions', () => {
  it('draft → approved → queued_for_validation → validated', async () => {
    let t = 1000;
    const clock = (): Date => new Date(t);
    const { repository } = createInMemoryRepository(clock);
    const service = createStrategyDraftService({ repository, clock });
    const created = await service.createFromEvolutionCandidate(
      { candidateHash: 'sha256:h-default', strategySummary: 'S' },
      { sourceRunId: '00000000-0000-4000-8000-000000000010', sourceStepId: '00000000-0000-4000-8000-000000000020' },
    );
    if (created.kind !== 'created') throw new Error('expected created');
    const draftId = created.draft.id;

    const approved = await service.approveDraft(draftId, 'neko', 'PF > 1.5');
    expect(approved.status).toBe<StrategyDraftStatus>('approved');
    expect(approved.reviewer).toBe('neko');
    expect(approved.approvalReason).toBe('PF > 1.5');

    const queued = await service.queueForValidation(draftId);
    expect(queued.status).toBe<StrategyDraftStatus>('queued_for_validation');

    t = 5000;
    const validated = await service.markValidated(draftId, 'validation-id-42');
    expect(validated.status).toBe<StrategyDraftStatus>('validated');
    expect(validated.validatedAt?.getTime()).toBe(5000);
    expect(validated.validationResultId).toBe('validation-id-42');
  });

  it('approveDraft: draft 以外から approve は state error', async () => {
    const { repository } = createInMemoryRepository();
    const service = createStrategyDraftService({ repository });
    const created = await service.createFromEvolutionCandidate(
      { candidateHash: 'sha256:h-default', strategySummary: 'S' },
      { sourceRunId: '00000000-0000-4000-8000-000000000010', sourceStepId: '00000000-0000-4000-8000-000000000020' },
    );
    if (created.kind !== 'created') throw new Error('expected created');
    await service.rejectDraft(created.draft.id, 'neko', 'PF too low');
    await expect(
      service.approveDraft(created.draft.id, 'neko'),
    ).rejects.toBeInstanceOf(StrategyDraftStateError);
  });

  it('queueForValidation: approved 以外からは state error', async () => {
    const { repository } = createInMemoryRepository();
    const service = createStrategyDraftService({ repository });
    const created = await service.createFromEvolutionCandidate(
      { candidateHash: 'sha256:h-default', strategySummary: 'S' },
      { sourceRunId: '00000000-0000-4000-8000-000000000010', sourceStepId: '00000000-0000-4000-8000-000000000020' },
    );
    if (created.kind !== 'created') throw new Error('expected created');
    await expect(
      service.queueForValidation(created.draft.id),
    ).rejects.toBeInstanceOf(StrategyDraftStateError);
  });

  it('markValidated: queued_for_validation 以外からは state error', async () => {
    const { repository } = createInMemoryRepository();
    const service = createStrategyDraftService({ repository });
    const created = await service.createFromEvolutionCandidate(
      { candidateHash: 'sha256:h-default', strategySummary: 'S' },
      { sourceRunId: '00000000-0000-4000-8000-000000000010', sourceStepId: '00000000-0000-4000-8000-000000000020' },
    );
    if (created.kind !== 'created') throw new Error('expected created');
    await service.approveDraft(created.draft.id, 'neko');
    await expect(
      service.markValidated(created.draft.id, 'v'),
    ).rejects.toBeInstanceOf(StrategyDraftStateError);
  });

  it('rejectDraft: queued_for_validation 中の Draft も reject 可', async () => {
    const { repository } = createInMemoryRepository();
    const service = createStrategyDraftService({ repository });
    const created = await service.createFromEvolutionCandidate(
      { candidateHash: 'sha256:h-default', strategySummary: 'S' },
      { sourceRunId: '00000000-0000-4000-8000-000000000010', sourceStepId: '00000000-0000-4000-8000-000000000020' },
    );
    if (created.kind !== 'created') throw new Error('expected created');
    await service.approveDraft(created.draft.id, 'neko');
    await service.queueForValidation(created.draft.id);
    const rejected = await service.rejectDraft(created.draft.id, 'neko', 'WF too high');
    expect(rejected.status).toBe<StrategyDraftStatus>('rejected');
    expect(rejected.rejectionReason).toBe('WF too high');
  });

  it('archiveDraft: 任意の終端状態から archived へ', async () => {
    const { repository } = createInMemoryRepository();
    const service = createStrategyDraftService({ repository });
    const created = await service.createFromEvolutionCandidate(
      { candidateHash: 'sha256:h-default', strategySummary: 'S' },
      { sourceRunId: '00000000-0000-4000-8000-000000000010', sourceStepId: '00000000-0000-4000-8000-000000000020' },
    );
    if (created.kind !== 'created') throw new Error('expected created');
    await service.rejectDraft(created.draft.id, 'neko', 'r');
    const archived = await service.archiveDraft(created.draft.id, 'cleanup');
    expect(archived.status).toBe<StrategyDraftStatus>('archived');
    expect(archived.archiveReason).toBe('cleanup');
  });

  it('archived からの再遷移は state error', async () => {
    const { repository } = createInMemoryRepository();
    const service = createStrategyDraftService({ repository });
    const created = await service.createFromEvolutionCandidate(
      { candidateHash: 'sha256:h-default', strategySummary: 'S' },
      { sourceRunId: '00000000-0000-4000-8000-000000000010', sourceStepId: '00000000-0000-4000-8000-000000000020' },
    );
    if (created.kind !== 'created') throw new Error('expected created');
    await service.archiveDraft(created.draft.id, 'cleanup');
    await expect(
      service.approveDraft(created.draft.id, 'neko'),
    ).rejects.toBeInstanceOf(StrategyDraftStateError);
  });

  it('存在しない draftId は state error', async () => {
    const { repository } = createInMemoryRepository();
    const service = createStrategyDraftService({ repository });
    await expect(
      service.approveDraft('missing', 'neko'),
    ).rejects.toBeInstanceOf(StrategyDraftStateError);
  });
});

// ============================================================
// listByStatus / findById
// ============================================================

describe('listByStatus / findById', () => {
  it('listByStatus は status 一致 Draft を新しい順で返す', async () => {
    let t = 1000;
    const clock = (): Date => new Date(t);
    const { repository } = createInMemoryRepository(clock);
    const service = createStrategyDraftService({ repository, clock });
    await service.createFromEvolutionCandidate(
      { candidateHash: 'sha256:list-a', strategySummary: 'A' },
      { sourceRunId: '00000000-0000-4000-8000-000000000010', sourceStepId: '00000000-0000-4000-8000-000000000020' },
    );
    t = 2000;
    await service.createFromEvolutionCandidate(
      { candidateHash: 'sha256:list-b', strategySummary: 'B' },
      { sourceRunId: '00000000-0000-4000-8000-000000000010', sourceStepId: '00000000-0000-4000-8000-000000000020' },
    );
    t = 3000;
    await service.createFromEvolutionCandidate(
      { candidateHash: 'sha256:list-c', strategySummary: 'C' },
      { sourceRunId: '00000000-0000-4000-8000-000000000010', sourceStepId: '00000000-0000-4000-8000-000000000020' },
    );
    const drafts = await service.listByStatus('draft');
    expect(drafts.map((d) => d.candidateHash)).toEqual(['sha256:list-c', 'sha256:list-b', 'sha256:list-a']);
  });

  it('findById で取得できる', async () => {
    const { repository } = createInMemoryRepository();
    const service = createStrategyDraftService({ repository });
    const created = await service.createFromEvolutionCandidate(
      { candidateHash: 'sha256:h-default', strategySummary: 'S' },
      { sourceRunId: '00000000-0000-4000-8000-000000000010', sourceStepId: '00000000-0000-4000-8000-000000000020' },
    );
    if (created.kind !== 'created') throw new Error('expected created');
    const fetched = await service.findById(created.draft.id);
    expect(fetched?.id).toBe(created.draft.id);
  });
});

// ============================================================
// PR #220 Copilot review #1/#2/#7 対応: reason 必須 (空文字 / 空白拒否)
// ============================================================

describe('reason 必須強制 (Copilot review #1/#2/#7)', () => {
  async function makeDraft() {
    const { repository } = createInMemoryRepository();
    const service = createStrategyDraftService({ repository });
    const created = await service.createFromEvolutionCandidate(
      { candidateHash: 'sha256:h-default', strategySummary: 'S' },
      { sourceRunId: '00000000-0000-4000-8000-000000000010', sourceStepId: '00000000-0000-4000-8000-000000000020' },
    );
    if (created.kind !== 'created') throw new Error('expected created');
    return { service, draftId: created.draft.id };
  }

  it('rejectDraft: 空文字の reason は throw する', async () => {
    const { service, draftId } = await makeDraft();
    await expect(service.rejectDraft(draftId, 'neko', '')).rejects.toThrow();
  });

  it('rejectDraft: 空白のみの reason は throw する', async () => {
    const { service, draftId } = await makeDraft();
    await expect(service.rejectDraft(draftId, 'neko', '   ')).rejects.toThrow();
  });

  it('archiveDraft: 空文字の reason は throw する', async () => {
    const { service, draftId } = await makeDraft();
    await expect(service.archiveDraft(draftId, '')).rejects.toThrow();
  });

  it('approveDraft: 空文字の reviewer は throw する', async () => {
    const { service, draftId } = await makeDraft();
    await expect(service.approveDraft(draftId, '   ')).rejects.toThrow();
  });
});

// ============================================================
// PR #220 Copilot review #4 対応: Zod 入力検証
// ============================================================

describe('Zod 入力検証 (Copilot review #4)', () => {
  it('candidateHash が短すぎると ZodError', async () => {
    const { repository } = createInMemoryRepository();
    const service = createStrategyDraftService({ repository });
    await expect(
      service.createFromEvolutionCandidate(
        { candidateHash: 'short', strategySummary: 'S' },
        { sourceRunId: '00000000-0000-4000-8000-000000000010', sourceStepId: '00000000-0000-4000-8000-000000000020' },
      ),
    ).rejects.toThrow();
  });

  it('sourceRunId が UUID 形式でないと ZodError', async () => {
    const { repository } = createInMemoryRepository();
    const service = createStrategyDraftService({ repository });
    await expect(
      service.createFromEvolutionCandidate(
        { candidateHash: 'sha256:valid-hash', strategySummary: 'S' },
        { sourceRunId: 'not-uuid', sourceStepId: '00000000-0000-4000-8000-000000000020' },
      ),
    ).rejects.toThrow();
  });
});

// ============================================================
// PR #220 Copilot review #5/#6 対応: TOCTOU 解消
// ============================================================

describe('TOCTOU 解消 (Copilot review #5/#6)', () => {
  it('同一 draft を draft → approved と draft → rejected で並行遷移しても、1 つだけ成功する', async () => {
    const { repository } = createInMemoryRepository();
    const service = createStrategyDraftService({ repository });
    const created = await service.createFromEvolutionCandidate(
      { candidateHash: 'sha256:race-test', strategySummary: 'S' },
      { sourceRunId: '00000000-0000-4000-8000-000000000010', sourceStepId: '00000000-0000-4000-8000-000000000020' },
    );
    if (created.kind !== 'created') throw new Error('expected created');

    // 同時に approve と reject を投げる
    const results = await Promise.allSettled([
      service.approveDraft(created.draft.id, 'neko'),
      service.rejectDraft(created.draft.id, 'neko', 'PF too low'),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    // 最終 status は approved か rejected のどちらか (両方ではない)
    const final = await service.findById(created.draft.id);
    expect(['approved', 'rejected']).toContain(final?.status);
  });
});
