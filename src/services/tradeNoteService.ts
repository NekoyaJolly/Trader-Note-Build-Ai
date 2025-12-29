import { Trade, TradeNote, MarketContext } from '../models/types';
import { AISummaryService } from './aiSummaryService';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

/**
 * トレードノート生成サービス
 * 
 * 責務:
 * - トレード履歴から構造化ノートを生成
 * - AI 要約の取得と保存
 * - 一致判定用の特徴量抽出
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
   * トレードから構造化ノートを生成
   * 
   * @param trade - トレードデータ
   * @param marketContext - トレード時点の市場コンテキスト（オプション）
   * @returns 生成されたトレードノート
   */
  async generateNote(trade: Trade, marketContext?: MarketContext): Promise<TradeNote> {
    // MarketContext を AI サービス用の形式に変換
    // bullish/bearish → uptrend/downtrend への変換
    const aiMarketContext = marketContext ? {
      trend: this.convertTrendForAI(marketContext.trend),
      rsi: marketContext.indicators?.rsi,
      macd: marketContext.indicators?.macd,
      timeframe: marketContext.timeframe,
    } : undefined;

    // AI 要約を生成
    const aiSummary = await this.aiService.generateTradeSummary({
      symbol: trade.symbol,
      side: trade.side,
      price: trade.price,
      quantity: trade.quantity,
      timestamp: trade.timestamp,
      marketContext: aiMarketContext,
    });

    // 一致判定用の特徴量を抽出
    const features = this.extractFeatures(trade, marketContext);

    // デフォルトの市場コンテキスト（未指定時）
    const defaultMarketContext: MarketContext = {
      timeframe: '15m',
      trend: 'neutral',
    };

    const note: TradeNote = {
      id: uuidv4(),
      tradeId: trade.id,
      timestamp: trade.timestamp,
      symbol: trade.symbol,
      side: trade.side,
      entryPrice: trade.price,
      quantity: trade.quantity,
      marketContext: marketContext ?? defaultMarketContext,
      aiSummary: aiSummary.summary,
      features,
      createdAt: new Date(),
      status: 'draft',
    };

    return note;
  }

  /**
   * トレンド値を AI サービス用の形式に変換
   * bullish → uptrend, bearish → downtrend
   */
  private convertTrendForAI(trend: 'bullish' | 'bearish' | 'neutral'): 'uptrend' | 'downtrend' | 'neutral' {
    switch (trend) {
      case 'bullish':
        return 'uptrend';
      case 'bearish':
        return 'downtrend';
      default:
        return 'neutral';
    }
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
   * トレードから一致判定用の特徴量を抽出
   * 現在の市場状態と比較可能な特徴量ベクトルを作成
   * 
   * @param trade - トレードデータ
   * @param marketContext - 市場コンテキスト
   * @returns 特徴量の配列
   */
  private extractFeatures(trade: Trade, marketContext?: MarketContext): number[] {
    const features: number[] = [];

    // 価格関連の特徴量
    features.push(trade.price);
    features.push(trade.quantity);

    // 市場コンテキストの特徴量
    if (marketContext?.indicators) {
      // インジケーター値（未設定時はデフォルト値）
      features.push(marketContext.indicators.rsi ?? 50);
      features.push(marketContext.indicators.macd ?? 0);
      features.push(marketContext.indicators.volume ?? 0);
    } else {
      // インジケーター未設定時のデフォルト値
      features.push(50, 0, 0);
    }

    // トレンドの数値エンコーディング: bullish=1, neutral=0, bearish=-1
    const trendValue = 
      marketContext?.trend === 'bullish' ? 1 :
      marketContext?.trend === 'bearish' ? -1 : 0;
    features.push(trendValue);

    // 売買方向のエンコーディング: buy=1, sell=-1
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
