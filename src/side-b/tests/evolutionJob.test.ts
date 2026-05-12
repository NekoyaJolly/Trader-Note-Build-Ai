/**
 * EvolutionJob 設定モジュール (純粋関数 / 定数) の単体テスト
 *
 * PR-1 (sideBScheduler 責務分離リファクタリング) で導入。
 *
 * `evolutionJobConfig.ts` のみを import することで、EvolutionLoop / 各 Agent /
 * StrategyPopulation 等の重い依存を引き込まずに純粋ロジックを検証する
 * (PR #159 Copilot review #3 対応、テスト軽量化)。
 *
 * 主要ケース (EvolutionJob 本体の run / runCarryRetention 等) は引き続き
 * sideBScheduler.evolutionMultiGen.test.ts / sideBScheduler.evolutionCarryRetention.test.ts
 * が delegation 経由でカバーする。Phase 7 (テスト整理) で詳細ケースをここに移植する想定。
 *
 * 設計書: docs/side-b/sideb_scheduler_refactor_agent_prompt.md Phase 2 完了条件
 */

import {
  clampEvolutionGenerations,
  readEvolutionEnvOverrides,
  DEFAULT_EVOLUTION_REGIMES,
  EVOLUTION_CARRY_RETENTION_DAYS,
} from '../jobs/evolutionJobConfig';
import { MULTI_GENERATION_DEFAULTS } from '../evolution/multiGenerationRunner';

describe('clampEvolutionGenerations', () => {
  it('1 はそのまま', () => {
    expect(clampEvolutionGenerations(1)).toBe(1);
  });

  it('maxGenerations はそのまま', () => {
    expect(clampEvolutionGenerations(MULTI_GENERATION_DEFAULTS.maxGenerations)).toBe(
      MULTI_GENERATION_DEFAULTS.maxGenerations,
    );
  });

  it('0 は 1 に clamp', () => {
    expect(clampEvolutionGenerations(0)).toBe(1);
  });

  it('負数は 1 に clamp', () => {
    expect(clampEvolutionGenerations(-5)).toBe(1);
  });

  it('maxGenerations 超過は maxGenerations に clamp', () => {
    expect(clampEvolutionGenerations(MULTI_GENERATION_DEFAULTS.maxGenerations + 10)).toBe(
      MULTI_GENERATION_DEFAULTS.maxGenerations,
    );
  });

  it('小数は floor で整数化してから clamp', () => {
    expect(clampEvolutionGenerations(2.9)).toBe(2);
    expect(clampEvolutionGenerations(0.5)).toBe(1);
  });

  // PR #159 Copilot review #1: NaN / Infinity を入れると元実装は NaN / Infinity を返し
  // useMultiGen 判定とログが壊れる。fallback で 1 を返すこと。
  it('NaN は 1 に fallback (useMultiGen 判定を壊さない)', () => {
    expect(clampEvolutionGenerations(NaN)).toBe(1);
  });

  it('Infinity は 1 に fallback (Math.floor(Infinity) は Infinity を返すため)', () => {
    expect(clampEvolutionGenerations(Infinity)).toBe(1);
  });

  it('-Infinity も 1 に fallback', () => {
    expect(clampEvolutionGenerations(-Infinity)).toBe(1);
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

  it('前後の空白は trim で受理する (env 慣行と整合)', () => {
    process.env.EVOLUTION_GENERATIONS = '  3  ';
    expect(readEvolutionEnvOverrides()).toEqual({ evolutionGenerations: 3 });
  });

  it('AUTO_EVOLUTION=true で autoEvolution が true として反映される', () => {
    process.env.AUTO_EVOLUTION = 'true';
    expect(readEvolutionEnvOverrides()).toEqual({ autoEvolution: true });
  });
});

describe('定数', () => {
  it('EVOLUTION_CARRY_RETENTION_DAYS は 14 日', () => {
    expect(EVOLUTION_CARRY_RETENTION_DAYS).toBe(14);
  });

  it('DEFAULT_EVOLUTION_REGIMES は 4 件 (trending_with_pullback / breakout / consolidation / reversal)', () => {
    expect(DEFAULT_EVOLUTION_REGIMES).toEqual([
      'trending_with_pullback',
      'breakout',
      'consolidation',
      'reversal',
    ]);
  });
});
