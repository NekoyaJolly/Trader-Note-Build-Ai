import { Trade, TradeNote } from '../models/types';
import { AISummaryService } from './aiSummaryService';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

/**
 * Service for generating structured trade notes
 */
export class TradeNoteService {
  private aiService: AISummaryService;
  private notesPath: string;

  constructor() {
    this.aiService = new AISummaryService();
    this.notesPath = path.join(process.cwd(), config.paths.notes);
    this.ensureNotesDirectory();
  }

  /**
   * Generate a structured trade note from a trade
   */
  async generateNote(trade: Trade, marketContext?: any): Promise<TradeNote> {
    // Generate AI summary
    const aiSummary = await this.aiService.generateTradeSummary({
      symbol: trade.symbol,
      side: trade.side,
      price: trade.price,
      quantity: trade.quantity,
      timestamp: trade.timestamp,
      marketContext,
    });

    // Extract features for matching
    const features = this.extractFeatures(trade, marketContext);

    // 判断モードを推定（RSI ベースのヒューリスティック）
    const modeEstimated = this.estimateDecisionMode(trade, marketContext);

    const note: TradeNote = {
      id: uuidv4(),
      tradeId: trade.id,
      timestamp: trade.timestamp,
      symbol: trade.symbol,
      side: trade.side,
      entryPrice: trade.price,
      quantity: trade.quantity,
      marketContext: marketContext || {
        timeframe: '15m',
        trend: 'neutral' as const,
      },
      aiSummary: aiSummary.summary,
      features,
      createdAt: new Date(),
      status: 'draft',
      modeEstimated,
    };

    return note;
  }

  /**
   * 判断モードを推定（順張り/逆張り）
   * RSI とトレンドに基づく簡易ヒューリスティック
   */
  private estimateDecisionMode(trade: Trade, marketContext?: any): string {
    const rsi = marketContext?.indicators?.rsi;
    const trend = marketContext?.trend;
    const side = trade.side;

    // RSI が取得できない場合は未推定
    if (rsi === undefined || rsi === null) {
      return '未推定';
    }

    // RSI ベースの判断モード推定
    // 順張り: トレンド方向にエントリー
    // 逆張り: トレンドに逆らってエントリー（RSI 極端値で反転狙い）
    if (side === 'buy') {
      // 買いエントリー
      if (rsi < 30) {
        // RSI 売られすぎで買い → 逆張り
        return '逆張り';
      } else if (rsi > 50 && (trend === 'bullish' || trend === 'neutral')) {
        // RSI 中立以上 & 上昇/横ばいトレンドで買い → 順張り
        return '順張り';
      }
    } else {
      // 売りエントリー
      if (rsi > 70) {
        // RSI 買われすぎで売り → 逆張り
        return '逆張り';
      } else if (rsi < 50 && (trend === 'bearish' || trend === 'neutral')) {
        // RSI 中立以下 & 下降/横ばいトレンドで売り → 順張り
        return '順張り';
      }
    }

    return '未推定';
  }

  /**
   * トレードノートをストレージに保存
   */
  async saveNote(note: TradeNote): Promise<void> {
    const filename = `${note.id}.json`;
    const filepath = path.join(this.notesPath, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(note, null, 2));
    // 本番環境ではデバッグログを抑制
    if (process.env.NODE_ENV !== 'production') {
      console.log(`Saved trade note: ${filename}`);
    }
  }

  /**
   * Load all trade notes from storage
   */
  async loadAllNotes(): Promise<TradeNote[]> {
    const notes: TradeNote[] = [];
    
    if (!fs.existsSync(this.notesPath)) {
      return notes;
    }

    const files = fs.readdirSync(this.notesPath);
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filepath = path.join(this.notesPath, file);
        const content = fs.readFileSync(filepath, 'utf-8');
        const note = JSON.parse(content);
        // Convert date strings back to Date objects
        note.timestamp = new Date(note.timestamp);
        note.createdAt = new Date(note.createdAt);
        notes.push(note);
      }
    }

    return notes;
  }

  /**
   * Get a specific note by ID
   */
  async getNoteById(noteId: string): Promise<TradeNote | null> {
    const filepath = path.join(this.notesPath, `${noteId}.json`);
    
    if (!fs.existsSync(filepath)) {
      return null;
    }

    const content = fs.readFileSync(filepath, 'utf-8');
    const note = JSON.parse(content);
    note.timestamp = new Date(note.timestamp);
    note.createdAt = new Date(note.createdAt);
    
    return note;
  }

  /**
   * Extract numerical features from trade for matching
   * This creates a feature vector that can be compared with current market state
   */
  private extractFeatures(trade: Trade, marketContext?: any): number[] {
    const features: number[] = [];

    // Price-related features (normalized)
    features.push(trade.price);
    features.push(trade.quantity);

    // Market context features
    if (marketContext?.indicators) {
      features.push(marketContext.indicators.rsi || 50);
      features.push(marketContext.indicators.macd || 0);
      features.push(marketContext.indicators.volume || 0);
    } else {
      features.push(50, 0, 0); // Default values
    }

    // Trend encoding: bullish=1, neutral=0, bearish=-1
    const trendValue = 
      marketContext?.trend === 'bullish' ? 1 :
      marketContext?.trend === 'bearish' ? -1 : 0;
    features.push(trendValue);

    // Side encoding: buy=1, sell=-1
    features.push(trade.side === 'buy' ? 1 : -1);

    return features;
  }

  /**
   * Ensure notes directory exists
   */
  private ensureNotesDirectory(): void {
    if (!fs.existsSync(this.notesPath)) {
      fs.mkdirSync(this.notesPath, { recursive: true });
    }
  }
}
