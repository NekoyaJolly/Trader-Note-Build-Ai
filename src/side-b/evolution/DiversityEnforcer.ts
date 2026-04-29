/**
 * 戦略集団の類似度・多様性（Phase 5）
 *
 * @see docs/design/phase_5_specification.md §4.7
 */

import type { StrategyDSL } from '../strategy_dsl/schema';

/** 正規化用に DSL から可変フィールドを除いたオブジェクトを作る */
function structuralKey(dsl: StrategyDSL): string {
  const { id: _id, generation: _g, parentIds: _p, metadata: _m, ...rest } = dsl;
  return JSON.stringify(rest);
}

export class DiversityEnforcer {
  /** 2 戦略の類似度（0〜1、1 が同一構造） */
  similarity(a: StrategyDSL, b: StrategyDSL): number {
    if (a.id === b.id) return 1;
    const sa = structuralKey(a);
    const sb = structuralKey(b);
    if (sa === sb) return 1;
    // 単純化: 共通文字比（長さ差を考慮しない cheap 近似）
    let same = 0;
    const len = Math.min(sa.length, sb.length);
    for (let i = 0; i < len; i++) {
      if (sa[i] === sb[i]) same++;
    }
    const denom = Math.max(sa.length, sb.length, 1);
    return same / denom;
  }

  /** 類似度が閾値を超えるペア */
  findTooSimilarPairs(strategies: StrategyDSL[], threshold = 0.85): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < strategies.length; i++) {
      for (let j = i + 1; j < strategies.length; j++) {
        if (this.similarity(strategies[i], strategies[j]) >= threshold) {
          pairs.push([strategies[i].id, strategies[j].id]);
        }
      }
    }
    return pairs;
  }

  /** 多様性スコア（1 - 平均ペア類似度の粗い近似） */
  diversityScore(strategies: StrategyDSL[]): number {
    if (strategies.length < 2) return 1;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < strategies.length; i++) {
      for (let j = i + 1; j < strategies.length; j++) {
        sum += this.similarity(strategies[i], strategies[j]);
        n++;
      }
    }
    const avgSim = sum / Math.max(n, 1);
    return Math.max(0, Math.min(1, 1 - avgSim));
  }

  /**
   * 類似した個体を間引く（先頭順に残し、後勝ちで落とす）
   */
  filterDiverse(strategies: StrategyDSL[], threshold = 0.85): StrategyDSL[] {
    const kept: StrategyDSL[] = [];
    for (const s of strategies) {
      const dup = kept.some((k) => this.similarity(k, s) >= threshold);
      if (!dup) kept.push(s);
    }
    return kept;
  }
}
