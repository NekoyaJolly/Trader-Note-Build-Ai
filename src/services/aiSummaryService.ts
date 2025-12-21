import { config } from '../config';

/**
 * Service for generating AI summaries using external AI API
 */
export class AISummaryService {
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = config.ai.apiKey;
    this.model = config.ai.model;
  }

  /**
   * Generate a concise summary of a trade
   * Token-efficient and accountability-focused
   */
  async generateTradeSummary(tradeData: {
    symbol: string;
    side: string;
    price: number;
    quantity: number;
    timestamp: Date;
    marketContext?: any;
  }): Promise<string> {
    // If no API key is configured, return a basic summary
    if (!this.apiKey) {
      return this.generateBasicSummary(tradeData);
    }

    try {
      const prompt = this.buildPrompt(tradeData);
      const summary = await this.callAIAPI(prompt);
      return summary;
    } catch (error) {
      console.error('Error generating AI summary:', error);
      return this.generateBasicSummary(tradeData);
    }
  }

  /**
   * Build a token-efficient prompt for the AI
   */
  private buildPrompt(tradeData: any): string {
    const { symbol, side, price, quantity, timestamp, marketContext } = tradeData;
    
    let prompt = `Summarize this trade in 1-2 sentences:\n`;
    prompt += `- Action: ${side.toUpperCase()} ${quantity} ${symbol} at $${price}\n`;
    prompt += `- Time: ${timestamp.toISOString()}\n`;
    
    if (marketContext) {
      prompt += `- Market: ${marketContext.trend || 'N/A'} trend\n`;
      if (marketContext.indicators) {
        prompt += `- Indicators: RSI=${marketContext.indicators.rsi || 'N/A'}\n`;
      }
    }
    
    prompt += `\nProvide a brief explanation of the trade context and rationale.`;
    
    return prompt;
  }

  /**
   * Call the AI API (placeholder for actual implementation)
   */
  private async callAIAPI(prompt: string): Promise<string> {
    // This is a placeholder. In production, this would call OpenAI or similar API
    // Example with OpenAI:
    // const response = await fetch('https://api.openai.com/v1/chat/completions', {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'Authorization': `Bearer ${this.apiKey}`
    //   },
    //   body: JSON.stringify({
    //     model: this.model,
    //     messages: [{ role: 'user', content: prompt }],
    //     max_tokens: 150
    //   })
    // });
    
    console.log('AI API call (simulated):', prompt);
    
    // Return a simulated response
    return `Trade executed during market conditions. This is a simulated AI summary.`;
  }

  /**
   * Generate a basic summary without AI
   */
  private generateBasicSummary(tradeData: any): string {
    const { symbol, side, price, quantity, timestamp } = tradeData;
    return `${side.toUpperCase()} ${quantity} ${symbol} at $${price} on ${timestamp.toLocaleDateString()}`;
  }
}
