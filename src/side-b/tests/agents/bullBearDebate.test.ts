/**
 * BullBearDebateAgent 単体テスト
 *
 * 討論エージェントのバリデーション・フォールバック・API 呼び出し配線を検証する。
 *
 * モック戦略: fetch をモックし、AI API 呼び出しを制御する。
 * 実 API は叩かない（料金発生なし）。
 */

import {
  BullBearDebateAgent,
  validateBullBearDebateOutput,
  type BullBearDebateOutput,
} from '../../agents/BullBearDebateAgent';

global.fetch = jest.fn();

// ===========================================
// テスト用データ
// ===========================================

/** 正常な討論出力の最小構成 */
function buildValidDebateOutput(): BullBearDebateOutput {
  return {
    marketContext: {
      summary: 'XAUUSDは上昇トレンド中、2400付近のレジスタンスに接近',
      dominantBias: 'bullish',
      biasStrength: 65,
    },
    bull: {
      scenario: '2400ブレイクアウト後の押し目買い。目標2450。',
      confidence: 70,
      rationale: [
        '日足レベルの上昇トレンドが継続中',
        'ボリュームが増加傾向',
      ],
      keyConditions: ['2400を明確にブレイク', '15分足でリテスト確認'],
      risks: ['米雇用統計前のポジション調整リスク'],
      timeHorizon: 'short_term',
    },
    bear: {
      scenario: '2400レジスタンスでの反落。目標2360。',
      confidence: 40,
      rationale: [
        'RSIがオーバーボート圏に接近',
        '2400は過去に複数回反落した水準',
      ],
      keyConditions: ['2400で明確な拒否反応', '15分足で陰線確定'],
      risks: ['強いトレンドに逆らうリスク'],
      timeHorizon: 'short_term',
    },
    synthesis: {
      preferredDirection: 'long',
      preferredConfidence: 65,
      reasoning: 'トレンドの強さを考慮し、ロング優勢と判断。ただし2400のレジスタンスには注意。',
      phaseAnalysis: [
        {
          phase: '短期・2400テスト中',
          direction: 'wait',
          condition: '2400のブレイクまたは拒否を確認するまで待機',
          confidence: 70,
        },
        {
          phase: '2400ブレイク後',
          direction: 'long',
          condition: '2400を上抜けしリテスト成功',
          confidence: 75,
        },
      ],
      consensusPoints: [
        '2400が重要な価格レベルであること',
        '短期的にはこの水準での値動きが鍵',
      ],
      divergencePoints: [
        'ブレイク後の方向性（上抜け vs 反落）',
      ],
      actionableInsight: '2400のブレイクアウトを確認してからのロングエントリーが最も確度が高い。',
    },
  };
}

function mockAIResponse(output: unknown) {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1234567890,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: JSON.stringify(output) },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 400, total_tokens: 500 },
        model: 'test-model',
      }),
  });
}

// ===========================================
// validateBullBearDebateOutput テスト
// ===========================================

describe('validateBullBearDebateOutput', () => {
  it('正常な出力をバリデーション通過させる', () => {
    const valid = buildValidDebateOutput();
    const result = validateBullBearDebateOutput(valid);
    expect(result.marketContext.dominantBias).toBe('bullish');
    expect(result.bull.confidence).toBe(70);
    expect(result.bear.confidence).toBe(40);
    expect(result.synthesis.preferredDirection).toBe('long');
    expect(result.synthesis.phaseAnalysis).toHaveLength(2);
    expect(result.synthesis.consensusPoints).toHaveLength(2);
  });

  it('null/undefined を拒否する', () => {
    expect(() => validateBullBearDebateOutput(null)).toThrow('must be an object');
    expect(() => validateBullBearDebateOutput(undefined)).toThrow('must be an object');
  });

  it('marketContext が欠落している場合にエラーを投げる', () => {
    const data = { ...buildValidDebateOutput(), marketContext: undefined };
    expect(() => validateBullBearDebateOutput(data)).toThrow('marketContext must be an object');
  });

  it('bull.scenario が短すぎる場合にエラーを投げる', () => {
    const data = buildValidDebateOutput();
    data.bull.scenario = 'ab';
    expect(() => validateBullBearDebateOutput(data)).toThrow('bull.scenario');
  });

  it('bear.confidence が範囲外の場合にエラーを投げる', () => {
    const data = buildValidDebateOutput();
    data.bear.confidence = 150;
    expect(() => validateBullBearDebateOutput(data)).toThrow('bear.confidence');
  });

  it('bear.rationale が空配列の場合にエラーを投げる', () => {
    const data = buildValidDebateOutput();
    data.bear.rationale = [];
    expect(() => validateBullBearDebateOutput(data)).toThrow('bear.rationale');
  });

  it('synthesis が欠落している場合にエラーを投げる', () => {
    const data = { ...buildValidDebateOutput(), synthesis: undefined };
    expect(() => validateBullBearDebateOutput(data)).toThrow('synthesis must be an object');
  });

  it('不正な dominantBias を neutral にフォールバックする', () => {
    const data = buildValidDebateOutput();
    (data.marketContext as unknown as Record<string, unknown>).dominantBias = 'invalid';
    const result = validateBullBearDebateOutput(data);
    expect(result.marketContext.dominantBias).toBe('neutral');
  });

  it('不正な timeHorizon を both にフォールバックする', () => {
    const data = buildValidDebateOutput();
    (data.bull as unknown as Record<string, unknown>).timeHorizon = 'invalid';
    const result = validateBullBearDebateOutput(data);
    expect(result.bull.timeHorizon).toBe('both');
  });

  it('biasStrength を 0-100 にクランプする', () => {
    const data = buildValidDebateOutput();
    data.marketContext.biasStrength = -10;
    const result = validateBullBearDebateOutput(data);
    expect(result.marketContext.biasStrength).toBe(0);
  });

  it('phaseAnalysis が欠落していても空配列でフォールバックする', () => {
    const data = buildValidDebateOutput();
    (data.synthesis as unknown as Record<string, unknown>).phaseAnalysis = undefined;
    const result = validateBullBearDebateOutput(data);
    expect(result.synthesis.phaseAnalysis).toEqual([]);
  });
});

// ===========================================
// BullBearDebateAgent テスト
// ===========================================

describe('BullBearDebateAgent.debate', () => {
  let agent: BullBearDebateAgent;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AI_API_KEY = 'test-key';
    agent = new BullBearDebateAgent();
  });

  afterEach(() => {
    delete process.env.AI_API_KEY;
  });

  it('APIキー未設定時に safe-default (neutral) を返す', async () => {
    delete process.env.AI_API_KEY;
    agent = new BullBearDebateAgent({ apiKey: '' });
    const result = await agent.debate({
      symbol: 'XAUUSD',
      timeframe: '15m',
    });

    expect(result.output.synthesis.preferredDirection).toBe('neutral');
    expect(result.output.bull.scenario).toContain('スキップ');
    expect(result.tokenUsage).toBe(0);
    expect(result.model).toBe('fallback');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('正常な API レスポンスを処理する', async () => {
    mockAIResponse(buildValidDebateOutput());

    const result = await agent.debate({
      symbol: 'XAUUSD',
      timeframe: '15m',
    });

    expect(result.output.synthesis.preferredDirection).toBe('long');
    expect(result.output.bull.confidence).toBe(70);
    expect(result.output.bear.confidence).toBe(40);
    expect(result.tokenUsage).toBe(500);
    expect(result.model).toBe('test-model');
  });

  it('Phase 6.8: indicatorAnalysis 指定時は prompt に IndicatorSpecialist セクションが注入される', async () => {
    mockAIResponse(buildValidDebateOutput());
    await agent.debate({
      symbol: 'XAUUSD',
      timeframe: '15m',
      indicatorAnalysis: {
        interpretation: 'MTF テクニカル統合解釈、RSI と MACD で上昇継続シグナル',
        confidence: 0.7,
        current: {
          trendState: 'weak_up',
          trendStrength: 0.6,
          trendMaturity: 'middle',
          keyLevels: { support: [1.4], resistance: [1.55] },
          momentum: 'bullish',
          divergence: 'none',
          volatilityRegime: 'normal',
          breakoutRisk: 'medium',
          volumeSignal: 'normal',
        },
        higher: {
          trendState: 'weak_up',
          trendStrength: 0.5,
          keyLevels: { support: [1.35], resistance: [1.6] },
          momentum: 'bullish',
        },
        mtfAlignment: {
          trendAlignment: 'aligned_bullish',
          pullbackOpportunity: false,
          counterTrendSignal: false,
        },
        primaryIndicators: { current: ['rsi', 'macd'], higher: ['ichimoku'] },
      },
    });
    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    const userMessage = body.messages.find((m: { role: string }) => m.role === 'user').content;
    expect(userMessage).toContain('IndicatorSpecialist 分析');
    expect(userMessage).toContain('aligned_bullish');
  });

  it('API エラー時にフォールバックを返す', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('500 Internal'));

    const result = await agent.debate({
      symbol: 'XAUUSD',
      timeframe: '15m',
    });

    expect(result.output.synthesis.preferredDirection).toBe('neutral');
    expect(result.tokenUsage).toBe(0);
    expect(result.model).toBe('fallback');
  });

  it('不正な JSON ボディの時も fallback に落ちる', async () => {
    mockAIResponse({ invalid: 'schema' });

    const result = await agent.debate({
      symbol: 'XAUUSD',
      timeframe: '15m',
    });

    expect(result.model).toBe('fallback');
    expect(result.output.synthesis.preferredDirection).toBe('neutral');
  });

  it('bearish 優勢の討論結果を正しくパースする', async () => {
    const bearishOutput = buildValidDebateOutput();
    bearishOutput.marketContext.dominantBias = 'bearish';
    bearishOutput.bull.confidence = 30;
    bearishOutput.bear.confidence = 75;
    bearishOutput.synthesis.preferredDirection = 'short';
    bearishOutput.synthesis.preferredConfidence = 70;
    mockAIResponse(bearishOutput);

    const result = await agent.debate({
      symbol: 'XAUUSD',
      timeframe: '15m',
    });

    expect(result.output.synthesis.preferredDirection).toBe('short');
    expect(result.output.bear.confidence).toBe(75);
    expect(result.output.bull.confidence).toBe(30);
  });

  it('Markdown フェンス付きレスポンスを処理する', async () => {
    const mockOutput = buildValidDebateOutput();
    const fencedContent = '```json\n' + JSON.stringify(mockOutput) + '\n```';

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 1234567890,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: fencedContent },
              finish_reason: 'stop',
              logprobs: null,
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 400, total_tokens: 450 },
          model: 'test-model',
        }),
    });

    const result = await agent.debate({
      symbol: 'XAUUSD',
      timeframe: '15m',
    });

    expect(result.output.synthesis.preferredDirection).toBe('long');
    expect(result.tokenUsage).toBe(450);
  });
});
