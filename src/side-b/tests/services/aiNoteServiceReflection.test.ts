/**
 * Step C-1: aiNoteService の reflection 統合 (mergeReflectionIntoLearnings) ユニットテスト。
 *
 * reflectionAI の分析結果を決定論的ノートの learnings に統合するロジックを検証する。
 * generateNoteFromTrade 経由だと DB / repository mock が重いため、純粋関数を直接検証する
 * (PR #271 の教訓: hookup ロジックは純粋関数化して回帰検知可能にする)。
 */

import { mergeReflectionIntoLearnings } from '../../services/aiNoteService';
import type { Learnings } from '../../models';

function baseLearnings(): Learnings {
  return {
    whatWorked: ['損切りルールの遵守'],
    whatDidntWork: ['エントリータイミングの悪さ'],
    keyInsight: '改善ポイント: エントリー条件の厳格化',
    actionItems: ['エントリー条件の厳格化'],
  };
}

function validReflection() {
  return {
    outcomeAnalysis: 'トレンド方向は合っていたがエントリーが早すぎた',
    entryEvaluation: { rating: 'poor', comment: 'タイミング尚早' },
    exitEvaluation: { rating: 'good', comment: 'SL 適切' },
    lessons: ['押し目を待つ', '上位足の確定を待つ'],
    strategyAdjustment: 'エントリー条件に上位足整合を追加',
    overallScore: 45,
  };
}

describe('mergeReflectionIntoLearnings', () => {
  it('reflection が null なら learnings をそのまま返す', () => {
    const learnings = baseLearnings();
    const result = mergeReflectionIntoLearnings(learnings, null);
    expect(result).toEqual(learnings);
  });

  it('reflection が undefined なら learnings をそのまま返す', () => {
    const learnings = baseLearnings();
    const result = mergeReflectionIntoLearnings(learnings, undefined);
    expect(result).toEqual(learnings);
  });

  it('有効な ReflectionOutput は lessons / strategyAdjustment を actionItems に追記する', () => {
    const result = mergeReflectionIntoLearnings(baseLearnings(), validReflection());
    expect(result.actionItems).toEqual([
      'エントリー条件の厳格化',
      '押し目を待つ',
      '上位足の確定を待つ',
      'エントリー条件に上位足整合を追加',
    ]);
  });

  it('有効な ReflectionOutput は keyInsight に outcomeAnalysis + overallScore を補足する', () => {
    const result = mergeReflectionIntoLearnings(baseLearnings(), validReflection());
    expect(result.keyInsight).toContain('改善ポイント: エントリー条件の厳格化');
    expect(result.keyInsight).toContain('Reflection (スコア 45)');
    expect(result.keyInsight).toContain('トレンド方向は合っていたがエントリーが早すぎた');
  });

  it('strategyAdjustment 欠落時は lessons のみ actionItems に追記する', () => {
    const reflection = { ...validReflection() };
    delete (reflection as { strategyAdjustment?: string }).strategyAdjustment;
    const result = mergeReflectionIntoLearnings(baseLearnings(), reflection);
    expect(result.actionItems).toEqual([
      'エントリー条件の厳格化',
      '押し目を待つ',
      '上位足の確定を待つ',
    ]);
  });

  it('whatWorked / whatDidntWork は reflection 統合後も保持される', () => {
    const result = mergeReflectionIntoLearnings(baseLearnings(), validReflection());
    expect(result.whatWorked).toEqual(['損切りルールの遵守']);
    expect(result.whatDidntWork).toEqual(['エントリータイミングの悪さ']);
  });

  it('簡易フォールバック構造 ({ fallback, summary }) は summary を keyInsight に補足する', () => {
    const fallback = { fallback: true, summary: 'XAUUSD long で 12.3pips の損失。sl_hit による決済。' };
    const result = mergeReflectionIntoLearnings(baseLearnings(), fallback);
    expect(result.keyInsight).toContain('Reflection (簡易)');
    expect(result.keyInsight).toContain('XAUUSD long で 12.3pips の損失');
    // actionItems は変化しない (= fallback は lessons を持たない)
    expect(result.actionItems).toEqual(['エントリー条件の厳格化']);
  });

  it('不正な構造 (= ReflectionOutput でも fallback でもない) は learnings をそのまま返す', () => {
    const result = mergeReflectionIntoLearnings(baseLearnings(), { foo: 'bar' });
    expect(result).toEqual(baseLearnings());
  });

  it('配列 / プリミティブの reflection は learnings をそのまま返す', () => {
    expect(mergeReflectionIntoLearnings(baseLearnings(), [1, 2, 3])).toEqual(baseLearnings());
    expect(mergeReflectionIntoLearnings(baseLearnings(), 'string')).toEqual(baseLearnings());
    expect(mergeReflectionIntoLearnings(baseLearnings(), 42)).toEqual(baseLearnings());
  });

  it('元の learnings オブジェクトは変更しない (= 新規オブジェクトを返す)', () => {
    const learnings = baseLearnings();
    mergeReflectionIntoLearnings(learnings, validReflection());
    expect(learnings.actionItems).toEqual(['エントリー条件の厳格化']);
    expect(learnings.keyInsight).toBe('改善ポイント: エントリー条件の厳格化');
  });
});
