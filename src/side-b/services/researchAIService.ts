/**
 * Market Analyst AI サービス（旧 Research AI）
 * 
 * 目的: 市場データを分析し、リッチな市場分析レポートを生成
 * 
 * 設計思想:
 * - 旧: OHLCVデータ → 12次元数値ベクトル（解釈なし）
 * - 新: OHLCVデータ + インジケーター → 構造化分析 + 推論テキスト
 * - AIが市場を「読む」— トレンド、サポレジ、リスク要因を判断
 * - 出力は人間が読んでも理解でき、Strategy Thinker が使える
 * 
 * 使用モデル: Gemini 2.0 Flash（環境変数から取得）
 */

import { config, modelFor } from '../../config';
import { AI_MAX_TOKENS } from '../../config/aiTokenLimits';
import {
  type MarketAnalysis,
  validateMarketAnalysis,
  analysisToLegacyFeatureVector,
} from '../models/marketAnalysis';
import type { ResearchAIOutput , OHLCVSnapshot} from '../models/marketResearch';
import { calculateExpiryDate } from '../models/marketResearch';
import { getRelevantIndicatorContext } from '../knowledge';
import { AIProvider } from '../agent/aiProvider';
import { loadPromptWithGlobal } from '../prompts/loader';
import { PromptRegistry } from '../prompts/registry/PromptRegistry';
import { safeStringify } from '../../utils/safeStringify';
import type { JsonValue } from '../../utils/jsonValue';

const RESEARCH_AGENT_NAME = 'research';
// Phase A: EODHD 外部要因 context 型 (PR #2 で配線)
import type {
  NewsContext,
  SentimentContext,
  EconomicEventsContext,
  MacroContext,
  FundamentalsContext,
} from '../../schemas/external/eodhd';

// ===========================================
// 型定義
// ===========================================

/**
 * Market Analyst への入力データ
 *
 * Phase A: 外部要因 context (newsContext / sentimentContext / economicEvents /
 * macroContext / fundamentalsContext) を optional 追加。aiOrchestrator が
 * EODHD から取得して詰める。各 context は EODHD 取得失敗時 undefined のまま、
 * researchAIService 側は欠落許容 (OHLCV だけで分析継続可能)。
 */
export interface ResearchAIInput {
  symbol: string;
  timeframe?: string;
  ohlcvData: OHLCVData[];
  indicators?: IndicatorData;
  /** EODHD News API から取得した上位記事サマリ (Phase A) */
  newsContext?: NewsContext;
  /** EODHD Sentiments API の日次センチメント時系列 (Phase A) */
  sentimentContext?: SentimentContext;
  /** EODHD EconomicEvents カレンダー (Phase A) */
  economicEvents?: EconomicEventsContext;
  /** EODHD MacroIndicator の時系列 (Phase A) */
  macroContext?: MacroContext;
  /** EODHD Fundamentals (株式系シンボルのみ、FX/Crypto/Commodity では undefined) (Phase A) */
  fundamentalsContext?: FundamentalsContext;
}

/**
 * OHLCVデータ
 */
export interface OHLCVData {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/**
 * インジケーターデータ（事前計算済み）
 */
export interface IndicatorData {
  rsi?: number;
  macd?: { value: number; signal: number; histogram: number };
  sma20?: number;
  sma50?: number;
  sma200?: number;
  ema20?: number;
  atr?: number;
  bbUpper?: number;
  bbLower?: number;
  bbMiddle?: number;
}

/**
 * Market Analyst の結果
 */
export interface ResearchAIResult {
  output: ResearchAIOutput;
  /** 新しいリッチ分析データ */
  marketAnalysis: MarketAnalysis;
  ohlcvSnapshot: OHLCVSnapshot;
  expiresAt: Date;
  tokenUsage: number;
  model: string;
}

// ===========================================
// サービスクラス
// ===========================================

/**
 * ResearchAIService 依存性 (テスト差し替え用)。reflectionAIService と同パターン。
 */
export interface ResearchAIServiceDeps {
  registry?: PromptRegistry;
}

export class ResearchAIService {
  private apiKey: string;
  private model: string;
  private baseURL: string;
  private _registry: PromptRegistry | null;

  constructor(deps: ResearchAIServiceDeps = {}) {
    this.apiKey = process.env.AI_API_KEY || '';
    this.model = modelFor('research');
    this.baseURL = process.env.AI_BASE_URL || config.ai.baseURL || 'https://api.openai.com/v1';
    this._registry = deps.registry ?? null;
  }

  /** registry の遅延アクセサ。reflectionAIService と同パターン。 */
  private get registry(): PromptRegistry {
    if (!this._registry) {
      this._registry = new PromptRegistry();
    }
    return this._registry;
  }

  /**
   * P2: Registry の active を取得し global + agent prompt を合成して返す。
   * 取得失敗時はファイル fallback (フェイルオープン)、ただし `loadPromptWithGlobal`
   * で `__global__` ルールも前置することで Registry 経路との同等性を保つ
   * (PR #241 Copilot review 対応、planAIService と同パターン)。
   */
  private async loadSystemPrompt(): Promise<string> {
    try {
      return await this.registry.getCompositeActive(RESEARCH_AGENT_NAME);
    } catch (err) {
      console.warn(
        `[MarketAnalyst] PromptRegistry 取得失敗、ファイル fallback (${RESEARCH_AGENT_NAME}):`,
        safeStringify(err),
      );
      return loadPromptWithGlobal(RESEARCH_AGENT_NAME);
    }
  }

  /**
   * 市場分析を生成
   */
  async generateResearch(input: ResearchAIInput): Promise<ResearchAIResult> {
    const ohlcvSnapshot = this.createOHLCVSnapshot(input.ohlcvData);

    if (!this.apiKey) {
      console.warn('[MarketAnalyst] APIキーが設定されていません。フォールバックデータを返します。');
      return this.generateFallbackResult(input.symbol, ohlcvSnapshot);
    }

    try {
      const prompt = this.buildPrompt(input, ohlcvSnapshot);
      const result = await this.callAI(prompt);

      // MarketAnalysis のバリデーション
      const marketAnalysis = validateMarketAnalysis(result.content);

      // 後方互換: featureVector を MarketAnalysis から生成
      const legacyFeatureVector = analysisToLegacyFeatureVector(marketAnalysis);

      console.log(`[MarketAnalyst] ${input.symbol} 分析完了: ${marketAnalysis.regime} / ${marketAnalysis.direction} / 信頼度${marketAnalysis.confidence}%`);

      return {
        output: { featureVector: legacyFeatureVector },
        marketAnalysis,
        ohlcvSnapshot,
        expiresAt: calculateExpiryDate(4),
        tokenUsage: result.tokenUsage,
        model: result.model,
      };
    } catch (error) {
      console.error('[MarketAnalyst] エラー:', error);

      // リトライ（最大2回）
      for (let i = 0; i < 2; i++) {
        try {
          console.log(`[MarketAnalyst] リトライ ${i + 1}/2`);
          const prompt = this.buildPrompt(input, ohlcvSnapshot);
          const result = await this.callAI(prompt);
          const marketAnalysis = validateMarketAnalysis(result.content);
          const legacyFeatureVector = analysisToLegacyFeatureVector(marketAnalysis);

          return {
            output: { featureVector: legacyFeatureVector },
            marketAnalysis,
            ohlcvSnapshot,
            expiresAt: calculateExpiryDate(4),
            tokenUsage: result.tokenUsage,
            model: result.model,
          };
        } catch (retryError) {
          console.error(`[MarketAnalyst] リトライ ${i + 1} 失敗:`, retryError);
        }
      }

      return this.generateFallbackResult(input.symbol, ohlcvSnapshot);
    }
  }

  /**
   * OHLCVスナップショットを作成
   */
  private createOHLCVSnapshot(ohlcvData: OHLCVData[]): OHLCVSnapshot {
    const recentData = ohlcvData.slice(-100);
    const latestPrice = recentData[recentData.length - 1]?.close || 0;

    const highs = recentData.map(d => d.high);
    const lows = recentData.map(d => d.low);
    const closes = recentData.map(d => d.close);

    return {
      latestPrice,
      recentHigh: Math.max(...highs),
      recentLow: Math.min(...lows),
      dataPoints: recentData.length,
      recentCloses: closes.slice(-10),
    };
  }

  /**
   * プロンプトを構築 — 市場を「読む」ためのリッチな分析指示
   */
  private buildPrompt(input: ResearchAIInput, snapshot: OHLCVSnapshot): string {
    const { symbol, ohlcvData, indicators } = input;

    // 直近のOHLCVを要約
    const recentBars = ohlcvData.slice(-20).map(d =>
      `${new Date(d.timestamp).toISOString().slice(5, 16)} O:${d.open.toFixed(2)} H:${d.high.toFixed(2)} L:${d.low.toFixed(2)} C:${d.close.toFixed(2)}`
    ).join('\n');

    // 価格レンジ（直近の高安値）
    const rangeSize = snapshot.recentHigh - snapshot.recentLow;
    // rangeSize が 0（高値=安値）の場合は 0 除算を避けるため、現在位置を 50% に固定する
    const currentPosition =
      rangeSize === 0
        ? '50.0'
        : ((snapshot.latestPrice - snapshot.recentLow) / rangeSize * 100).toFixed(1);

    // Phase A: 外部要因 context を整形 (PR #2)
    const externalContextSection = this.buildExternalContextSection(input);

    return `# 市場分析リクエスト

## あなたの役割
あなたは経験豊富なFXトレーダーです。以下のデータを分析し、市場の状態を正確に把握してください。
再現性のあるトレード判断の基盤となる分析を提供してください。

## 対象
- シンボル: ${symbol}
- データ数: ${snapshot.dataPoints}本

## 価格データ
- 現在値: ${snapshot.latestPrice}
- 直近高値: ${snapshot.recentHigh}
- 直近安値: ${snapshot.recentLow}
- レンジ内位置: ${currentPosition}%（0%=安値、100%=高値）
- 直近終値(10本): ${snapshot.recentCloses.map(c => c.toFixed(2)).join(', ')}

## 直近20本の値動き
${recentBars}

## テクニカル指標
${indicators ? `
- RSI: ${indicators.rsi ?? 'N/A'}
- MACD: ${indicators.macd ? `${indicators.macd.value.toFixed(4)} (シグナル: ${indicators.macd.signal.toFixed(4)}, ヒストグラム: ${indicators.macd.histogram.toFixed(4)})` : 'N/A'}
- SMA20: ${indicators.sma20?.toFixed(2) ?? 'N/A'}
- SMA50: ${indicators.sma50?.toFixed(2) ?? 'N/A'}
- SMA200: ${indicators.sma200?.toFixed(2) ?? 'N/A'}
- EMA20: ${indicators.ema20?.toFixed(2) ?? 'N/A'}
- ATR: ${indicators.atr?.toFixed(2) ?? 'N/A'}
- BB上限: ${indicators.bbUpper?.toFixed(2) ?? 'N/A'}, BB下限: ${indicators.bbLower?.toFixed(2) ?? 'N/A'}, BB中央: ${indicators.bbMiddle?.toFixed(2) ?? 'N/A'}
` : 'テクニカル指標は事前計算なし。OHLCVデータから推定してください。'}
${externalContextSection}
## 分析タスク

以下の3つの観点で分析してください:

### 1. 市場環境の把握
- 今の相場は何をしているか？（トレンド/レンジ/ブレイクアウト等）
- その判断の根拠は？

### 2. キーレベルの特定
- 機能しているサポート/レジスタンスレベルはどこか？
- 各レベルの強度と根拠は？

### 3. リスク要因
- 現在の市場で注意すべきことは何か？

## 出力形式（JSON）

\`\`\`json
{
  "regime": "strong_uptrend" | "weak_uptrend" | "range" | "weak_downtrend" | "strong_downtrend" | "breakout" | "choppy",
  "direction": "bullish" | "bearish" | "neutral",
  "volatility": "high" | "medium" | "low",
  "confidence": <0-100>,
  "keyLevels": [
    {
      "price": <数値>,
      "type": "support" | "resistance",
      "strength": "strong" | "moderate" | "weak",
      "basis": "<このレベルの根拠>"
    }
  ],
  "reasoning": {
    "trendAnalysis": "<トレンドの判断根拠を1-2文で>",
    "momentumAnalysis": "<モメンタムの状態を1-2文で>",
    "volatilityAnalysis": "<ボラティリティの見通しを1-2文で>",
    "keyObservation": "<最も重要な観察ポイント>",
    "riskFactors": ["<リスク1>", "<リスク2>"]
  },
  "quickScores": {
    "trendStrength": <0-100>,
    "momentum": <0-100>,
    "volatility": <0-100>,
    "supportProximity": <0-100: 100=サポート直近>,
    "resistanceProximity": <0-100: 100=レジスタンス直近>
  }
}
\`\`\`

重要:
- keyLevelsは最低2個、最大8個。重要度の高い順に。
- reasoningは簡潔だが根拠のある文章で（「〜だから」「〜のため」のように理由を明記）。
- confidence はデータの質と分析の確実性に基づいて正直に。
- 有効なJSONのみを出力してください。

${getRelevantIndicatorContext(
            // IndicatorData は数値 / オブジェクトのみで構成され JSON 互換のため、
            // getRelevantIndicatorContext の Record<string, IndicatorContextValue> へ構造的に橋渡しできる。
            indicators as Record<string, JsonValue>
        )}`;
  }

  /**
   * Phase A: 外部要因 context (News / Sentiment / Economic Events / Macro / Fundamentals)
   * を AI プロンプト用テキストに整形する。
   *
   * いずれの context も optional。すべて undefined なら空文字を返し、プロンプトには出さない。
   */
  private buildExternalContextSection(input: ResearchAIInput): string {
    const lines: string[] = [];

    if (input.newsContext && input.newsContext.topItems.length > 0) {
      lines.push(
        `### News (最新 ${input.newsContext.topItems.length} 件 / 全 ${input.newsContext.totalCount} 件)`,
      );
      for (const news of input.newsContext.topItems) {
        const sentiment =
          news.sentimentPolarity !== undefined
            ? ` [sentiment: ${news.sentimentPolarity.toFixed(2)}]`
            : '';
        const tags = news.tags && news.tags.length > 0 ? ` (${news.tags.join(', ')})` : '';
        lines.push(`- ${news.date.slice(0, 10)}: ${news.title}${sentiment}${tags}`);
      }
    }

    if (input.sentimentContext && input.sentimentContext.points.length > 0) {
      const recent = input.sentimentContext.points.slice(-7);
      lines.push(`### Sentiment (直近 ${recent.length} 日)`);
      for (const p of recent) {
        const normStr = p.normalized !== undefined ? p.normalized.toFixed(2) : 'N/A';
        lines.push(`- ${p.date}: count=${p.count}, normalized=${normStr}`);
      }
    }

    if (input.economicEvents && input.economicEvents.topItems.length > 0) {
      lines.push(
        `### Economic Events (上位 ${Math.min(input.economicEvents.topItems.length, 5)} 件 / 全 ${input.economicEvents.totalCount} 件)`,
      );
      for (const ev of input.economicEvents.topItems.slice(0, 5)) {
        const parts = [ev.date, ev.country, ev.type].filter(Boolean).join(' ');
        const metrics = [
          ev.actual !== undefined ? `actual=${ev.actual}` : null,
          ev.estimate !== undefined ? `est=${ev.estimate}` : null,
          ev.previous !== undefined ? `prev=${ev.previous}` : null,
        ]
          .filter(Boolean)
          .join(', ');
        lines.push(`- ${parts}${metrics ? `: ${metrics}` : ''}`);
      }
    }

    if (input.macroContext && input.macroContext.points.length > 0) {
      const indicator = input.macroContext.indicator ?? 'default';
      lines.push(`### Macro Indicator: ${indicator} (${input.macroContext.country})`);
      const recent = input.macroContext.points.slice(-6);
      lines.push(`- ${recent.map((p) => `${p.date}: ${p.value}`).join(' | ')}`);
    }

    if (input.fundamentalsContext?.available && input.fundamentalsContext.highlights) {
      const h = input.fundamentalsContext.highlights;
      const fundamentalLines: string[] = [];
      if (h.sector) fundamentalLines.push(`Sector: ${h.sector}`);
      if (h.industry) fundamentalLines.push(`Industry: ${h.industry}`);
      if (h.marketCapitalization !== undefined)
        fundamentalLines.push(`Market Cap: ${h.marketCapitalization.toLocaleString()}`);
      if (h.peRatio !== undefined) fundamentalLines.push(`PE Ratio: ${h.peRatio.toFixed(2)}`);
      if (h.dividendYield !== undefined)
        fundamentalLines.push(`Dividend Yield: ${(h.dividendYield * 100).toFixed(2)}%`);
      if (fundamentalLines.length > 0) {
        lines.push('### Fundamentals (株式系シンボル)');
        for (const fl of fundamentalLines) lines.push(`- ${fl}`);
      }
    }

    if (lines.length === 0) return '';
    return '\n## 外部要因 (EODHD 取得、Phase A)\n\n' + lines.join('\n') + '\n';
  }

  /**
   * AI APIを呼び出し (AIProvider 経由)
   *
   * `content` は AI レスポンス未検証段階の値だが、JSON.parse 由来で構造的に `JsonValue` 互換。
   * 呼び出し側で `validateMarketAnalysis` (Zod) による narrow を行う契約。
   */
  private async callAI(prompt: string): Promise<{ content: JsonValue; tokenUsage: number; model: string }> {
    const provider = new AIProvider({
      apiKey: this.apiKey,
      model: this.model,
      baseURL: this.baseURL,
    });

    const systemPrompt = await this.loadSystemPrompt();
    const aiResponse = await provider.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.3, maxTokens: AI_MAX_TOKENS.MEDIUM, responseFormat: { type: 'json_object' } },
    );

    const content = aiResponse.content;
    if (!content) {
      throw new Error('AI APIからの応答が空です');
    }

    const parsed = JSON.parse(content) as JsonValue;

    return {
      content: parsed,
      tokenUsage: aiResponse.tokenUsage,
      model: aiResponse.model,
    };
  }

  /**
   * フォールバック結果を生成（API失敗時）
   */
  private generateFallbackResult(symbol: string, ohlcvSnapshot: OHLCVSnapshot): ResearchAIResult {
    const fallbackAnalysis: MarketAnalysis = {
      regime: 'range',
      direction: 'neutral',
      volatility: 'medium',
      confidence: 0,
      keyLevels: [
        {
          price: ohlcvSnapshot.recentHigh,
          type: 'resistance',
          strength: 'moderate',
          basis: '直近高値（フォールバック）',
        },
        {
          price: ohlcvSnapshot.recentLow,
          type: 'support',
          strength: 'moderate',
          basis: '直近安値（フォールバック）',
        },
      ],
      reasoning: {
        trendAnalysis: 'AI分析に失敗したため判断不可。',
        momentumAnalysis: 'AI分析に失敗したため判断不可。',
        volatilityAnalysis: 'AI分析に失敗したため判断不可。',
        keyObservation: 'フォールバックデータのため、実際の市場分析ではありません。',
        riskFactors: ['AI分析失敗 — このデータに基づいたトレードは推奨しません'],
      },
      quickScores: {
        trendStrength: 50,
        momentum: 50,
        volatility: 50,
        supportProximity: 50,
        resistanceProximity: 50,
      },
    };

    const legacyFeatureVector = analysisToLegacyFeatureVector(fallbackAnalysis);

    console.warn(`[MarketAnalyst] ${symbol}: フォールバックデータを使用`);

    return {
      output: { featureVector: legacyFeatureVector },
      marketAnalysis: fallbackAnalysis,
      ohlcvSnapshot,
      expiresAt: calculateExpiryDate(1),
      tokenUsage: 0,
      model: 'fallback',
    };
  }
}

// デフォルトインスタンス
export const researchAIService = new ResearchAIService();
