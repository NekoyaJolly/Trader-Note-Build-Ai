/**
 * Step A-4: BullBearDebate 優勢判定の hookup ロジック (純粋関数) のユニットテスト。
 *
 * aiOrchestrator.generatePlan 本体は NODE_ENV='test' で Debate がスキップされるため、
 * hookup ロジックが実走らないと回帰検知不能 (PR #271 Copilot review #2)。
 * 純粋関数として切り出した debateDirectionHookup.ts を対象に直接検証する。
 */

import { applyDebateDirectionToScenarios } from '../../orchestrator/debateDirectionHookup';
import type { AITradeScenario } from '../../models';

function makeScenario(overrides: Partial<AITradeScenario>): AITradeScenario {
  return {
    id: 'test-id',
    name: 'テストシナリオ',
    direction: 'long',
    confidence: 70,
    entryPrice: { type: 'market' },
    stopLoss: { type: 'fixed', priceOffsetPips: 10 },
    takeProfit: { type: 'fixed', priceOffsetPips: 20 },
    riskRewardRatio: 2,
    reasoning: 'test',
    warnings: [],
    ...overrides,
  } as AITradeScenario;
}

describe('applyDebateDirectionToScenarios', () => {
  it('優勢方向と一致するシナリオは confidence を据置 / warning も付与しない', () => {
    const scenarios = [makeScenario({ direction: 'long', confidence: 80 })];
    const result = applyDebateDirectionToScenarios(scenarios, {
      preferredDirection: 'long',
      preferredConfidence: 65,
    });

    expect(result.adjustedScenarios).toHaveLength(1);
    expect(result.adjustedScenarios[0].confidence).toBe(80);
    expect(result.adjustedScenarios[0].warnings).toEqual([]);
    expect(result.aggregatedWarnings).toHaveLength(0);
  });

  it('優勢方向と不一致のシナリオは confidence を 50% 抑制 + warning 付与', () => {
    const scenarios = [makeScenario({ direction: 'long', confidence: 80 })];
    const result = applyDebateDirectionToScenarios(scenarios, {
      preferredDirection: 'short',
      preferredConfidence: 70,
    });

    expect(result.adjustedScenarios[0].confidence).toBe(40);
    expect(result.adjustedScenarios[0].warnings).toHaveLength(1);
    expect(result.adjustedScenarios[0].warnings![0]).toContain('不一致');
    expect(result.adjustedScenarios[0].warnings![0]).toContain('80 → 40');
    expect(result.aggregatedWarnings).toHaveLength(1);
    expect(result.aggregatedWarnings[0]).toContain('テストシナリオ');
  });

  it('優勢方向 neutral では全シナリオに「中立判定」warning を付与 (confidence は据置)', () => {
    const scenarios = [
      makeScenario({ name: 'long シナリオ', direction: 'long', confidence: 80 }),
      makeScenario({ name: 'short シナリオ', direction: 'short', confidence: 60 }),
    ];
    const result = applyDebateDirectionToScenarios(scenarios, {
      preferredDirection: 'neutral',
      preferredConfidence: 50,
    });

    expect(result.adjustedScenarios[0].confidence).toBe(80);
    expect(result.adjustedScenarios[1].confidence).toBe(60);
    expect(result.adjustedScenarios[0].warnings![0]).toContain('中立判定');
    expect(result.adjustedScenarios[1].warnings![0]).toContain('中立判定');
    expect(result.aggregatedWarnings).toHaveLength(2);
  });

  it('NaN confidence のシナリオは 0 にクランプしてから 50% 抑制 (= 0 のまま)', () => {
    const scenarios = [makeScenario({ direction: 'long', confidence: NaN })];
    const result = applyDebateDirectionToScenarios(scenarios, {
      preferredDirection: 'short',
      preferredConfidence: 70,
    });

    expect(result.adjustedScenarios[0].confidence).toBe(0);
    expect(result.adjustedScenarios[0].warnings![0]).toContain('不一致');
  });

  it('範囲外 confidence (= 150) は 100 にクランプしてから 50% 抑制 (= 50)', () => {
    const scenarios = [makeScenario({ direction: 'long', confidence: 150 })];
    const result = applyDebateDirectionToScenarios(scenarios, {
      preferredDirection: 'short',
      preferredConfidence: 70,
    });

    expect(result.adjustedScenarios[0].confidence).toBe(50);
  });

  it('既存の scenarios 配列は変更しない (= shallow copy で新規配列を返す)', () => {
    const original = makeScenario({ direction: 'long', confidence: 80 });
    const scenarios = [original];
    const result = applyDebateDirectionToScenarios(scenarios, {
      preferredDirection: 'short',
      preferredConfidence: 70,
    });

    expect(original.confidence).toBe(80);
    expect(original.warnings).toEqual([]);
    expect(result.adjustedScenarios[0]).not.toBe(original);
  });

  it('複数シナリオで一致 / 不一致が混在する場合、それぞれ正しく処理する', () => {
    const scenarios = [
      makeScenario({ name: 'long-a', direction: 'long', confidence: 80 }),
      makeScenario({ name: 'short-b', direction: 'short', confidence: 60 }),
    ];
    const result = applyDebateDirectionToScenarios(scenarios, {
      preferredDirection: 'long',
      preferredConfidence: 70,
    });

    expect(result.adjustedScenarios[0].confidence).toBe(80);
    expect(result.adjustedScenarios[0].warnings).toEqual([]);
    expect(result.adjustedScenarios[1].confidence).toBe(30);
    expect(result.adjustedScenarios[1].warnings).toHaveLength(1);
    expect(result.aggregatedWarnings).toHaveLength(1);
    expect(result.aggregatedWarnings[0]).toContain('short-b');
  });

  it('既存 warnings を保持しつつ新規 warning を追記する', () => {
    const scenarios = [
      makeScenario({ direction: 'long', confidence: 80, warnings: ['既存 warning 1'] }),
    ];
    const result = applyDebateDirectionToScenarios(scenarios, {
      preferredDirection: 'short',
      preferredConfidence: 70,
    });

    expect(result.adjustedScenarios[0].warnings).toHaveLength(2);
    expect(result.adjustedScenarios[0].warnings![0]).toBe('既存 warning 1');
    expect(result.adjustedScenarios[0].warnings![1]).toContain('不一致');
  });
});
