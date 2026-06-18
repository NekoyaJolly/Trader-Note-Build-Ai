/**
 * agentic 研究ループ補助 (extractJsonContent) の単体テスト。
 * tools 併用時は responseFormat:json_object を使えず最終回答が ```json フェンスや前後テキストを
 * 含み得るため、確実に MarketAnalysis JSON を抽出できることを担保する。
 */

import { extractJsonContent } from '../services/researchAIService';

describe('extractJsonContent', () => {
  it('素の JSON オブジェクトを parse', () => {
    expect(extractJsonContent('{"regime":"range","direction":"neutral"}')).toEqual({
      regime: 'range',
      direction: 'neutral',
    });
  });

  it('```json フェンスを除去して parse', () => {
    const fenced = '```json\n{"confidence": 62, "regime": "weak_downtrend"}\n```';
    expect(extractJsonContent(fenced)).toEqual({ confidence: 62, regime: 'weak_downtrend' });
  });

  it('前後の説明テキストがあっても最初の { 〜 最後の } を抽出', () => {
    const noisy = '分析の結果は以下です:\n{"direction":"bearish","keyLevels":[1.15]}\n以上です。';
    expect(extractJsonContent(noisy)).toEqual({ direction: 'bearish', keyLevels: [1.15] });
  });

  it('ネストしたオブジェクトも保持', () => {
    const nested = '```\n{"a":{"b":1},"c":[2,3]}\n```';
    expect(extractJsonContent(nested)).toEqual({ a: { b: 1 }, c: [2, 3] });
  });

  it('不正 JSON は throw する (黙殺しない)', () => {
    expect(() => extractJsonContent('not json at all')).toThrow();
  });
});
