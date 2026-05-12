/**
 * PromptEvolutionJob 単体テスト (PR-4 / Phase 5、PR #162 Copilot review 対応)
 *
 * 薄いラッパーの責務を固定化:
 * - runPromptEvolutionCycle の結果をそのまま返す
 * - 起動ログ / サマリログを出力
 * - onCompleted が成功時に呼ばれる
 *
 * 本ファイルは Scheduler 連携用 Job (src/side-b/jobs/promptEvolutionJob.ts) の
 * テスト。本体実装 (src/side-b/prompts/registry/promptEvolutionJob.ts の
 * runPromptEvolutionCycle) のテストは別ファイル (prompts/promptEvolutionJob.test.ts)。
 */

const mockRunPromptEvolutionCycle = jest.fn();

jest.mock('../prompts/registry/promptEvolutionJob', () => ({
  runPromptEvolutionCycle: mockRunPromptEvolutionCycle,
}));

import { PromptEvolutionJob } from '../jobs/promptEvolutionJob';
import type { SideBSchedulerConfig } from '../jobs/sideBScheduler';

function makeDeps() {
  const addError = jest.fn();
  const log = jest.fn();
  return { deps: { addError, log }, addError, log };
}

const minimalConfig = {} as SideBSchedulerConfig;

describe('PromptEvolutionJob (Scheduler ラッパー)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runPromptEvolutionCycle の結果をそのまま返す', async () => {
    const expected = {
      reports: [
        {
          agentName: 'MutationAgent',
          newExperimentalIds: ['exp1', 'exp2'],
          rejectedIds: ['rej1'],
          promotionCandidates: [],
          errors: [],
        },
      ],
    };
    mockRunPromptEvolutionCycle.mockResolvedValue(expected);
    const { deps } = makeDeps();
    const job = new PromptEvolutionJob(deps);

    const result = await job.run(minimalConfig);

    expect(result).toBe(expected);
    expect(mockRunPromptEvolutionCycle).toHaveBeenCalledTimes(1);
  });

  it('起動ログ + エージェント別サマリログを出力', async () => {
    mockRunPromptEvolutionCycle.mockResolvedValue({
      reports: [
        {
          agentName: 'StrategistAgent',
          newExperimentalIds: ['x1', 'x2', 'x3'],
          rejectedIds: ['y1'],
          promotionCandidates: ['z1', 'z2'],
          errors: [],
        },
        {
          agentName: 'DiscoveryAgent',
          newExperimentalIds: [],
          rejectedIds: [],
          promotionCandidates: [],
          errors: ['boom'],
        },
      ],
    });
    const { deps, log } = makeDeps();
    const job = new PromptEvolutionJob(deps);

    await job.run(minimalConfig);

    expect(log).toHaveBeenCalledWith(expect.stringContaining('[PromptEvolution] 月次プロンプト進化を実行'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('agent=StrategistAgent'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('new=3'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('agent=DiscoveryAgent'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('errors=1'));
  });

  it('成功時に onCompleted が呼ばれる', async () => {
    mockRunPromptEvolutionCycle.mockResolvedValue({ reports: [] });
    const onCompleted = jest.fn();
    const { deps } = makeDeps();
    const job = new PromptEvolutionJob(deps, { onCompleted });

    await job.run(minimalConfig);

    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(onCompleted).toHaveBeenCalledWith(expect.any(Date));
  });

  it('runPromptEvolutionCycle が throw した場合は throw が伝播する', async () => {
    mockRunPromptEvolutionCycle.mockRejectedValue(new Error('cycle failed'));
    const onCompleted = jest.fn();
    const { deps } = makeDeps();
    const job = new PromptEvolutionJob(deps, { onCompleted });

    await expect(job.run(minimalConfig)).rejects.toThrow('cycle failed');
    expect(onCompleted).not.toHaveBeenCalled();
  });
});
