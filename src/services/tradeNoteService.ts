import { Trade, TradeNote, MarketContext, NoteStatus } from '../models/types';
import { AISummaryService } from './aiSummaryService';
import { MarketDataService } from './marketDataService';
import { indicatorSettingsService } from './indicatorSettingsService';
import { indicatorService, OHLCVData } from './indicators';
import { IndicatorConfig } from '../models/indicatorConfig';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { TradeNoteRepository, TradeNoteWithSummary, FindNotesOptions } from '../backend/repositories/tradeNoteRepository';
import { TradeSide, NoteStatus as PrismaNoteStatus, Prisma } from '@prisma/client';
import { toMarketContextJson } from '../models/prismaTypes';

/**
 * ストレージモード
 * - 'db': DBのみ使用（推奨）
 * - 'fs': FSのみ使用（レガシー）
 * - 'hybrid': DB優先、FS フォールバック
 */
type StorageMode = 'db' | 'fs' | 'hybrid';


/**
 * ノート更新時に許可するフィールド
 */
export interface NoteUpdatePayload {
  aiSummary?: string;
  userNotes?: string;
  tags?: string[];
}

/**
 * トレードノート生成サービス
 * 
 * 責務:
 * - トレード履歴から構造化ノートを生成
 * - AI 要約の取得と保存
 * - 一致判定用の特徴量抽出
 * - 市場データからインジケーター値を取得
 * - ノートの承認/非承認/編集
 * 
 * Phase 8: DBストレージモード対応
 * - 'db' モードではDBのみ使用（推奨）
 * - 'fs' モードではFSのみ使用（レガシー互換）
 * - 'hybrid' モードではDB優先、FSフォールバック
 */
export class TradeNoteService {
  private aiService: AISummaryService;
  private marketDataService: MarketDataService;
  private notesPath: string;
  private repository: TradeNoteRepository;
  private storageMode: StorageMode;

  constructor(storageMode: StorageMode = 'db') {
    this.aiService = new AISummaryService();
    this.marketDataService = new MarketDataService();
    this.notesPath = path.join(process.cwd(), config.paths.notes);
    this.repository = new TradeNoteRepository();
    this.storageMode = storageMode;
    
    // FSモードまたはhybridモードの場合のみディレクトリを作成
    if (this.storageMode === 'fs' || this.storageMode === 'hybrid') {
      this.ensureNotesDirectory();
    }
  }

  /**
   * トレードから構造化ノートを生成
   * 
   * @param trade - トレードデータ
   * @param marketContext - トレード時点の市場コンテキスト（オプション）
   * @param fetchMarketData - 市場データを取得してインジケーターを計算するか（デフォルト: false）
   * @returns 生成されたトレードノート
   */
  async generateNote(
    trade: Trade,
    marketContext?: MarketContext,
    fetchMarketData: boolean = false
  ): Promise<TradeNote> {
    // 市場データを取得してインジケーターを計算（オプション）
    let actualMarketContext = marketContext;
    if (fetchMarketData && !marketContext) {
      try {
        const marketData = await this.marketDataService.getCurrentMarketDataWithIndicators(
          trade.symbol,
          '15m'
        );
        actualMarketContext = {
          timeframe: marketData.timeframe,
          trend: marketData.indicators?.trend || 'neutral',
          indicators: {
            rsi: marketData.indicators?.rsi,
            macd: marketData.indicators?.macd,
            volume: marketData.volume,
          },
        };
      } catch (error) {
        console.warn('市場データ取得をスキップ:', error);
      }
    }

    // MarketContext を AI サービス用の形式に変換
    // bullish/bearish → uptrend/downtrend への変換
    const aiMarketContext = actualMarketContext ? {
      trend: this.convertTrendForAI(actualMarketContext.trend),
      rsi: actualMarketContext.indicators?.rsi,
      macd: actualMarketContext.indicators?.macd,
      timeframe: actualMarketContext.timeframe,
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
    const features = this.extractFeatures(trade, actualMarketContext);

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
      marketContext: actualMarketContext ?? defaultMarketContext,
      aiSummary: aiSummary.summary,
      features,
      createdAt: new Date(),
      status: 'draft',
    };

    return note;
  }

  /**
   * ユーザー設定のインジケーターを適用してノートを生成
   * 
   * CSVインポート時に呼び出され、サイドバーで設定したインジケーターを
   * 市場データに適用してノートを生成する
   * 
   * @param trade - トレードデータ
   * @param timeframe - 時間足（デフォルト: 15m）
   * @returns 生成されたトレードノート
   */
  async generateNoteWithUserIndicators(
    trade: Trade,
    timeframe: string = '15m'
  ): Promise<TradeNote> {
    // === ユーザー設定のインジケーターを取得 ===
    const activeConfigs = await indicatorSettingsService.getActiveConfigs();
    
    // インジケーター設定がない場合は従来の generateNote にフォールバック
    if (activeConfigs.length === 0) {
      console.log('[TradeNoteService] ユーザー設定インジケーターなし、デフォルト処理を使用');
      return this.generateNote(trade, undefined, true);
    }

    // === 市場データを取得 ===
    let ohlcvData: OHLCVData[] = [];
    try {
      const marketData = await this.marketDataService.getHistoricalData(
        trade.symbol,
        timeframe,
        60 // 前後1時間のデータを取得
      );
      
      if (marketData.length > 0) {
        ohlcvData = marketData.map(md => ({
          timestamp: md.timestamp,
          open: md.open,
          high: md.high,
          low: md.low,
          close: md.close,
          volume: md.volume,
        }));
      }
    } catch (error) {
      console.warn('[TradeNoteService] 市場データ取得失敗、モックデータを使用:', error);
    }

    // 市場データがない場合はモックデータを生成
    if (ohlcvData.length === 0) {
      ohlcvData = this.generateMockOHLCV(trade, 50);
    }

    // === ユーザー設定のインジケーターを計算 ===
    const calculatedIndicators: Record<string, number | null> = {};
    
    for (const indicatorConfig of activeConfigs) {
      try {
        // IndicatorService.calculate() を使用して型安全に計算
        const result = indicatorService.calculate(
          indicatorConfig.indicatorId,
          ohlcvData,
          indicatorConfig.params
        );
        
        // extractLatestValue() で最新値を取得
        const latestValue = indicatorService.extractLatestValue(result);
        calculatedIndicators[indicatorConfig.label || indicatorConfig.indicatorId] = latestValue;
      } catch (error) {
        console.warn(`[TradeNoteService] インジケーター計算失敗 (${indicatorConfig.indicatorId}):`, error);
        calculatedIndicators[indicatorConfig.label || indicatorConfig.indicatorId] = null;
      }
    }

    // === 基本インジケーター値の抽出（後方互換性） ===
    const rsiValue = this.extractIndicatorValue(calculatedIndicators, 'RSI');
    const macdValue = this.extractIndicatorValue(calculatedIndicators, 'MACD');
    
    // === トレンドの判定 ===
    const trend = this.determineTrend(calculatedIndicators, ohlcvData);

    // === 市場コンテキストを構築 ===
    const latestOHLCV = ohlcvData[ohlcvData.length - 1];
    const marketContext: MarketContext = {
      timeframe,
      trend,
      indicators: {
        rsi: rsiValue ?? undefined,
        macd: macdValue ?? undefined,
        volume: latestOHLCV?.volume,
      },
      calculatedIndicators,
    };

    // === AI 要約を生成 ===
    const aiMarketContext = {
      trend: this.convertTrendForAI(trend),
      rsi: rsiValue ?? undefined,
      macd: macdValue ?? undefined,
      timeframe,
      // ユーザー設定インジケーターの情報を追加
      additionalIndicators: Object.entries(calculatedIndicators)
        .filter(([_, v]) => v !== null)
        .map(([label, value]) => `${label}: ${value?.toFixed(2)}`)
        .join(', '),
    };

    const aiSummary = await this.aiService.generateTradeSummary({
      symbol: trade.symbol,
      side: trade.side,
      price: trade.price,
      quantity: trade.quantity,
      timestamp: trade.timestamp,
      marketContext: aiMarketContext,
    });

    // === 特徴量を抽出 ===
    const features = this.extractFeaturesWithIndicators(trade, marketContext, calculatedIndicators);

    // === ノートを構築 ===
    const note: TradeNote = {
      id: uuidv4(),
      tradeId: trade.id,
      timestamp: trade.timestamp,
      symbol: trade.symbol,
      side: trade.side,
      entryPrice: trade.price,
      quantity: trade.quantity,
      marketContext,
      aiSummary: aiSummary.summary,
      features,
      createdAt: new Date(),
      status: 'draft',
    };

    console.log(`[TradeNoteService] ユーザー設定インジケーター ${activeConfigs.length}個を適用してノート生成完了: ${note.id}`);
    return note;
  }

  /**
   * モック OHLCV データを生成（市場データ取得失敗時用）
   */
  private generateMockOHLCV(trade: Trade, count: number = 50): OHLCVData[] {
    const data: OHLCVData[] = [];
    const basePrice = trade.price;
    const baseTime = trade.timestamp.getTime();
    
    for (let i = count; i > 0; i--) {
      const variation = (Math.random() - 0.5) * basePrice * 0.02;
      const open = basePrice + variation;
      const close = basePrice + (Math.random() - 0.5) * basePrice * 0.02;
      const high = Math.max(open, close) + Math.random() * basePrice * 0.01;
      const low = Math.min(open, close) - Math.random() * basePrice * 0.01;
      
      data.push({
        timestamp: new Date(baseTime - i * 15 * 60 * 1000), // 15分足
        open,
        high,
        low,
        close,
        volume: 1000 + Math.random() * 9000,
      });
    }
    
    return data;
  }

  /**
   * 計算済みインジケーターから特定のインジケーター値を抽出
   */
  private extractIndicatorValue(
    calculatedIndicators: Record<string, number | null>,
    prefix: string
  ): number | null {
    for (const [label, value] of Object.entries(calculatedIndicators)) {
      if (label.toUpperCase().startsWith(prefix.toUpperCase()) && value !== null) {
        return value;
      }
    }
    return null;
  }

  /**
   * インジケーター値からトレンドを判定
   */
  private determineTrend(
    calculatedIndicators: Record<string, number | null>,
    ohlcvData: OHLCVData[]
  ): 'bullish' | 'bearish' | 'neutral' {
    // RSI によるトレンド判定
    const rsi = this.extractIndicatorValue(calculatedIndicators, 'RSI');
    if (rsi !== null) {
      if (rsi > 60) return 'bullish';
      if (rsi < 40) return 'bearish';
    }
    
    // SMA によるトレンド判定（価格が SMA より上なら強気）
    const sma = this.extractIndicatorValue(calculatedIndicators, 'SMA');
    if (sma !== null && ohlcvData.length > 0) {
      const latestClose = ohlcvData[ohlcvData.length - 1].close;
      if (latestClose > sma * 1.01) return 'bullish';
      if (latestClose < sma * 0.99) return 'bearish';
    }
    
    return 'neutral';
  }

  /**
   * ユーザー設定インジケーターを含めた特徴量を抽出
   */
  private extractFeaturesWithIndicators(
    trade: Trade,
    marketContext: MarketContext,
    calculatedIndicators: Record<string, number | null>
  ): number[] {
    const features: number[] = [];

    // 価格関連の特徴量
    features.push(trade.price);
    features.push(trade.quantity);

    // 基本インジケーター値
    features.push(marketContext.indicators?.rsi ?? 50);
    features.push(marketContext.indicators?.macd ?? 0);
    features.push(marketContext.indicators?.volume ?? 0);

    // トレンドの数値エンコーディング
    const trendValue = 
      marketContext.trend === 'bullish' ? 1 :
      marketContext.trend === 'bearish' ? -1 : 0;
    features.push(trendValue);

    // 売買方向のエンコーディング
    features.push(trade.side === 'buy' ? 1 : -1);

    // ユーザー設定インジケーターの値を特徴量に追加
    // 一貫した順序を維持するためにソートしてから追加
    const sortedIndicators = Object.entries(calculatedIndicators)
      .sort(([a], [b]) => a.localeCompare(b));
    
    for (const [_, value] of sortedIndicators) {
      features.push(value ?? 0);
    }

    return features;
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
   * 
   * Phase 8: DBモードでは TradeNoteRepository を使用
   * FSモードでは従来の JSON ファイル保存を使用
   * 
   * @returns DBに保存された場合はDB上のノートID、FSのみの場合は渡されたノートのIDを返す
   */
  async saveNote(note: TradeNote): Promise<string> {
    let savedNoteId = note.id;
    
    if (this.storageMode === 'db' || this.storageMode === 'hybrid') {
      savedNoteId = await this.saveNoteToDb(note);
    }
    
    if (this.storageMode === 'fs' || this.storageMode === 'hybrid') {
      await this.saveNoteToFs(note);
    }
    
    return savedNoteId;
  }

  /**
   * DBにノートを保存する
   * @returns DBに保存されたノートのID（既存の場合はそのID、新規の場合はDB生成のID）
   */
  private async saveNoteToDb(note: TradeNote): Promise<string> {
    // 既存のノートを確認
    const existing = await this.repository.findByTradeId(note.tradeId);
    
    if (existing) {
      // 既存ノートの更新
      await this.repository.updateUserContent(existing.id, {
        userNotes: note.userNotes,
        tags: note.tags,
        // MarketContext を Prisma 互換 JSON に変換
        marketContext: note.marketContext 
          ? toMarketContextJson(note.marketContext) 
          : undefined,
      });
      
      // ステータスの更新
      if (note.status === 'approved' && existing.status !== 'approved') {
        await this.repository.approve(existing.id);
      } else if (note.status === 'rejected' && existing.status !== 'rejected') {
        await this.repository.reject(existing.id);
      } else if (note.status === 'draft' && existing.status !== 'draft') {
        await this.repository.revertToDraft(existing.id);
      }
      
      // 本番環境ではデバッグログを抑制
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[DB] Updated trade note: ${existing.id}`);
      }
      return existing.id;
    } else {
      // 新規ノートの作成
      // side は小文字で保存（Prisma TradeSide enumは 'buy' | 'sell'）
      // status は小文字で保存（Prisma NoteStatus enumは 'draft' | 'approved' | 'rejected'）
      const statusValue = (note.status || 'draft').toLowerCase();
      // 型安全に NoteStatus enum に変換
      const validStatus: PrismaNoteStatus = 
        statusValue === 'approved' ? 'approved' :
        statusValue === 'rejected' ? 'rejected' : 'draft';
      
      const created = await this.repository.createWithSummary(
        {
          tradeId: note.tradeId,
          symbol: note.symbol,
          entryPrice: note.entryPrice,
          side: note.side.toLowerCase() as TradeSide,
          featureVector: note.features || [],
          timeframe: note.marketContext?.timeframe || '15m',
          status: validStatus,
          // MarketContext を Prisma 互換 JSON に変換
          marketContext: note.marketContext 
            ? toMarketContextJson(note.marketContext) 
            : undefined,
          userNotes: note.userNotes,
          tags: note.tags,
        },
        {
          summary: note.aiSummary || '',
        }
      );
      
      // 本番環境ではデバッグログを抑制
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[DB] Created trade note: ${created.id}`);
      }
      return created.id;
    }
  }

  /**
   * FSにノートを保存する（レガシー互換）
   */
  private async saveNoteToFs(note: TradeNote): Promise<void> {
    const filename = `${note.id}.json`;
    const filepath = path.join(this.notesPath, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(note, null, 2));
    // 本番環境ではデバッグログを抑制
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[FS] Saved trade note: ${filename}`);
    }
  }

  /**
   * Load all trade notes from storage
   * 
   * Phase 8: DBモードでは TradeNoteRepository を使用
   */
  async loadAllNotes(): Promise<TradeNote[]> {
    if (this.storageMode === 'db') {
      return this.loadAllNotesFromDb();
    }
    
    if (this.storageMode === 'hybrid') {
      // DB優先で取得、なければFSにフォールバック
      const dbNotes = await this.loadAllNotesFromDb();
      if (dbNotes.length > 0) {
        return dbNotes;
      }
      console.log('[Hybrid] DB empty, falling back to FS');
      return this.loadAllNotesFromFs();
    }
    
    return this.loadAllNotesFromFs();
  }

  /**
   * DBから全ノートを取得
   */
  private async loadAllNotesFromDb(): Promise<TradeNote[]> {
    const dbNotes = await this.repository.findAll(1000, 0);
    return dbNotes.map(this.convertDbNoteToTradeNote);
  }

  /**
   * FSから全ノートを取得（レガシー互換）
   */
  private async loadAllNotesFromFs(): Promise<TradeNote[]> {
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
   * 
   * Phase 8: DBモードでは TradeNoteRepository を使用
   */
  async getNoteById(noteId: string): Promise<TradeNote | null> {
    if (this.storageMode === 'db') {
      return this.getNoteByIdFromDb(noteId);
    }
    
    if (this.storageMode === 'hybrid') {
      const dbNote = await this.getNoteByIdFromDb(noteId);
      if (dbNote) {
        return dbNote;
      }
      console.log(`[Hybrid] Note ${noteId} not found in DB, falling back to FS`);
      return this.getNoteByIdFromFs(noteId);
    }
    
    return this.getNoteByIdFromFs(noteId);
  }

  /**
   * DBから単一ノートを取得
   */
  private async getNoteByIdFromDb(noteId: string): Promise<TradeNote | null> {
    const dbNote = await this.repository.findById(noteId);
    if (!dbNote) {
      return null;
    }
    return this.convertDbNoteToTradeNote(dbNote);
  }

  /**
   * FSから単一ノートを取得（レガシー互換）
   */
  private async getNoteByIdFromFs(noteId: string): Promise<TradeNote | null> {
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
   * DBノートをTradeNote型に変換
   */
  private convertDbNoteToTradeNote(dbNote: TradeNoteWithSummary): TradeNote {
    // marketContext の型安全な変換
    let marketContext: MarketContext;
    if (dbNote.marketContext && typeof dbNote.marketContext === 'object' && !Array.isArray(dbNote.marketContext)) {
      const mc = dbNote.marketContext as Record<string, unknown>;
      marketContext = {
        timeframe: (mc.timeframe as string) || dbNote.timeframe || '15m',
        trend: (mc.trend as 'bullish' | 'bearish' | 'neutral') || 'neutral',
        indicators: mc.indicators as MarketContext['indicators'],
        calculatedIndicators: mc.calculatedIndicators as Record<string, number | null>,
      };
    } else {
      marketContext = {
        timeframe: dbNote.timeframe || '15m',
        trend: 'neutral',
      };
    }
    
    return {
      id: dbNote.id,
      tradeId: dbNote.tradeId,
      timestamp: dbNote.createdAt,
      symbol: dbNote.symbol,
      side: dbNote.side.toLowerCase() as 'buy' | 'sell',
      entryPrice: Number(dbNote.entryPrice),
      quantity: 0, // DBには数量が保存されていない場合のデフォルト
      marketContext,
      aiSummary: dbNote.aiSummary?.summary || '',
      features: dbNote.featureVector || [],
      createdAt: dbNote.createdAt,
      status: (dbNote.status?.toLowerCase() || 'draft') as NoteStatus,
      approvedAt: dbNote.approvedAt || undefined,
      rejectedAt: dbNote.rejectedAt || undefined,
      lastEditedAt: dbNote.lastEditedAt || undefined,
      userNotes: dbNote.userNotes || undefined,
      tags: dbNote.tags || undefined,
    };
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

  // ========== 承認フロー関連メソッド ==========

  /**
   * 承認済みノートのみを取得
   * マッチング対象となるノートのみを返却する
   * 
   * Phase 8: DBモードではリポジトリの専用メソッドを使用
   */
  async loadApprovedNotes(): Promise<TradeNote[]> {
    if (this.storageMode === 'db' || this.storageMode === 'hybrid') {
      const dbNotes = await this.repository.findApproved();
      return dbNotes.map(n => this.convertDbNoteToTradeNote(n));
    }
    
    const allNotes = await this.loadAllNotes();
    return allNotes.filter(note => note.status === 'approved');
  }

  /**
   * 指定ステータスのノートを取得
   * 
   * Phase 8: DBモードではリポジトリの専用メソッドを使用
   * @param status - 取得したいステータス（draft, approved, rejected）
   * 注意: Prisma enum は小文字で定義されている（draft, approved, rejected）
   */
  async loadNotesByStatus(status: NoteStatus): Promise<TradeNote[]> {
    if (this.storageMode === 'db' || this.storageMode === 'hybrid') {
      // Prisma enum は小文字で定義されているため、toLowerCase() で正規化
      const normalizedStatus = status.toLowerCase() as PrismaNoteStatus;
      const dbNotes = await this.repository.findWithOptions({
        status: normalizedStatus,
      });
      return dbNotes.map(n => this.convertDbNoteToTradeNote(n));
    }
    
    const allNotes = await this.loadAllNotes();
    return allNotes.filter(note => note.status === status);
  }

  /**
   * ノートを承認する
   * 承認済みのノートはマッチング対象になる
   * 
   * Phase 8: DBモードではリポジトリを直接使用
   * @param noteId - 承認するノートのID
   * @returns 承認後のノート
   */
  async approveNote(noteId: string): Promise<TradeNote> {
    if (this.storageMode === 'db' || this.storageMode === 'hybrid') {
      await this.repository.approve(noteId);
      const updated = await this.getNoteByIdFromDb(noteId);
      if (!updated) {
        throw new Error(`ノートが見つかりませんでした: ${noteId}`);
      }
      
      // hybridモードの場合、FSも更新
      if (this.storageMode === 'hybrid') {
        await this.saveNoteToFs(updated);
      }
      return updated;
    }
    
    // FSモード（レガシー）
    const note = await this.getNoteById(noteId);
    if (!note) {
      throw new Error(`ノートが見つかりませんでした: ${noteId}`);
    }

    if (note.status === 'approved') {
      return note;
    }

    note.status = 'approved';
    note.approvedAt = new Date();
    delete note.rejectedAt;

    await this.saveNote(note);
    return note;
  }

  /**
   * ノートを非承認（reject）する
   * 非承認のノートはマッチング対象外、アーカイブ扱い
   * 
   * Phase 8: DBモードではリポジトリを直接使用
   * @param noteId - 非承認にするノートのID
   * @returns 非承認後のノート
   */
  async rejectNote(noteId: string): Promise<TradeNote> {
    if (this.storageMode === 'db' || this.storageMode === 'hybrid') {
      await this.repository.reject(noteId);
      const updated = await this.getNoteByIdFromDb(noteId);
      if (!updated) {
        throw new Error(`ノートが見つかりませんでした: ${noteId}`);
      }
      
      // hybridモードの場合、FSも更新
      if (this.storageMode === 'hybrid') {
        await this.saveNoteToFs(updated);
      }
      return updated;
    }
    
    // FSモード（レガシー）
    const note = await this.getNoteById(noteId);
    if (!note) {
      throw new Error(`ノートが見つかりませんでした: ${noteId}`);
    }

    if (note.status === 'rejected') {
      return note;
    }

    note.status = 'rejected';
    note.rejectedAt = new Date();

    await this.saveNote(note);
    return note;
  }

  /**
   * ノートを下書きに戻す
   * 承認/非承認から編集モードに戻す際に使用
   * 
   * Phase 8: DBモードではリポジトリを直接使用
   * @param noteId - 下書きに戻すノートのID
   * @returns 下書き状態のノート
   */
  async revertToDraft(noteId: string): Promise<TradeNote> {
    if (this.storageMode === 'db' || this.storageMode === 'hybrid') {
      await this.repository.revertToDraft(noteId);
      const updated = await this.getNoteByIdFromDb(noteId);
      if (!updated) {
        throw new Error(`ノートが見つかりませんでした: ${noteId}`);
      }
      
      // hybridモードの場合、FSも更新
      if (this.storageMode === 'hybrid') {
        await this.saveNoteToFs(updated);
      }
      return updated;
    }
    
    // FSモード（レガシー）
    const note = await this.getNoteById(noteId);
    if (!note) {
      throw new Error(`ノートが見つかりませんでした: ${noteId}`);
    }

    if (note.status === 'draft') {
      return note;
    }

    note.status = 'draft';

    await this.saveNote(note);
    return note;
  }


  /**
   * ノートの内容を更新する
   * AI 要約、ユーザーメモ、タグなどを編集可能
   * 
   * Phase 8: DBモードではリポジトリを直接使用
   * @param noteId - 更新するノートのID
   * @param updates - 更新内容
   * @returns 更新後のノート
   */
  async updateNote(noteId: string, updates: NoteUpdatePayload): Promise<TradeNote> {
    if (this.storageMode === 'db' || this.storageMode === 'hybrid') {
      await this.repository.updateUserContent(noteId, {
        userNotes: updates.userNotes,
        tags: updates.tags,
      });
      const updated = await this.getNoteByIdFromDb(noteId);
      if (!updated) {
        throw new Error(`ノートが見つかりませんでした: ${noteId}`);
      }
      
      // hybridモードの場合、FSも更新
      if (this.storageMode === 'hybrid') {
        await this.saveNoteToFs(updated);
      }
      return updated;
    }
    
    // FSモード（レガシー）
    const note = await this.getNoteById(noteId);
    if (!note) {
      throw new Error(`ノートが見つかりませんでした: ${noteId}`);
    }

    // 許可されたフィールドのみ更新
    if (updates.aiSummary !== undefined) {
      note.aiSummary = updates.aiSummary;
    }
    if (updates.userNotes !== undefined) {
      note.userNotes = updates.userNotes;
    }
    if (updates.tags !== undefined) {
      note.tags = updates.tags;
    }

    // 編集日時を記録
    note.lastEditedAt = new Date();

    await this.saveNote(note);
    return note;
  }

  /**
   * ノートのステータス集計を取得
   * UI のダッシュボード等で使用
   * 
   * Phase 8: DBモードではリポジトリのグループ化クエリを使用
   */
  async getStatusCounts(): Promise<{ draft: number; approved: number; rejected: number; total: number }> {
    if (this.storageMode === 'db' || this.storageMode === 'hybrid') {
      const statusCounts = await this.repository.countByStatus();
      const counts = {
        draft: 0,
        approved: 0,
        rejected: 0,
        total: 0,
      };
      
      for (const { status, count } of statusCounts) {
        const statusLower = status.toLowerCase();
        if (statusLower === 'draft') {
          counts.draft = count;
        } else if (statusLower === 'approved') {
          counts.approved = count;
        } else if (statusLower === 'rejected') {
          counts.rejected = count;
        }
        counts.total += count;
      }
      
      return counts;
    }
    
    // FSモード（レガシー）
    const allNotes = await this.loadAllNotes();
    const counts = {
      draft: 0,
      approved: 0,
      rejected: 0,
      total: allNotes.length,
    };

    for (const note of allNotes) {
      switch (note.status) {
        case 'approved':
          counts.approved++;
          break;
        case 'rejected':
          counts.rejected++;
          break;
        default:
          // status が未設定または 'draft' の場合
          counts.draft++;
      }
    }

    return counts;
  }
}
