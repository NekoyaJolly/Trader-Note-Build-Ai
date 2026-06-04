import type { Trade, TradeNote, MarketContext, NoteStatus } from '../models/types';
import { AISummaryService } from './aiSummaryService';
import { MarketDataService } from './marketDataService';
import { indicatorSettingsService } from './indicatorSettingsService';
import { getIndicatorProfileService } from './indicatorProfileService';
import type { OHLCVData } from './indicators';
import { indicatorService } from './indicators';
import type { IndicatorConfig } from '../models/indicatorConfig';
import type {
  NoteProfileConfig} from '../models/indicatorProfile';
import {
  RESERVED_PROFILE_IDS,
  createNoteProfileConfig,
} from '../models/indicatorProfile';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import type { TradeNoteWithSummary} from '../backend/repositories/tradeNoteRepository';
import { TradeNoteRepository } from '../backend/repositories/tradeNoteRepository';
import type { TradeSide, NoteStatus as PrismaNoteStatus} from '@prisma/client';
import { toMarketContextJson } from '../models/prismaTypes';
import type { JsonValue } from '../utils/jsonValue';

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
    const activeConfigs = indicatorSettingsService.getActiveConfigs();

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
   * プロファイルを指定してノートを生成
   * 
   * CSVインポート時に呼び出され、選択されたプロファイルのインジケーターを
   * 市場データに適用してノートを生成する。
   * 
   * プロファイルの種類:
   * - __AI_AUTO__: AIに任せる（12次元特徴量）
   * - __NONE__: プロファイルなし（特徴量なし）
   * - UUID: ユーザー定義プロファイル
   * 
   * @param trade - トレードデータ
   * @param profileId - プロファイルID（予約IDまたはUUID）
   * @param userId - 所有ユーザーID（プロファイル参照に必要）
   * @param timeframe - 時間足（デフォルト: 15m）
   * @param userComment - ユーザーコメント（任意）
   * @returns 生成されたトレードノート
   */
  async generateNoteWithProfile(
    trade: Trade,
    profileId: string,
    userId: string,
    timeframe: string = '15m',
    userComment?: string
  ): Promise<TradeNote> {
    // === プロファイルなしの場合 ===
    if (profileId === RESERVED_PROFILE_IDS.NONE) {
      console.log('[TradeNoteService] プロファイルなし、OHLCVのみで生成');
      return this.generateNoteWithoutFeatures(trade, timeframe, userComment);
    }

    // === AIに任せる場合（12次元特徴量） ===
    if (profileId === RESERVED_PROFILE_IDS.AI_AUTO) {
      console.log('[TradeNoteService] AIに任せる、12次元特徴量で生成');
      return this.generateNoteWith12DFeatures(trade, timeframe, userComment);
    }

    // === ユーザー定義プロファイルの場合 ===
    const profileService = getIndicatorProfileService();
    const profile = await profileService.getProfileById(profileId, userId);

    if (!profile) {
      console.warn(`[TradeNoteService] プロファイルが見つかりません: ${profileId}、デフォルト処理を使用`);
      return this.generateNoteWithUserIndicators(trade, timeframe);
    }

    // プロファイルのインジケーター設定を使用
    const activeConfigs = profile.indicators.filter(i => i.enabled);

    if (activeConfigs.length === 0) {
      console.log('[TradeNoteService] プロファイルにインジケーターがありません、OHLCVのみで生成');
      return this.generateNoteWithoutFeatures(trade, timeframe, userComment);
    }

    // === 市場データを取得 ===
    let ohlcvData = await this.fetchOHLCVData(trade, timeframe);
    if (ohlcvData.length === 0) {
      ohlcvData = this.generateMockOHLCV(trade, 50);
    }

    // === インジケーターを計算 ===
    const calculatedIndicators = this.calculateIndicators(activeConfigs, ohlcvData);

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

    // === プロファイル設定をスナップショットとして保存 ===
    const profileConfig = createNoteProfileConfig(profile, profileId);
    if (userComment) {
      profileConfig.userComment = userComment;
    }

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
      userNotes: userComment,
    };

    // indicatorConfig は TradeNote 型にはないが、保存時に別途処理
    // 一旦拡張プロパティとしてセット（保存ロジックで参照）
    (note as TradeNote & { indicatorConfig?: NoteProfileConfig }).indicatorConfig = profileConfig;

    console.log(`[TradeNoteService] プロファイル "${profile.name}" (${activeConfigs.length}個) を適用してノート生成完了: ${note.id}`);
    return note;
  }

  /**
   * 特徴量なしでノートを生成（プロファイルなし用）
   */
  private async generateNoteWithoutFeatures(
    trade: Trade,
    timeframe: string,
    userComment?: string
  ): Promise<TradeNote> {
    // AI 要約を生成
    const aiSummary = await this.aiService.generateTradeSummary({
      symbol: trade.symbol,
      side: trade.side,
      price: trade.price,
      quantity: trade.quantity,
      timestamp: trade.timestamp,
    });

    const marketContext: MarketContext = {
      timeframe,
      trend: 'neutral',
    };

    // プロファイル設定（NONE）
    const profileConfig = createNoteProfileConfig(null, RESERVED_PROFILE_IDS.NONE);
    if (userComment) {
      profileConfig.userComment = userComment;
    }

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
      features: [], // 特徴量なし
      createdAt: new Date(),
      status: 'draft',
      userNotes: userComment,
    };

    (note as TradeNote & { indicatorConfig?: NoteProfileConfig }).indicatorConfig = profileConfig;
    return note;
  }

  /**
   * 12次元特徴量でノートを生成（AIに任せる用）
   * 
   * Side-Bと同じ12次元固定特徴量を使用
   */
  private async generateNoteWith12DFeatures(
    trade: Trade,
    timeframe: string,
    userComment?: string
  ): Promise<TradeNote> {
    // 市場データを取得
    let ohlcvData = await this.fetchOHLCVData(trade, timeframe);
    if (ohlcvData.length === 0) {
      ohlcvData = this.generateMockOHLCV(trade, 50);
    }

    // 12次元特徴量用のインジケーターを計算
    const features12D = this.calculate12DFeatures(ohlcvData, trade);

    // 基本インジケーター計算（AI要約用）
    const rsiValue = features12D.rsi;
    const trend = features12D.trendDirection > 0 ? 'bullish' : features12D.trendDirection < 0 ? 'bearish' : 'neutral';

    const marketContext: MarketContext = {
      timeframe,
      trend,
      indicators: {
        rsi: rsiValue,
        volume: ohlcvData[ohlcvData.length - 1]?.volume,
      },
    };

    // AI 要約を生成
    const aiSummary = await this.aiService.generateTradeSummary({
      symbol: trade.symbol,
      side: trade.side,
      price: trade.price,
      quantity: trade.quantity,
      timestamp: trade.timestamp,
      marketContext: {
        trend: this.convertTrendForAI(trend),
        rsi: rsiValue,
        timeframe,
      },
    });

    // プロファイル設定（AI_AUTO）
    const profileConfig = createNoteProfileConfig(null, RESERVED_PROFILE_IDS.AI_AUTO);
    if (userComment) {
      profileConfig.userComment = userComment;
    }

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
      features: features12D.vector,
      createdAt: new Date(),
      status: 'draft',
      userNotes: userComment,
    };

    (note as TradeNote & { indicatorConfig?: NoteProfileConfig }).indicatorConfig = profileConfig;
    console.log(`[TradeNoteService] AI 12次元特徴量でノート生成完了: ${note.id}`);
    return note;
  }

  /**
   * OHLCVデータを取得
   */
  private async fetchOHLCVData(trade: Trade, timeframe: string): Promise<OHLCVData[]> {
    try {
      const marketData = await this.marketDataService.getHistoricalData(
        trade.symbol,
        timeframe,
        60
      );

      if (marketData.length > 0) {
        return marketData.map(md => ({
          timestamp: md.timestamp,
          open: md.open,
          high: md.high,
          low: md.low,
          close: md.close,
          volume: md.volume,
        }));
      }
    } catch (error) {
      console.warn('[TradeNoteService] 市場データ取得失敗:', error);
    }
    return [];
  }

  /**
   * インジケーターを計算
   */
  private calculateIndicators(
    configs: IndicatorConfig[],
    ohlcvData: OHLCVData[]
  ): Record<string, number | null> {
    const result: Record<string, number | null> = {};

    for (const config of configs) {
      try {
        const calcResult = indicatorService.calculate(
          config.indicatorId,
          ohlcvData,
          config.params
        );
        const latestValue = indicatorService.extractLatestValue(calcResult);
        result[config.label || config.indicatorId] = latestValue;
      } catch (error) {
        console.warn(`[TradeNoteService] インジケーター計算失敗 (${config.indicatorId}):`, error);
        result[config.label || config.indicatorId] = null;
      }
    }

    return result;
  }

  /**
   * 12次元特徴量を計算（Side-Bと同じロジック）
   */
  private calculate12DFeatures(ohlcvData: OHLCVData[], _trade: Trade): {
    vector: number[];
    rsi: number;
    trendDirection: number;
  } {
    // デフォルト値（データ不足時）
    if (ohlcvData.length < 26) {
      return {
        vector: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        rsi: 50,
        trendDirection: 0,
      };
    }

    // RSI(14) を計算
    let rsi = 50;
    try {
      const rsiResult = indicatorService.calculate('rsi', ohlcvData, { period: 14 });
      const rsiValue = indicatorService.extractLatestValue(rsiResult);
      if (rsiValue !== null) rsi = rsiValue;
    } catch { /* デフォルト値を使用 */ }

    // MACD を計算
    let macdHistogram = 0;
    let macdCrossover = 0;
    try {
      const macdResult = indicatorService.calculate('macd', ohlcvData, {
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
      });
      if (macdResult && typeof macdResult === 'object' && 'histogram' in macdResult) {
        const hist = (macdResult as { histogram: number[] }).histogram;
        if (hist.length > 0) {
          macdHistogram = hist[hist.length - 1] || 0;
          if (hist.length > 1) {
            const prev = hist[hist.length - 2] || 0;
            macdCrossover = macdHistogram > 0 && prev <= 0 ? 1 : macdHistogram < 0 && prev >= 0 ? -1 : 0;
          }
        }
      }
    } catch { /* デフォルト値を使用 */ }

    // BB を計算
    let bbPosition = 0.5;
    let bbWidth = 0;
    try {
      const bbResult = indicatorService.calculate('bb', ohlcvData, { period: 20 });
      if (bbResult && typeof bbResult === 'object' && 'upper' in bbResult && 'middle' in bbResult && 'lower' in bbResult) {
        const bb = bbResult as { upper: number[]; middle: number[]; lower: number[] };
        const latestClose = ohlcvData[ohlcvData.length - 1].close;
        const upper = bb.upper[bb.upper.length - 1];
        const lower = bb.lower[bb.lower.length - 1];
        const middle = bb.middle[bb.middle.length - 1];
        if (upper && lower && upper !== lower) {
          bbPosition = (latestClose - lower) / (upper - lower);
          bbWidth = (upper - lower) / middle;
        }
      }
    } catch { /* デフォルト値を使用 */ }

    // SMA でトレンド判定
    let trendDirection = 0;
    let trendStrength = 0;
    let trendAlignment = 0;
    try {
      const sma20Result = indicatorService.calculate('sma', ohlcvData, { period: 20 });
      const sma50Result = indicatorService.calculate('sma', ohlcvData, { period: 50 });
      const sma20 = indicatorService.extractLatestValue(sma20Result);
      const sma50 = indicatorService.extractLatestValue(sma50Result);
      const latestClose = ohlcvData[ohlcvData.length - 1].close;

      if (sma20 && sma50) {
        trendDirection = latestClose > sma20 ? 1 : latestClose < sma20 ? -1 : 0;
        trendStrength = Math.abs(latestClose - sma20) / sma20;
        trendAlignment = sma20 > sma50 ? 1 : sma20 < sma50 ? -1 : 0;
      }
    } catch { /* デフォルト値を使用 */ }

    // RSI ゾーン
    const rsiZone = rsi > 70 ? 1 : rsi < 30 ? -1 : 0;
    const rsiNormalized = rsi / 100;

    // ローソク足構造
    const latestBar = ohlcvData[ohlcvData.length - 1];
    const candleBody = Math.abs(latestBar.close - latestBar.open) / (latestBar.high - latestBar.low || 1);
    const candleDirection = latestBar.close > latestBar.open ? 1 : latestBar.close < latestBar.open ? -1 : 0;

    // セッションフラグ（簡易版: 時刻に基づく）
    const hour = new Date(latestBar.timestamp).getUTCHours();
    const sessionFlag = hour >= 13 && hour < 22 ? 1 : hour >= 22 || hour < 8 ? 0.5 : 0; // NY, Asia, Other

    // 12次元ベクトル
    const vector = [
      trendDirection,      // 0: トレンド方向
      trendStrength,       // 1: トレンド強度
      trendAlignment,      // 2: トレンド整合
      macdHistogram,       // 3: MACDヒストグラム
      macdCrossover,       // 4: MACDクロス
      rsiNormalized,       // 5: RSI値（0-1正規化）
      rsiZone,             // 6: RSIゾーン
      bbPosition,          // 7: BB位置
      bbWidth,             // 8: BB幅
      candleBody,          // 9: ローソク足実体比率
      candleDirection,     // 10: ローソク足方向
      sessionFlag,         // 11: セッションフラグ
    ];

    return { vector, rsi, trendDirection };
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
      if (note.status === 'active' && existing.status !== 'active') {
        await this.repository.approve(existing.id);
      } else if (note.status === 'archived' && existing.status !== 'archived') {
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
      // status は小文字で保存（Prisma NoteStatus enumは 'draft' | 'active' | 'archived'）
      const statusValue = (note.status || 'draft').toLowerCase();
      // 型安全に NoteStatus enum に変換
      const validStatus: PrismaNoteStatus =
        statusValue === 'active' ? 'active' :
          statusValue === 'archived' ? 'archived' : 'draft';

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
  private saveNoteToFs(note: TradeNote): Promise<void> {
    const filename = `${note.id}.json`;
    const filepath = path.join(this.notesPath, filename);

    fs.writeFileSync(filepath, JSON.stringify(note, null, 2));
    // 本番環境ではデバッグログを抑制
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[FS] Saved trade note: ${filename}`);
    }
    return Promise.resolve();
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
    return dbNotes.map((n) => this.convertDbNoteToTradeNote(n));
  }

  /**
   * FSから全ノートを取得（レガシー互換）
   */
  private loadAllNotesFromFs(): Promise<TradeNote[]> {
    const notes: TradeNote[] = [];

    if (!fs.existsSync(this.notesPath)) {
      return Promise.resolve(notes);
    }

    const files = fs.readdirSync(this.notesPath);

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filepath = path.join(this.notesPath, file);
        const content = fs.readFileSync(filepath, 'utf-8');
        const note = JSON.parse(content) as TradeNote;
        // Convert date strings back to Date objects
        note.timestamp = new Date(note.timestamp);
        note.createdAt = new Date(note.createdAt);
        notes.push(note);
      }
    }

    return Promise.resolve(notes);
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
  private getNoteByIdFromFs(noteId: string): Promise<TradeNote | null> {
    const filepath = path.join(this.notesPath, `${noteId}.json`);

    if (!fs.existsSync(filepath)) {
      return Promise.resolve(null);
    }

    const content = fs.readFileSync(filepath, 'utf-8');
    const note = JSON.parse(content) as TradeNote;
    note.timestamp = new Date(note.timestamp);
    note.createdAt = new Date(note.createdAt);

    return Promise.resolve(note);
  }

  /**
   * DBノートをTradeNote型に変換
   */
  private convertDbNoteToTradeNote(dbNote: TradeNoteWithSummary): TradeNote {
    // marketContext の型安全な変換
    let marketContext: MarketContext;
    if (dbNote.marketContext && typeof dbNote.marketContext === 'object' && !Array.isArray(dbNote.marketContext)) {
      const mc = dbNote.marketContext as Record<string, JsonValue | undefined>;
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
      // エントリー時刻・数量は紐づく元トレード (include 時) から取る。
      // 未 include 時は従来通り createdAt / 0 にフォールバック (F6)。
      timestamp: dbNote.trade?.timestamp ?? dbNote.createdAt,
      symbol: dbNote.symbol,
      side: dbNote.side.toLowerCase() as 'buy' | 'sell',
      entryPrice: Number(dbNote.entryPrice),
      quantity: dbNote.trade ? Number(dbNote.trade.quantity) : 0,
      marketContext,
      aiSummary: dbNote.aiSummary?.summary || '',
      features: dbNote.featureVector || [],
      createdAt: dbNote.createdAt,
      status: (dbNote.status?.toLowerCase() || 'draft') as NoteStatus,
      activatedAt: dbNote.activatedAt || undefined,
      archivedAt: dbNote.archivedAt || undefined,
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
   * 有効ノートのみを取得
   * マッチング対象となるノートのみを返却する
   * 
   * Phase 8: DBモードではリポジトリの専用メソッドを使用
   */
  async loadActiveNotes(): Promise<TradeNote[]> {
    if (this.storageMode === 'db' || this.storageMode === 'hybrid') {
      const dbNotes = await this.repository.findApproved();
      return dbNotes.map(n => this.convertDbNoteToTradeNote(n));
    }

    const allNotes = await this.loadAllNotes();
    return allNotes.filter(note => note.status === 'active');
  }

  /**
   * マッチング対象の有効ノートを取得する（フェーズ8: 複数ノート運用UX）
   * 
   * 条件:
   * - status = 'active'
   * - enabled = true
   * - pausedUntil が null または現在時刻より前
   * 
   * 優先度の高い順にソート
   */
  async loadActiveNotesForMatching(): Promise<TradeNote[]> {
    if (this.storageMode === 'db' || this.storageMode === 'hybrid') {
      const dbNotes = await this.repository.findActiveForMatching();
      return dbNotes.map(n => this.convertDbNoteToTradeNote(n));
    }

    // ファイルモードでは enabled, pausedUntil, priority がないため active のみフィルタ
    const allNotes = await this.loadAllNotes();
    return allNotes.filter(note => note.status === 'active');
  }

  /**
   * マッチング対象の有効ノートをPrisma型で取得する（DB専用）
   * 
   * matchingServiceがNoteEvaluatorを生成するために使用。
   * FS型への変換をスキップして効率化。
   * 
   * @returns PrismaのTradeNoteレコード配列
   */
  async loadActiveNotesForMatchingAsPrisma(): Promise<TradeNoteWithSummary[]> {
    return this.repository.findActiveForMatching();
  }

  /**
   * 指定ステータスのノートを取得
   * 
   * Phase 8: DBモードではリポジトリの専用メソッドを使用
   * @param status - 取得したいステータス（draft, active, archived）
   * 注意: Prisma enum は小文字で定義されている（draft, active, archived）
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

    if (note.status === 'active') {
      return note;
    }

    note.status = 'active';
    note.activatedAt = new Date();
    delete note.archivedAt;

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

    if (note.status === 'archived') {
      return note;
    }

    note.status = 'archived';
    note.archivedAt = new Date();

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
  async getStatusCounts(): Promise<{ draft: number; active: number; archived: number; total: number }> {
    if (this.storageMode === 'db' || this.storageMode === 'hybrid') {
      const statusCounts = await this.repository.countByStatus();
      const counts = {
        draft: 0,
        active: 0,
        archived: 0,
        total: 0,
      };

      for (const { status, count } of statusCounts) {
        const statusLower = status.toLowerCase();
        if (statusLower === 'draft') {
          counts.draft = count;
        } else if (statusLower === 'active') {
          counts.active = count;
        } else if (statusLower === 'archived') {
          counts.archived = count;
        }
        counts.total += count;
      }

      return counts;
    }

    // FSモード（レガシー）
    const allNotes = await this.loadAllNotes();
    const counts = {
      draft: 0,
      active: 0,
      archived: 0,
      total: allNotes.length,
    };

    for (const note of allNotes) {
      switch (note.status) {
        case 'active':
          counts.active++;
          break;
        case 'archived':
          counts.archived++;
          break;
        default:
          // status が未設定または 'draft' の場合
          counts.draft++;
      }
    }

    return counts;
  }

  // ============================================
  // フェーズ8: ノート優先度/有効無効管理
  // ============================================

  /**
   * ノートの優先度を更新
   * @param noteId ノートID
   * @param priority 優先度（1-10）
   */
  async updateNotePriority(noteId: string, priority: number): Promise<void> {
    if (this.storageMode === 'db' || this.storageMode === 'hybrid') {
      await this.repository.updatePriority(noteId, priority);
      return;
    }
    // ファイルモードでは非対応
    console.warn('[TradeNoteService] ファイルモードでは優先度更新は非対応です');
  }

  /**
   * ノートの有効/無効を切り替え
   * @param noteId ノートID
   * @param enabled 有効フラグ
   */
  async setNoteEnabled(noteId: string, enabled: boolean): Promise<void> {
    if (this.storageMode === 'db' || this.storageMode === 'hybrid') {
      await this.repository.setEnabled(noteId, enabled);
      return;
    }
    // ファイルモードでは非対応
    console.warn('[TradeNoteService] ファイルモードでは有効/無効切り替えは非対応です');
  }

  /**
   * ノートを一時停止（指定日時まで無効）
   * @param noteId ノートID
   * @param until 停止終了日時（null で停止解除）
   */
  async setNotePausedUntil(noteId: string, until: Date | null): Promise<void> {
    if (this.storageMode === 'db' || this.storageMode === 'hybrid') {
      await this.repository.setPausedUntil(noteId, until);
      return;
    }
    // ファイルモードでは非対応
    console.warn('[TradeNoteService] ファイルモードでは一時停止は非対応です');
  }
}
