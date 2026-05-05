/**
 * PR #108: Quality-Diversity Archive Lite v1 のテスト。
 *
 * 設計書 §10.1 / §5.2 必須観点:
 *   1. 同 descriptor → 同 cell key
 *   2. dsl.id 違いでも behavior が同じなら同 cell
 *   3. behavior が違えば別 cell
 *   4. 同 cell では quality score 高い候補が代表
 *   5. quality score 同点なら deterministic tie-breaker
 *   6. fatal / invalid / DSL missing は archive に入らない
 *   7. maxCells を超える場合 deterministic に制限
 *   8. selectQualityDiversityArchiveParentsV1 は cell 重複を避ける
 *   9. archive が空なら空配列
 *   10. summary に cells / inserted / replaced / skipped / coverageRatio が出る
 *   11. input を mutation しない
 *   12. OOS / WF metrics を再計算しない (= 既存 metrics をそのまま運ぶ)
 */

import {
  buildQdArchiveCellKeyV1,
  computeQdArchiveQualityScoreV1,
  createEmptyQualityDiversityArchiveV1,
  qualityDiversityArchiveDefaultsV1,
  selectQualityDiversityArchiveParentsV1,
  summarizeQualityDiversityArchiveV1,
  updateQualityDiversityArchiveV1,
  type QualityDiversityArchiveCandidateV1,
} from '../../evolution/qualityDiversityArchiveLite';
import { StrategyDSLSchema, type StrategyDSL } from '../../strategy_dsl/schema';
import type { EvolutionPromotionCandidate } from '../../evolution/EvolutionLoop';

// =================================================================
// fixtures
// =================================================================

function makeDsl(id: string, opts: Partial<{ regime: string; timeframe: string }> = {}): StrategyDSL {
  return StrategyDSLSchema.parse({
    id,
    generation: 0,
    parentIds: [],
    regimeTarget: opts.regime ?? 'breakout',
    symbol: 'EURUSD',
    timeframe: opts.timeframe ?? '1h',
    entry: {
      direction: 'long',
      trigger: {
        logic: 'AND',
        conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0 }],
      },
      orderType: 'market',
    },
    stopLoss: { type: 'fixed_pips', value: 30 },
    takeProfit: { type: 'rr_ratio', value: 1.5 },
    parameters: {},
    metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
  });
}

function makeCandidate(opts: {
  id: string;
  formalBtPassed?: boolean;
  pf?: number;
  tradeCount?: number;
  maxDrawdown?: number;
  winRate?: number;
  surrogateScore?: number;
  noveltyScore?: number;
  regime?: string;
  timeframe?: string;
  fatal?: boolean;
}): QualityDiversityArchiveCandidateV1 {
  const dsl = makeDsl(opts.id, { regime: opts.regime, timeframe: opts.timeframe });
  const candidate: EvolutionPromotionCandidate = {
    dslId: opts.id,
    source: 'evolution',
    regime: opts.regime ?? 'breakout',
    symbol: 'EURUSD',
    timeframe: opts.timeframe ?? '1h',
    trainPf: opts.pf ?? 1.6,
    validationPf: opts.pf ?? 1.4,
    overfitScore: 0.15,
    validationTradeCount: opts.tradeCount ?? 30,
    formalBtPassed: opts.formalBtPassed ?? true,
    formalBtMetrics: {
      pf: opts.pf ?? 1.5,
      winRate: opts.winRate ?? 0.55,
      tradeCount: opts.tradeCount ?? 30,
      maxDrawdown: opts.maxDrawdown ?? 8,
    },
    route: 'normal_pass',
    dsl,
    ...(opts.fatal && {
      repairHint: {
        failureReason: 'dsl_missing',
        severity: 'fatal',
        summary: 'fatal',
        actions: [],
        mutationGuidance: '',
        shouldUseForRepairMutation: false,
        shouldExcludeFromParentPool: true,
        warnings: [],
      },
    }),
  };
  return {
    candidate,
    dsl,
    surrogateScore: opts.surrogateScore,
    noveltyScore: opts.noveltyScore,
  };
}

// =================================================================
// tests
// =================================================================

describe('buildQdArchiveCellKeyV1', () => {
  it('1. 同 descriptor から同 cell key が生成される (deterministic)', () => {
    // dsl.id 違いでも他フィールド同じなら descriptor も cell key も同じ
    const descA = {
      regimeTarget: 'breakout',
      timeframe: '1h',
      entryKind: 'immediate_market',
      exitKind: 'fixed_rr',
      indicatorKinds: ['price'],
      riskKind: 'fixed_pips',
      stopLossKind: 'fixed_pips',
      takeProfitKind: 'rr_ratio',
      tradeFrequencyClass: 'medium' as const,
    };
    const descB = { ...descA };
    expect(buildQdArchiveCellKeyV1(descA)).toBe(buildQdArchiveCellKeyV1(descB));
    // dsl.id を含めない (= 一意性のある id 文字列を埋め込んでも cell key は変わらない)
    const candA = makeCandidate({ id: 'unique-id-aaaa-9999' });
    const candB = makeCandidate({ id: 'unique-id-bbbb-0000' });
    expect(buildQdArchiveCellKeyV1(descA)).not.toContain(candA.dsl.id);
    expect(buildQdArchiveCellKeyV1(descA)).not.toContain(candB.dsl.id);
  });

  it('undefined / 空文字は "unknown" として扱う', () => {
    const key = buildQdArchiveCellKeyV1({
      regimeTarget: '',
      timeframe: 'unknown',
      entryKind: '',
      exitKind: 'unknown',
      indicatorKinds: [],
      riskKind: '',
      stopLossKind: '',
      takeProfitKind: '',
      tradeFrequencyClass: 'unknown',
    });
    // 全 unknown が連結される
    expect(key.split('|').every((p) => p === 'unknown')).toBe(true);
  });

  it('indicatorKinds が複数あっても順序固定', () => {
    const k1 = buildQdArchiveCellKeyV1({
      regimeTarget: 'breakout',
      timeframe: '1h',
      entryKind: 'imm',
      exitKind: 'rr',
      indicatorKinds: ['ema', 'atr', 'macd'],
      riskKind: 'r',
      stopLossKind: 's',
      takeProfitKind: 't',
      tradeFrequencyClass: 'medium',
    });
    const k2 = buildQdArchiveCellKeyV1({
      regimeTarget: 'breakout',
      timeframe: '1h',
      entryKind: 'imm',
      exitKind: 'rr',
      indicatorKinds: ['ema', 'atr', 'macd'],
      riskKind: 'r',
      stopLossKind: 's',
      takeProfitKind: 't',
      tradeFrequencyClass: 'medium',
    });
    expect(k1).toBe(k2);
  });
});

describe('computeQdArchiveQualityScoreV1', () => {
  it('formalBtPassed=true は大きく加点される (+50)', () => {
    const passed = computeQdArchiveQualityScoreV1(makeCandidate({ id: 'p', formalBtPassed: true }));
    const failed = computeQdArchiveQualityScoreV1(
      makeCandidate({ id: 'f', formalBtPassed: false }),
    );
    expect(passed - failed).toBeGreaterThanOrEqual(50);
  });

  it('PF が高いほど加点される', () => {
    const lowPf = computeQdArchiveQualityScoreV1(makeCandidate({ id: 'l', pf: 1.0 }));
    const highPf = computeQdArchiveQualityScoreV1(makeCandidate({ id: 'h', pf: 2.0 }));
    expect(highPf).toBeGreaterThan(lowPf);
  });

  it('deterministic: 同 input → 同 score', () => {
    const c = makeCandidate({ id: 'd', pf: 1.5, surrogateScore: 0.7, noveltyScore: 0.3 });
    expect(computeQdArchiveQualityScoreV1(c)).toBe(computeQdArchiveQualityScoreV1(c));
  });
});

describe('updateQualityDiversityArchiveV1', () => {
  it('2. 同 behavior 別 dslId は同 cell に競合し、勝者だけが代表になる', () => {
    const state = createEmptyQualityDiversityArchiveV1();
    const c1 = makeCandidate({ id: 'a', pf: 1.2 });
    const c2 = makeCandidate({ id: 'b', pf: 1.8 }); // 同 behavior、PF が高い
    const upd = updateQualityDiversityArchiveV1(state, {
      generationIndex: 0,
      candidates: [c1, c2],
    });
    expect(Object.keys(upd.nextState.cells)).toHaveLength(1);
    const cell = Object.values(upd.nextState.cells)[0];
    expect(cell.dslId).toBe('b');
    expect(upd.updateSummary.inserted).toBe(1);
    expect(upd.updateSummary.replaced).toBe(1);
  });

  it('3. behavior が違えば別 cell に入る', () => {
    const state = createEmptyQualityDiversityArchiveV1();
    const c1 = makeCandidate({ id: 'a', regime: 'breakout' });
    const c2 = makeCandidate({ id: 'b', regime: 'trending_with_pullback' });
    const upd = updateQualityDiversityArchiveV1(state, {
      generationIndex: 0,
      candidates: [c1, c2],
    });
    expect(Object.keys(upd.nextState.cells)).toHaveLength(2);
    expect(upd.updateSummary.inserted).toBe(2);
  });

  it('4. 同 cell では quality score が高い候補が代表 (insertion 順非依存)', () => {
    const stateA = createEmptyQualityDiversityArchiveV1();
    const stateB = createEmptyQualityDiversityArchiveV1();
    const high = makeCandidate({ id: 'high', pf: 2.0 });
    const low = makeCandidate({ id: 'low', pf: 1.0 });
    const updA = updateQualityDiversityArchiveV1(stateA, {
      generationIndex: 0,
      candidates: [high, low],
    });
    const updB = updateQualityDiversityArchiveV1(stateB, {
      generationIndex: 0,
      candidates: [low, high],
    });
    expect(Object.values(updA.nextState.cells)[0].dslId).toBe('high');
    expect(Object.values(updB.nextState.cells)[0].dslId).toBe('high');
  });

  it('5. quality score 同点なら formalBtPassed → tradeCount → dslId 昇順で deterministic', () => {
    const state = createEmptyQualityDiversityArchiveV1();
    // 完全に同じ metrics で id だけ違う 2 件 → dslId 昇順で 'a' が代表
    const a = makeCandidate({ id: 'a', pf: 1.5, tradeCount: 30 });
    const b = makeCandidate({ id: 'b', pf: 1.5, tradeCount: 30 });
    const upd = updateQualityDiversityArchiveV1(state, {
      generationIndex: 0,
      candidates: [b, a],
    });
    expect(Object.values(upd.nextState.cells)[0].dslId).toBe('a');
  });

  it('6a. fatal repairHint (shouldExcludeFromParentPool=true) は archive に入らない', () => {
    const state = createEmptyQualityDiversityArchiveV1();
    const fatal = makeCandidate({ id: 'fatal', fatal: true });
    const upd = updateQualityDiversityArchiveV1(state, {
      generationIndex: 0,
      candidates: [fatal],
    });
    expect(Object.keys(upd.nextState.cells)).toHaveLength(0);
    expect(upd.updateSummary.skipped).toBe(1);
  });

  it('6b. tradeCount が minTradeCountForArchive 未満なら skip', () => {
    const state = createEmptyQualityDiversityArchiveV1();
    const lowTrades = makeCandidate({
      id: 'lt',
      tradeCount: qualityDiversityArchiveDefaultsV1.minTradeCountForArchive - 1,
    });
    const upd = updateQualityDiversityArchiveV1(state, {
      generationIndex: 0,
      candidates: [lowTrades],
    });
    expect(Object.keys(upd.nextState.cells)).toHaveLength(0);
    expect(upd.updateSummary.skipped).toBe(1);
  });

  it('7. maxCells 超過時に qualityScore 昇順で削除 (deterministic)', () => {
    const state = createEmptyQualityDiversityArchiveV1({ maxCells: 2 });
    // 異なる behavior の 3 候補。pf が高い順に保持される
    const c1 = makeCandidate({ id: 'low', regime: 'breakout', pf: 1.0 });
    const c2 = makeCandidate({ id: 'mid', regime: 'trending_with_pullback', pf: 1.5 });
    const c3 = makeCandidate({ id: 'high', regime: 'mean_reversion', pf: 2.0 });
    const upd = updateQualityDiversityArchiveV1(state, {
      generationIndex: 0,
      candidates: [c1, c2, c3],
    });
    expect(Object.keys(upd.nextState.cells)).toHaveLength(2);
    const ids = Object.values(upd.nextState.cells).map((c) => c.dslId).sort();
    expect(ids).toEqual(['high', 'mid']); // 'low' は削除される
    expect(upd.updateSummary.warnings.some((w) => w.includes('maxCells'))).toBe(true);
  });

  it('11. input を mutation しない (state / candidates / dsl すべて immutable)', () => {
    const state = createEmptyQualityDiversityArchiveV1();
    const c = makeCandidate({ id: 'a' });
    const initialCellsRef = state.cells;
    const initialCandidateRef = c.candidate;
    const initialDslRef = c.dsl;
    const upd = updateQualityDiversityArchiveV1(state, {
      generationIndex: 0,
      candidates: [c],
    });
    expect(state.cells).toBe(initialCellsRef); // 元 state は変わっていない
    expect(state.totalInserted).toBe(0);
    expect(c.candidate).toBe(initialCandidateRef);
    expect(c.dsl).toBe(initialDslRef);
    // 新 state は別オブジェクト
    expect(upd.nextState).not.toBe(state);
  });

  it('12. OOS / WF metrics を再計算せず、既存 metrics をそのまま運ぶ', () => {
    const state = createEmptyQualityDiversityArchiveV1();
    const c = makeCandidate({
      id: 'm',
      pf: 1.7,
      tradeCount: 33,
      maxDrawdown: 12.34,
      winRate: 0.61,
    });
    const upd = updateQualityDiversityArchiveV1(state, {
      generationIndex: 0,
      candidates: [c],
    });
    const cell = Object.values(upd.nextState.cells)[0];
    expect(cell.metricsSnapshot.pf).toBe(1.7);
    expect(cell.metricsSnapshot.tradeCount).toBe(33);
    expect(cell.metricsSnapshot.maxDrawdown).toBe(12.34);
    expect(cell.metricsSnapshot.winRate).toBe(0.61);
  });

  it('世代をまたいで totalInserted / totalReplaced / totalSkipped が累積する', () => {
    let state = createEmptyQualityDiversityArchiveV1();
    state = updateQualityDiversityArchiveV1(state, {
      generationIndex: 0,
      candidates: [makeCandidate({ id: 'a', pf: 1.2 })],
    }).nextState;
    state = updateQualityDiversityArchiveV1(state, {
      generationIndex: 1,
      // 同 cell に高品質候補
      candidates: [makeCandidate({ id: 'b', pf: 1.8 })],
    }).nextState;
    expect(state.totalInserted).toBe(1);
    expect(state.totalReplaced).toBe(1);
  });
});

describe('selectQualityDiversityArchiveParentsV1', () => {
  it('8. cell 重複なく上位 limit 件を返す', () => {
    let state = createEmptyQualityDiversityArchiveV1();
    state = updateQualityDiversityArchiveV1(state, {
      generationIndex: 0,
      candidates: [
        makeCandidate({ id: 'low', regime: 'breakout', pf: 1.1 }),
        makeCandidate({ id: 'mid', regime: 'trending_with_pullback', pf: 1.5 }),
        makeCandidate({ id: 'high', regime: 'mean_reversion', pf: 2.0 }),
      ],
    }).nextState;
    const parents = selectQualityDiversityArchiveParentsV1(state, { limit: 2 });
    expect(parents).toHaveLength(2);
    expect(parents.map((p) => p.id).sort()).toEqual(['high', 'mid']);
  });

  it('9. archive が空なら空配列', () => {
    const state = createEmptyQualityDiversityArchiveV1();
    expect(selectQualityDiversityArchiveParentsV1(state)).toEqual([]);
  });

  it('limit=0 は空配列', () => {
    let state = createEmptyQualityDiversityArchiveV1();
    state = updateQualityDiversityArchiveV1(state, {
      generationIndex: 0,
      candidates: [makeCandidate({ id: 'a' })],
    }).nextState;
    expect(selectQualityDiversityArchiveParentsV1(state, { limit: 0 })).toEqual([]);
  });
});

describe('summarizeQualityDiversityArchiveV1', () => {
  it('10. cells / inserted / replaced / skipped / coverageRatio が出る', () => {
    let state = createEmptyQualityDiversityArchiveV1({ maxCells: 10 });
    state = updateQualityDiversityArchiveV1(state, {
      generationIndex: 0,
      candidates: [
        makeCandidate({ id: 'a', regime: 'breakout', pf: 1.5 }),
        makeCandidate({ id: 'b', regime: 'trending_with_pullback', pf: 1.5 }),
      ],
    }).nextState;
    const s = summarizeQualityDiversityArchiveV1(state, {
      enabled: true,
      selectedParents: 2,
    });
    expect(s.enabled).toBe(true);
    expect(s.cells).toBe(2);
    expect(s.inserted).toBe(2);
    expect(s.replaced).toBe(0);
    expect(s.skipped).toBe(0);
    expect(s.selectedParents).toBe(2);
    expect(s.coverageRatio).toBeCloseTo(0.2);
    expect(s.cellKeys).toHaveLength(2);
  });
});
