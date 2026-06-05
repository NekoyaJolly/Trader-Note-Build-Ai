/**
 * 認知層評価ハーネス (P1) のオフライン実行ランナー。
 *
 * 代表ケース (接地良好 / 捏造 / 内部矛盾) を実 judge (LLM) で採点し、rubric 集計の
 * 妥当性を目視確認する。Anthropic 推奨の「実利用を代表する小規模 eval セット」の種。
 * ここに本番で観測した良/悪ケースを追記して ~20 件規模に育てる。
 *
 * 実行: `AI_API_KEY=... npx tsx scripts/check/run-cognitive-eval.ts`
 * (AI_API_KEY 未設定時は判定不能としてスキップ理由を表示して exit 0)
 */
import {
  evaluateCognitiveOutput,
  MARKET_ANALYSIS_RUBRIC,
} from '../../src/side-b/evaluation/cognitiveOutputEvaluator';
import type { MarketAnalysis } from '../../src/side-b/models/marketAnalysis';
import type { JsonValue } from '../../src/utils/jsonValue';

interface EvalCase {
  name: string;
  /** 期待: passed が true 寄りか false 寄りか (目視確認用の事前ラベル) */
  expectPassish: boolean;
  context: JsonValue;
  output: MarketAnalysis;
}

// EURUSD 15m の最小スナップショット (接地検証の材料)
const CONTEXT_EURUSD: JsonValue = {
  symbol: 'EURUSD',
  timeframe: '15m',
  recentClose: 1.0850,
  recentHigh: 1.0875,
  recentLow: 1.0820,
  rsi14: 58,
  sma200: 1.0805,
  atr14: 0.0012,
};

const GROUNDED_GOOD: MarketAnalysis = {
  regime: 'weak_uptrend',
  direction: 'bullish',
  volatility: 'low',
  confidence: 62,
  keyLevels: [
    { price: 1.0805, type: 'support', strength: 'strong', basis: 'SMA200(1.0805)との合流' },
    { price: 1.0875, type: 'resistance', strength: 'moderate', basis: '直近高値クラスタ' },
  ],
  reasoning: {
    trendAnalysis: '終値1.0850がSMA200(1.0805)上で推移し上昇トレンド。',
    momentumAnalysis: 'RSI14=58で中立やや強気、買われすぎではない。',
    volatilityAnalysis: 'ATR14=0.0012と低く、レンジは限定的。',
    keyObservation: 'SMA200上抜け維持で押し目買い優位。',
    riskFactors: ['1.0805割れで上昇シナリオ無効化'],
  },
  quickScores: { trendStrength: 65, momentum: 58, volatility: 25, supportProximity: 60, resistanceProximity: 40 },
};

// 捏造: context に無い「決算」「機関投資家フロー」に言及 (FX に決算は無い)
const FABRICATED: MarketAnalysis = {
  regime: 'weak_uptrend',
  direction: 'bullish',
  volatility: 'low',
  confidence: 80,
  keyLevels: [
    { price: 1.0805, type: 'support', strength: 'strong', basis: 'SMA200' },
    { price: 1.0875, type: 'resistance', strength: 'moderate', basis: '直近高値' },
  ],
  reasoning: {
    trendAnalysis: '好決算を受けた買いが継続している。',
    momentumAnalysis: '機関投資家の大口フローが流入しており強い。',
    volatilityAnalysis: 'VIXが急低下し安心感。',
    keyObservation: 'アナリスト目標株価の引き上げが追い風。',
    riskFactors: ['次回決算ミス'],
  },
  quickScores: { trendStrength: 90, momentum: 88, volatility: 20, supportProximity: 70, resistanceProximity: 30 },
};

// 内部矛盾: direction=bullish なのに reasoning が弱気一辺倒
const INCONSISTENT: MarketAnalysis = {
  regime: 'weak_uptrend',
  direction: 'bullish',
  volatility: 'low',
  confidence: 70,
  keyLevels: [
    { price: 1.0805, type: 'support', strength: 'strong', basis: 'SMA200(1.0805)' },
    { price: 1.0875, type: 'resistance', strength: 'moderate', basis: '直近高値' },
  ],
  reasoning: {
    trendAnalysis: '上値が重く下落基調、戻り売り優位。',
    momentumAnalysis: 'モメンタムは弱含みで売りシグナル。',
    volatilityAnalysis: '低ボラだが下方向への警戒。',
    keyObservation: '弱気継続、買いは推奨しない。',
    riskFactors: ['上昇転換'],
  },
  quickScores: { trendStrength: 30, momentum: 25, volatility: 25, supportProximity: 50, resistanceProximity: 50 },
};

const CASES: EvalCase[] = [
  { name: 'grounded-good', expectPassish: true, context: CONTEXT_EURUSD, output: GROUNDED_GOOD },
  { name: 'fabricated', expectPassish: false, context: CONTEXT_EURUSD, output: FABRICATED },
  { name: 'inconsistent', expectPassish: false, context: CONTEXT_EURUSD, output: INCONSISTENT },
];

async function main(): Promise<void> {
  if (!process.env.AI_API_KEY) {
    console.log('AI_API_KEY 未設定のため実 judge を呼べません。スキップします。');
    return;
  }
  console.log(`rubric=${MARKET_ANALYSIS_RUBRIC.name} threshold=${MARKET_ANALYSIS_RUBRIC.passThreshold}\n`);
  for (const c of CASES) {
    const verdict = await evaluateCognitiveOutput({
      rubric: MARKET_ANALYSIS_RUBRIC,
      output: c.output,
      context: c.context,
    });
    const dims = verdict.dimensionScores.map((d) => `${d.dimension}=${d.score.toFixed(2)}`).join(' ');
    const okMark = verdict.passed === c.expectPassish ? '✅' : '⚠️ 期待と不一致';
    console.log(
      `[${c.name}] overall=${verdict.overallScore.toFixed(3)} passed=${verdict.passed} (期待: ${c.expectPassish}) ${okMark}`,
    );
    console.log(`  ${dims}`);
    console.log(`  summary: ${verdict.summary}\n`);
  }
}

main().catch((err) => {
  console.error('run-cognitive-eval 失敗:', err);
  process.exit(1);
});
