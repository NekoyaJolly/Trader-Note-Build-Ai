/**
 * Critical-4 PR #98: dslFromHypothesis のテスト
 *
 * 設計書 (docs/design/pr_98_edge_hypothesis_to_strategy_dsl_agent_prompt.md) 必須 12 件:
 *   1. 構造化済み conditions を持つ EdgeHypothesis を StrategyDSL に変換できる
 *   2. 変換後 DSL が StrategyDSLSchema を通過する
 *   3. metadata に sourceEdgeHypothesisId と sourceEdgeStatus が残る
 *   4. conditions が空なら missing_conditions で ok=false
 *   5. 未対応 direction なら unsupported_direction で ok=false
 *   6. symbol がなければ missing_symbol で ok=false
 *   7. timeframe がなければ missing_timeframe / 警告付き既定値
 *   8. risk rule が必須なのに欠損していれば missing_risk_rule で ok=false
 *   9. schema validation 失敗時に schema_validation_failed
 *   10. parameters がなくても {} として扱える
 *   11. 変換不能でも例外を投げない
 *   12. 同じ EdgeHypothesis から安定した DSL id が生成される
 */

import {
  dslFromHypothesis,
  stableDslIdFromHypothesis,
} from '../../evolution/dslFromHypothesis';
import { StrategyDSLSchema } from '../../strategy_dsl/schema';
import type {
  EdgeHypothesis,
  MachineReadableCondition,
  DefaultRiskManagement,
} from '../../models/edgeHypothesis';

// =================================================================
// fixture
// =================================================================

const baseRisk: DefaultRiskManagement = {
  stopLoss: { type: 'fixed_pips', value: 30 },
  takeProfit: { type: 'rr_ratio', value: 1.5 },
};

function makeHypothesis(overrides: Partial<EdgeHypothesis> = {}): EdgeHypothesis {
  const now = new Date();
  return {
    id: 'hyp-1',
    statement: 'EMA 20 上抜け時にロング',
    category: 'level',
    conditions: [
      { lensName: 'ema', featureKey: 'ema_20', op: '>', value: 0 } as MachineReadableCondition,
    ],
    expectedDirection: 'long',
    status: 'screening_passed',
    statusUpdatedAt: now,
    symbols: ['EURUSD'],
    timeframes: ['1h'],
    observationCount: 0,
    winCount: 0,
    lossCount: 0,
    breakevenCount: 0,
    totalPnlPips: 0,
    avgRR: 0,
    source: 'ai_generated',
    firstObservedAt: now,
    lastObservedAt: now,
    createdAt: now,
    updatedAt: now,
    defaultRiskManagement: baseRisk,
    ...overrides,
  };
}

// =================================================================
// tests
// =================================================================

describe('dslFromHypothesis (PR #98 必須 1〜12)', () => {
  it('1. 構造化済み conditions を持つ EdgeHypothesis を DSL に変換できる', () => {
    const r = dslFromHypothesis(makeHypothesis());
    expect(r.ok).toBe(true);
    expect(r.strategyDsl).toBeDefined();
    expect(r.strategyDsl?.entry.direction).toBe('long');
  });

  it('2. 変換後 DSL が StrategyDSLSchema を通過する', () => {
    const r = dslFromHypothesis(makeHypothesis());
    expect(r.ok).toBe(true);
    if (r.strategyDsl) {
      const reparse = StrategyDSLSchema.safeParse(r.strategyDsl);
      expect(reparse.success).toBe(true);
    }
  });

  it('3. metadata.description に sourceEdgeHypothesisId と status が残る', () => {
    const r = dslFromHypothesis(makeHypothesis({ id: 'hyp-trace', status: 'confirmed' }));
    expect(r.strategyDsl?.metadata.description).toContain('hyp-trace');
    expect(r.strategyDsl?.metadata.description).toContain('confirmed');
  });

  it('4. conditions が空なら missing_conditions で ok=false', () => {
    const r = dslFromHypothesis(makeHypothesis({ conditions: [] }));
    expect(r.ok).toBe(false);
    expect(r.failureReason).toBe('missing_conditions');
  });

  it('5. expectedDirection=either は unsupported_direction で ok=false (勝手に long に寄せない)', () => {
    const r = dslFromHypothesis(makeHypothesis({ expectedDirection: 'either' }));
    expect(r.ok).toBe(false);
    expect(r.failureReason).toBe('unsupported_direction');
  });

  it('6. symbols が空なら missing_symbol で ok=false', () => {
    const r = dslFromHypothesis(makeHypothesis({ symbols: [] }));
    expect(r.ok).toBe(false);
    expect(r.failureReason).toBe('missing_symbol');
  });

  it('7. timeframes が空なら missing_timeframe で ok=false (勝手に既定に寄せない)', () => {
    const r = dslFromHypothesis(makeHypothesis({ timeframes: [] }));
    expect(r.ok).toBe(false);
    expect(r.failureReason).toBe('missing_timeframe');
  });

  it('7b. timeframe が "1H" なら正規化されて DSL に格納される + warning が残る', () => {
    const r = dslFromHypothesis(makeHypothesis({ timeframes: ['1H'] }));
    expect(r.ok).toBe(true);
    expect(r.strategyDsl?.timeframe).toBe('1h');
    expect(r.warnings.some((w) => w.includes('正規化'))).toBe(true);
  });

  it('8. defaultRiskManagement が欠損なら missing_risk_rule で ok=false', () => {
    const r = dslFromHypothesis(
      makeHypothesis({ defaultRiskManagement: undefined as unknown as DefaultRiskManagement }),
    );
    expect(r.ok).toBe(false);
    expect(r.failureReason).toBe('missing_risk_rule');
  });

  it('9. condition の必須フィールド欠損で unsupported_condition_shape', () => {
    const r = dslFromHypothesis(
      makeHypothesis({
        conditions: [
          {
            lensName: '',
            featureKey: 'feat',
            op: '>',
            value: 0,
          } as MachineReadableCondition,
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.failureReason).toBe('unsupported_condition_shape');
  });

  it('10. parameters がなくても {} として扱える (= 補完しない)', () => {
    const r = dslFromHypothesis(makeHypothesis());
    expect(r.ok).toBe(true);
    expect(r.strategyDsl?.parameters).toEqual({});
  });

  it('11. 変換不能でも例外を投げない (= 必ず result を返す)', () => {
    expect(() =>
      dslFromHypothesis(makeHypothesis({ symbols: [], timeframes: [], conditions: [] })),
    ).not.toThrow();
  });

  it('12. 同じ EdgeHypothesis から安定した DSL id が生成される', () => {
    const r1 = dslFromHypothesis(makeHypothesis({ id: 'stable-id' }));
    const r2 = dslFromHypothesis(makeHypothesis({ id: 'stable-id' }));
    expect(r1.strategyDsl?.id).toBe(r2.strategyDsl?.id);
    expect(r1.strategyDsl?.id).toBe(stableDslIdFromHypothesis('stable-id'));
  });

  it('13. expectedDirection=short は許容', () => {
    const r = dslFromHypothesis(makeHypothesis({ expectedDirection: 'short' }));
    expect(r.ok).toBe(true);
    expect(r.strategyDsl?.entry.direction).toBe('short');
  });

  it('14. 複数 condition も AND 条件として展開される', () => {
    const r = dslFromHypothesis(
      makeHypothesis({
        conditions: [
          { lensName: 'ema', featureKey: 'ema_20', op: '>', value: 0 } as MachineReadableCondition,
          { lensName: 'rsi', featureKey: 'rsi_14', op: '>', value: 50 } as MachineReadableCondition,
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.strategyDsl && 'trigger' in r.strategyDsl.entry) {
      expect(r.strategyDsl.entry.trigger.logic).toBe('AND');
      expect(r.strategyDsl.entry.trigger.conditions).toHaveLength(2);
    }
  });
});
