/**
 * EvolutionJob 単体テスト (PR-1: sideBScheduler 責務分離リファクタリング)
 *
 * 主要ケースは既存の `sideBScheduler.evolutionMultiGen.test.ts` /
 * `sideBScheduler.evolutionCarryRetention.test.ts` が引き続きカバーする (= delegation 経由)。
 * 本ファイルは Job 単体で意味のある最小ケース (純粋関数の境界値 + env 解釈) のみを置く。
 *
 * Phase 7 (テスト整理) で詳細ケースをここに移植する想定。
 *
 * 設計書: docs/side-b/sideb_scheduler_refactor_agent_prompt.md Phase 2 完了条件
 */

import { EvolutionJob, readEvolutionEnvOverrides } from '../jobs/evolutionJob';
import { MULTI_GENERATION_DEFAULTS } from '../evolution/multiGenerationRunner';

describe('EvolutionJob.clampGenerations', () => {
  it('1 はそのまま', () => {
    expect(EvolutionJob.clampGenerations(1)).toBe(1);
  });

  it('maxGenerations はそのまま', () => {
    expect(EvolutionJob.clampGenerations(MULTI_GENERATION_DEFAULTS.maxGenerations)).toBe(
      MULTI_GENERATION_DEFAULTS.maxGenerations,
    );
  });

  it('0 は 1 に clamp', () => {
    expect(EvolutionJob.clampGenerations(0)).toBe(1);
  });

  it('負数は 1 に clamp', () => {
    expect(EvolutionJob.clampGenerations(-5)).toBe(1);
  });

  it('maxGenerations 超過は maxGenerations に clamp', () => {
    expect(EvolutionJob.clampGenerations(MULTI_GENERATION_DEFAULTS.maxGenerations + 10)).toBe(
      MULTI_GENERATION_DEFAULTS.maxGenerations,
    );
  });

  it('小数は floor で整数化してから clamp', () => {
    expect(EvolutionJob.clampGenerations(2.9)).toBe(2);
    expect(EvolutionJob.clampGenerations(0.5)).toBe(1);
  });
});

describe('readEvolutionEnvOverrides', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('env が一切設定されていなければ空オブジェクト', () => {
    delete process.env.EVOLUTION_GENERATIONS;
    delete process.env.EVOLUTION_ADAPTIVE_BUDGET;
    delete process.env.EVOLUTION_QD_ARCHIVE;
    delete process.env.EVOLUTION_QD_PARENT_LIMIT;
    delete process.env.AUTO_EVOLUTION;
    expect(readEvolutionEnvOverrides()).toEqual({});
  });

  it('EVOLUTION_GENERATIONS の有効値は反映される', () => {
    process.env.EVOLUTION_GENERATIONS = '3';
    expect(readEvolutionEnvOverrides()).toEqual({ evolutionGenerations: 3 });
  });

  it('EVOLUTION_GENERATIONS の不正値 (小数表記) は warning + 無視', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.EVOLUTION_GENERATIONS = '2.9';
    expect(readEvolutionEnvOverrides()).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('EVOLUTION_GENERATIONS=2.9'),
    );
    warnSpy.mockRestore();
  });

  it('AUTO_EVOLUTION=true で autoEvolution が true として反映される', () => {
    process.env.AUTO_EVOLUTION = 'true';
    expect(readEvolutionEnvOverrides()).toEqual({ autoEvolution: true });
  });
});
