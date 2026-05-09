/**
 * Filter Evolution Phase D-1a: AgentMemory.getGenerationLessons テスト
 *
 * GenerationLessonPersister を mock で差し替え、整形 / regime フィルタ / fallback 経路を検証する。
 */

import { agentMemory } from '../../agent/agentMemory';
import type {
  GenerationLessonPersister,
  GenerationLessonRecord,
} from '../../../backend/repositories/generationLessonRepository';

function makeRepoMock(records: GenerationLessonRecord[]): GenerationLessonPersister {
  return {
    create: jest.fn(),
    findRecentByRegime: jest.fn().mockResolvedValue(records),
    deleteOlderThan: jest.fn(),
  };
}

function record(
  partial: Partial<GenerationLessonRecord> & {
    category: GenerationLessonRecord['category'];
    lesson: string;
    regime: string;
    generation: number;
  },
): GenerationLessonRecord {
  return {
    id: partial.id ?? 'rec-1',
    evolutionRunId: partial.evolutionRunId ?? '00000000-0000-0000-0000-000000000099',
    metrics: partial.metrics ?? null,
    confidence: partial.confidence ?? null,
    recordedAt: partial.recordedAt ?? new Date('2026-05-09T00:00:00Z'),
    ...partial,
  };
}

describe('AgentMemory.getGenerationLessons (Phase D-1a)', () => {
  // PR #144 Copilot review #3/#4: 二重キャスト (`as unknown as jest.Mock`) を避けるため、
  // spy を変数に保持して直接 toHaveBeenCalledWith で参照する形に統一。
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('regime 指定で repo.findRecentByRegime を呼び、emoji prefix 付きで整形して返す', async () => {
    const repo = makeRepoMock([
      record({
        category: 'breakthrough',
        regime: 'breakout',
        generation: 3,
        lesson: 'time_session filter で promotion top-K 到達',
      }),
      record({
        category: 'mutation_decay',
        regime: 'breakout',
        generation: 4,
        lesson: 'mutation 由来 child の Lift がほぼ全て 1.0',
      }),
    ]);

    const result = await agentMemory.getGenerationLessons({
      regime: 'breakout',
      limit: 5,
      lessonRepo: repo,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toContain('🎯');
    expect(result[0]).toContain('[breakthrough/breakout gen=3]');
    expect(result[0]).toContain('time_session filter');
    expect(result[1]).toContain('🔻');
    expect(result[1]).toContain('[mutation_decay/breakout gen=4]');

    expect(repo.findRecentByRegime).toHaveBeenCalledWith('breakout', 5);
  });

  it('既知カテゴリそれぞれに対応する emoji prefix が付く', async () => {
    const categories: GenerationLessonRecord['category'][] = [
      'breakthrough',
      'stagnation',
      'mutation_decay',
      'novelty_emerged',
      'regime_shift_detected',
      'filter_efficacy_increased',
      'other',
    ];
    const repo = makeRepoMock(
      categories.map((c, i) => record({ category: c, regime: 'breakout', generation: i, lesson: `lesson-${c}` })),
    );

    const result = await agentMemory.getGenerationLessons({ regime: 'breakout', lessonRepo: repo });

    const expectedEmojis = ['🎯', '📉', '🔻', '✨', '🌪', '🧪', '🌀'];
    expect(result).toHaveLength(7);
    expectedEmojis.forEach((emoji, i) => {
      expect(result[i].startsWith(emoji)).toBe(true);
    });
  });

  it('regime 未指定の呼び出しは現状サポート外、空配列 + warning ログ', async () => {
    const result = await agentMemory.getGenerationLessons({});
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('regime 未指定の呼び出しは現状サポート外'),
    );
  });

  it('repo 例外時は空配列 + warning ログで fallback (= mutation/crossover prompt は空 lessons で動く)', async () => {
    const repo: GenerationLessonPersister = {
      create: jest.fn(),
      findRecentByRegime: jest.fn().mockRejectedValue(new Error('DB connection lost')),
      deleteOlderThan: jest.fn(),
    };

    const result = await agentMemory.getGenerationLessons({
      regime: 'breakout',
      lessonRepo: repo,
    });

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('DB 取得失敗'),
    );
  });

  it('limit 未指定なら 10 件で repo を呼ぶ', async () => {
    const repo = makeRepoMock([]);
    await agentMemory.getGenerationLessons({ regime: 'breakout', lessonRepo: repo });
    expect(repo.findRecentByRegime).toHaveBeenCalledWith('breakout', 10);
  });
});
