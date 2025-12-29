/**
 * 拡張 AI 要約サービス
 * 
 * 目的: 既存の AISummaryService を拡張し、インジケーター統合とより詳細なテンプレートを提供
 * 
 * 機能:
 * - 特徴量スナップショットからの市場コンテキスト生成
 * - 詳細なテンプレートフォールバック
 * - 再試行ロジック
 * - トークン使用量の最適化
 * 
 * 参照: 技術スタック選定シート ⑦
 */

import { config } from '../config';
import {
  IndicatorService,
  FeatureSnapshot,
} from './indicators/indicatorService';
import {
  AISummaryService,
  TradeDataForSummary,
  AISummaryResult,
} from './aiSummaryService';

const indicatorService = new IndicatorService();

/**
 * 拡張トレードデータ（インジケーター情報を含む）
 */
export interface ExtendedTradeData extends TradeDataForSummary {
  /** 特徴量スナップショット */
  featureSnapshot?: FeatureSnapshot;
  /** 判断モード推定 */
  estimatedMode?: 'trend_follow' | 'counter_trend' | 'neutral';
  /** 類似過去トレードの結果 */
  similarTrades?: {
    count: number;
    avgProfit?: number;
    winRate?: number;
  };
}

/**
 * テンプレート種別
 */
type TemplateType = 
  | 'trend_follow_buy'    // 順張り買い
  | 'trend_follow_sell'   // 順張り売り
  | 'counter_trend_buy'   // 逆張り買い
  | 'counter_trend_sell'  // 逆張り売り
  | 'neutral';            // ニュートラル

/**
 * 拡張 AI 要約サービス
 */
export class EnhancedAISummaryService {
  private baseService: AISummaryService;
  private apiKey: string;
  private model: string;
  private baseURL: string;
  private maxRetries: number;

  constructor() {
    this.baseService = new AISummaryService();
    this.apiKey = config.ai.apiKey;
    this.model = config.ai.model;
    this.baseURL = config.ai.baseURL || 'https://api.openai.com/v1';
    this.maxRetries = 3;
  }

  /**
   * 拡張トレード要約を生成
   * 
   * @param tradeData - 拡張トレードデータ
   * @returns AI 要約結果
   */
  async generateEnhancedSummary(tradeData: ExtendedTradeData): Promise<AISummaryResult> {
    // 特徴量スナップショットから市場コンテキストを生成
    if (tradeData.featureSnapshot && !tradeData.marketContext) {
      tradeData.marketContext = this.buildMarketContextFromSnapshot(tradeData.featureSnapshot);
    }

    // 判断モードを推定
    if (!tradeData.estimatedMode && tradeData.featureSnapshot) {
      tradeData.estimatedMode = this.estimateDecisionMode(
        tradeData.side,
        tradeData.featureSnapshot
      );
    }

    // API キーがない場合は詳細テンプレートにフォールバック
    if (!this.apiKey) {
      console.warn('AI API キーが設定されていません。詳細テンプレートを使用します。');
      return {
        summary: this.generateDetailedTemplateSummary(tradeData),
        model: 'template-fallback',
      };
    }

    // リトライ付きで API 呼び出し
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.callEnhancedAIAPI(tradeData);
      } catch (error) {
        lastError = error as Error;
        console.warn(`AI 要約生成リトライ (${attempt}/${this.maxRetries}):`, error);
        
        if (attempt < this.maxRetries) {
          // 指数バックオフ
          await this.sleep(1000 * Math.pow(2, attempt - 1));
        }
      }
    }

    // 全リトライ失敗時はテンプレートにフォールバック
    console.error('AI 要約生成が全リトライ失敗:', lastError);
    return {
      summary: this.generateDetailedTemplateSummary(tradeData),
      model: 'template-fallback-error',
    };
  }

  /**
   * 特徴量スナップショットから市場コンテキストを構築
   */
  private buildMarketContextFromSnapshot(snapshot: FeatureSnapshot): TradeDataForSummary['marketContext'] {
    const trend = indicatorService.determineTrend(snapshot);
    
    // MACD ヒストグラムの最新値を取得
    let macdValue: number | undefined;
    if (snapshot.macd?.histogram && snapshot.macd.histogram.length > 0) {
      macdValue = snapshot.macd.histogram[snapshot.macd.histogram.length - 1];
    }

    return {
      trend,
      rsi: snapshot.rsi,
      macd: macdValue,
      timeframe: snapshot.timeframe,
    };
  }

  /**
   * 判断モードを推定（順張り/逆張り）
   */
  private estimateDecisionMode(
    side: 'buy' | 'sell',
    snapshot: FeatureSnapshot
  ): ExtendedTradeData['estimatedMode'] {
    const trend = indicatorService.determineTrend(snapshot);
    
    // 買いの場合
    if (side === 'buy') {
      if (trend === 'uptrend') {
        return 'trend_follow';   // 上昇トレンドで買い = 順張り
      } else if (trend === 'downtrend') {
        return 'counter_trend';  // 下降トレンドで買い = 逆張り
      }
    }
    
    // 売りの場合
    if (side === 'sell') {
      if (trend === 'downtrend') {
        return 'trend_follow';   // 下降トレンドで売り = 順張り
      } else if (trend === 'uptrend') {
        return 'counter_trend';  // 上昇トレンドで売り = 逆張り
      }
    }
    
    return 'neutral';
  }

  /**
   * 詳細テンプレート要約を生成（AI 未使用）
   */
  private generateDetailedTemplateSummary(tradeData: ExtendedTradeData): string {
    const { symbol, side, price, quantity, timestamp, marketContext, estimatedMode, similarTrades, featureSnapshot } = tradeData;
    
    const sideLabel = side === 'buy' ? '買い' : '売り';
    const dateStr = timestamp.toLocaleDateString('ja-JP');
    const timeStr = timestamp.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    
    // テンプレート種別を決定
    const templateType = this.getTemplateType(side, marketContext?.trend, estimatedMode);
    
    // 基本情報
    let summary = `【${dateStr} ${timeStr}】${symbol} ${sideLabel}エントリー\n`;
    summary += `価格: ${price.toLocaleString()}, 数量: ${quantity}\n\n`;
    
    // テンプレート別のコメント
    summary += this.getTemplateComment(templateType, marketContext);
    
    // インジケーター情報
    if (featureSnapshot || marketContext) {
      summary += '\n\n【市場状況】\n';
      
      const rsi = featureSnapshot?.rsi ?? marketContext?.rsi;
      if (rsi !== undefined) {
        const rsiComment = rsi > 70 ? '（買われすぎ）' : rsi < 30 ? '（売られすぎ）' : '';
        summary += `・RSI: ${rsi.toFixed(1)}${rsiComment}\n`;
      }
      
      if (featureSnapshot?.sma !== undefined) {
        const priceVsSma = featureSnapshot.close > featureSnapshot.sma ? '上' : '下';
        summary += `・SMA${featureSnapshot.timeframe || ''}: ${priceVsSma}に位置\n`;
      }
      
      const macd = featureSnapshot?.macd?.histogram?.[featureSnapshot.macd.histogram.length - 1] ?? marketContext?.macd;
      if (macd !== undefined) {
        const macdSignal = macd > 0 ? 'プラス圏' : 'マイナス圏';
        summary += `・MACD: ${macdSignal}\n`;
      }
    }
    
    // 類似トレード情報
    if (similarTrades && similarTrades.count > 0) {
      summary += '\n\n【過去の類似トレード】\n';
      summary += `・類似件数: ${similarTrades.count}件\n`;
      if (similarTrades.winRate !== undefined) {
        summary += `・勝率: ${(similarTrades.winRate * 100).toFixed(1)}%\n`;
      }
    }
    
    return summary;
  }

  /**
   * テンプレート種別を決定
   */
  private getTemplateType(
    side: 'buy' | 'sell',
    trend?: 'uptrend' | 'downtrend' | 'neutral',
    estimatedMode?: 'trend_follow' | 'counter_trend' | 'neutral'
  ): TemplateType {
    if (estimatedMode === 'trend_follow') {
      return side === 'buy' ? 'trend_follow_buy' : 'trend_follow_sell';
    }
    if (estimatedMode === 'counter_trend') {
      return side === 'buy' ? 'counter_trend_buy' : 'counter_trend_sell';
    }
    return 'neutral';
  }

  /**
   * テンプレート別コメントを生成
   */
  private getTemplateComment(
    templateType: TemplateType,
    marketContext?: TradeDataForSummary['marketContext']
  ): string {
    switch (templateType) {
      case 'trend_follow_buy':
        return '【判断】上昇トレンドに乗る順張りエントリー。トレンド継続を想定。\n' +
               '損切りラインと利確目標を事前に設定し、トレーリングストップの検討を推奨。';
      
      case 'trend_follow_sell':
        return '【判断】下降トレンドに乗る順張りショートエントリー。下落継続を想定。\n' +
               '反発リスクに注意し、損切りラインを明確に設定。';
      
      case 'counter_trend_buy':
        return '【判断】下降トレンド中の逆張り買いエントリー。反発を狙う。\n' +
               '売られすぎからの反発を期待。損切りを浅めに設定し、リスク管理を徹底。';
      
      case 'counter_trend_sell':
        return '【判断】上昇トレンド中の逆張り売りエントリー。調整を狙う。\n' +
               '買われすぎからの調整を期待。上昇継続リスクに注意。';
      
      case 'neutral':
      default:
        return '【判断】明確なトレンドがない状況でのエントリー。\n' +
               'レンジ内の動きを想定し、上下のサポート/レジスタンスに注目。';
    }
  }

  /**
   * 拡張プロンプトで AI API を呼び出す
   */
  private async callEnhancedAIAPI(tradeData: ExtendedTradeData): Promise<AISummaryResult> {
    const prompt = this.buildEnhancedPrompt(tradeData);
    
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'あなたはプロのトレードアナリストです。トレードデータを分析し、判断の背景と市場状況を含めた簡潔な日本語要約を生成してください。5行以内で記述し、冗長な表現は避けてください。',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 200,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI API エラー: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    
    return {
      summary: data.choices[0].message.content.trim(),
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      model: data.model,
    };
  }

  /**
   * 拡張プロンプトを構築
   */
  private buildEnhancedPrompt(tradeData: ExtendedTradeData): string {
    const { symbol, side, price, quantity, timestamp, marketContext, estimatedMode, featureSnapshot, similarTrades } = tradeData;
    
    const sideLabel = side === 'buy' ? '買い' : '売り';
    const dateStr = timestamp.toLocaleString('ja-JP');
    
    let prompt = '以下のトレード情報から、判断の背景と市場状況を含めた要約を生成してください。\n\n';
    
    prompt += `【基本情報】\n`;
    prompt += `銘柄: ${symbol}, 売買: ${sideLabel}, 価格: ${price}, 数量: ${quantity}\n`;
    prompt += `日時: ${dateStr}\n`;
    
    if (estimatedMode) {
      const modeLabel = 
        estimatedMode === 'trend_follow' ? '順張り' :
        estimatedMode === 'counter_trend' ? '逆張り' : 'ニュートラル';
      prompt += `推定判断モード: ${modeLabel}\n`;
    }
    
    if (marketContext) {
      prompt += `\n【市場状況】\n`;
      if (marketContext.trend) {
        const trendLabel = 
          marketContext.trend === 'uptrend' ? '上昇トレンド' :
          marketContext.trend === 'downtrend' ? '下降トレンド' : '横ばい';
        prompt += `トレンド: ${trendLabel}\n`;
      }
      if (marketContext.rsi !== undefined) {
        prompt += `RSI: ${marketContext.rsi.toFixed(1)}\n`;
      }
      if (marketContext.macd !== undefined) {
        prompt += `MACD: ${marketContext.macd.toFixed(2)}\n`;
      }
    }
    
    if (similarTrades && similarTrades.count > 0) {
      prompt += `\n【過去類似トレード】\n`;
      prompt += `件数: ${similarTrades.count}件`;
      if (similarTrades.winRate !== undefined) {
        prompt += `, 勝率: ${(similarTrades.winRate * 100).toFixed(1)}%`;
      }
      prompt += '\n';
    }
    
    prompt += '\n【要件】\n';
    prompt += '- 日本語5行以内で簡潔に\n';
    prompt += '- 判断の根拠を明記\n';
    prompt += '- リスク管理の観点を含める\n';
    
    return prompt;
  }

  /**
   * スリープユーティリティ
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// シングルトンインスタンス
export const enhancedAISummaryService = new EnhancedAISummaryService();
