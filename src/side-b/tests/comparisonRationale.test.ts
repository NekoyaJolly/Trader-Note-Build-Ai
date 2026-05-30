/**
 * extractAiRationale のユニットテスト (根拠サーフェシング P2-c)
 *
 * 確認事項:
 *   - learnings.keyInsight があれば最優先で返す
 *   - keyInsight が空なら entryAnalysis.evaluation にフォールバックする
 *   - どちらも無ければ null
 */

import { extractAiRationale } from '../services/comparisonService';

describe('extractAiRationale', () => {
  it('keyInsight があれば最優先で返す', () => {
    const learnings = { keyInsight: 'トレンド方向の押し目だけ取るべき', whatWorked: [], whatDidntWork: [], actionItems: [] };
    const entryAnalysis = { evaluation: 'エントリーは早すぎた' };
    expect(extractAiRationale(learnings, entryAnalysis)).toBe('トレンド方向の押し目だけ取るべき');
  });

  it('keyInsight が空なら entryAnalysis.evaluation にフォールバックする', () => {
    const learnings = { keyInsight: '   ', whatWorked: [], whatDidntWork: [], actionItems: [] };
    const entryAnalysis = { evaluation: '上位足の節目を待てた良いエントリー' };
    expect(extractAiRationale(learnings, entryAnalysis)).toBe('上位足の節目を待てた良いエントリー');
  });

  it('どちらも無ければ null', () => {
    expect(extractAiRationale({ keyInsight: '' }, { evaluation: '' })).toBeNull();
    expect(extractAiRationale(null, null)).toBeNull();
  });
});
