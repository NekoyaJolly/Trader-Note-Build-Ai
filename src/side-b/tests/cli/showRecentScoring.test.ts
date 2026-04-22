/**
 * Phase 6.6: showRecentScoring CLI のロジックテスト
 *
 * DB 接続部分(main)はテストしない。parseArgs / computeSummary / formatRow の
 * 純粋関数を検証する。
 */

import {
  parseArgs,
  computeSummary,
  formatRow,
} from '../../cli/showRecentScoring';
import type { PromptVersion } from '../../prompts/registry/types';

function mkP(overrides: Partial<PromptVersion>): PromptVersion {
  return {
    id: 'id',
    agentName: 'x',
    version: 'v',
    content: '.',
    createdBy: 'human',
    status: 'active',
    usageCount: 0,
    successCount: 0,
    avgScore: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('parseArgs', () => {
  it('--all', () => {
    const a = parseArgs(['node', 'prog', '--all']);
    expect(a.all).toBe(true);
    expect(a.agent).toBeUndefined();
    expect(a.limit).toBe(20);
  });

  it('--agent <name>', () => {
    const a = parseArgs(['node', 'prog', '--agent', 'hypothesis_generator']);
    expect(a.all).toBe(false);
    expect(a.agent).toBe('hypothesis_generator');
  });

  it('--limit <n> は 100 で clamp', () => {
    const a = parseArgs(['node', 'prog', '--all', '--limit', '500']);
    expect(a.limit).toBe(100);
  });

  it('--limit の非数値は既定値', () => {
    const a = parseArgs(['node', 'prog', '--all', '--limit', 'abc']);
    expect(a.limit).toBe(20);
  });
});

describe('computeSummary', () => {
  it('空配列', () => {
    expect(computeSummary([])).toEqual({ n: 0, totalUsage: 0, weightedAvg: 0, simpleAvg: 0 });
  });

  it('重み付き平均 = sum(avg * usage) / sum(usage)', () => {
    const rows = [
      mkP({ usageCount: 10, avgScore: 0.6 }),
      mkP({ usageCount: 30, avgScore: 0.8 }),
    ];
    const s = computeSummary(rows);
    expect(s.n).toBe(2);
    expect(s.totalUsage).toBe(40);
    // (0.6*10 + 0.8*30) / 40 = (6 + 24) / 40 = 0.75
    expect(s.weightedAvg).toBeCloseTo(0.75);
    // simple avg = (0.6 + 0.8) / 2 = 0.7
    expect(s.simpleAvg).toBeCloseTo(0.7);
  });

  it('全行 usageCount=0 なら weightedAvg=0、simpleAvg は平均', () => {
    const rows = [mkP({ avgScore: 0.4 }), mkP({ avgScore: 0.6 })];
    const s = computeSummary(rows);
    expect(s.weightedAvg).toBe(0);
    expect(s.simpleAvg).toBeCloseTo(0.5);
  });
});

describe('formatRow', () => {
  it('必須情報を含む 1 行を返す', () => {
    const p = mkP({
      agentName: 'trend_specialist',
      status: 'experimental',
      version: 'mut-1',
      usageCount: 12,
      successCount: 9,
      avgScore: 0.72,
      lastUsedAt: new Date('2026-04-23T00:00:00Z'),
    });
    const line = formatRow(p);
    expect(line).toContain('trend_specialist');
    expect(line).toContain('experimental');
    expect(line).toContain('mut-1');
    expect(line).toContain('usage=  12');
    expect(line).toContain('avg=0.720');
    expect(line).toContain('succ=');
    expect(line).toContain('2026-04-23');
  });

  it('usage=0 のとき succ は -', () => {
    const p = mkP({ usageCount: 0 });
    expect(formatRow(p)).toContain('succ=     -');
  });
});
