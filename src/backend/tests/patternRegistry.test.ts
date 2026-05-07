/**
 * pattern registry の単体テスト (PR ②-2)。
 *
 * - registry.json と TS 側 ALL_CANDLE_PATTERN_IDS の整合 (= drift 検出)
 * - 各 entry に必要なフィールドが揃っている
 * - prompt 整形が markdown として LLM に渡せる形になっている
 */

import { ALL_CANDLE_PATTERN_IDS } from '../../shared/patterns';
import {
  getPatternRegistryEntry,
  getPatternsByCategory,
  PATTERN_REGISTRY,
} from '../../shared/patterns/registry';
import { formatPatternMetadataTable } from '../../shared/patterns/promptTable';

describe('PATTERN_REGISTRY', () => {
  it('PATTERN_REGISTRY と ALL_CANDLE_PATTERN_IDS の件数が一致 (= drift 検出)', () => {
    // PR ②-2 Copilot review #3: 12 への二重 pin は将来 patterns 数を増減した
    // 際の更新箇所を増やすので、ALL_CANDLE_PATTERN_IDS 側に寄せる。
    expect(PATTERN_REGISTRY).toHaveLength(ALL_CANDLE_PATTERN_IDS.length);
  });

  it('id の順序が ALL_CANDLE_PATTERN_IDS と一致 (= drift 検出)', () => {
    const ids = PATTERN_REGISTRY.map((e) => e.id);
    expect(ids).toEqual([...ALL_CANDLE_PATTERN_IDS]);
  });

  it('全 entry に shape / tradeContext / usageExamples が空でない', () => {
    for (const e of PATTERN_REGISTRY) {
      expect(e.shape.length).toBeGreaterThan(0);
      expect(e.tradeContext.length).toBeGreaterThan(0);
      expect(e.usageExamples.length).toBeGreaterThan(0);
    }
  });

  it('id 重複なし', () => {
    const ids = PATTERN_REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getPatternRegistryEntry で取得可能', () => {
    const entry = getPatternRegistryEntry('engulfing_bull');
    expect(entry).toBeDefined();
    expect(entry?.category).toBe('reversal');
  });

  it('getPatternsByCategory("continuation") は thrust_bull / thrust_bear', () => {
    const continuation = getPatternsByCategory('continuation');
    const ids = continuation.map((e) => e.id).sort();
    expect(ids).toEqual(['thrust_bear', 'thrust_bull']);
  });

  it('getPatternsByCategory("indecision") は doji のみ', () => {
    const indecision = getPatternsByCategory('indecision');
    expect(indecision).toHaveLength(1);
    expect(indecision[0].id).toBe('doji');
  });
});

describe('formatPatternMetadataTable', () => {
  const table = formatPatternMetadataTable();

  it('3 セクション (reversal / continuation / indecision) 全部含まれる', () => {
    expect(table).toContain('reversal (反転シグナル)');
    expect(table).toContain('continuation (継続シグナル)');
    expect(table).toContain('indecision (迷いシグナル)');
  });

  it('全 12 patternId がテーブルに含まれる', () => {
    for (const id of ALL_CANDLE_PATTERN_IDS) {
      expect(table).toContain(`\`${id}\``);
    }
  });

  it('is_true / is_false の使い方を LLM に教える説明が含まれる', () => {
    expect(table).toContain('is_true');
    expect(table).toContain('is_false');
  });

  it('実用的な戦略例 (RSI + pinbar AND) が含まれる', () => {
    expect(table).toMatch(/rsi.*pinbar_bull|pinbar_bull.*rsi/s);
  });
});
