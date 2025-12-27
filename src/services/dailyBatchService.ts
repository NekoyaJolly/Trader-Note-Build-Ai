import { Trade } from '@prisma/client';
import { TradeImportService } from './tradeImportService';
import { TradeRepository } from '../backend/repositories/tradeRepository';
import { TradeNoteGeneratorService } from './note-generator/tradeNoteGeneratorService';
import { MarketIngestService } from '../backend/services/ingest/marketIngestService';
import { MatchEvaluationService } from '../backend/services/matching/matchEvaluationService';
import { NotificationTriggerService } from './notification/notificationTriggerService';
import { MatchResultRepository, MatchResultWithRelations } from '../backend/repositories/matchResultRepository';
import { MarketDataService } from './marketDataService';
import { MarketContext } from './note-generator/featureExtractor';

export interface DailyBatchOptions {
  csvFilePath?: string;      // 処理対象の CSV ファイル（省略時はインポートをスキップ）
  failFast?: boolean;        // 致命エラー発生時に即時終了するか
  maxNotes?: number;         // 1 回のバッチで生成するノート数の上限
}

export interface DailyBatchReport {
  startedAt: Date;
  endedAt: Date;
  importSummary?: { tradesImported: number; skipped: number; errors: string[]; file: string };
  noteSummary: { requested: number; generated: number; failed: number };
  snapshotSummary: { symbols: string[]; ingested: number };
  matchSummary: { evaluated: number };
  notificationSummary: { sent: number; skipped: number; failed: number };
  warnings: string[];
  errors: string[];
}

/**
 * CSV 取り込み → ノート生成 → 市場スナップショット → 一致判定 → 通知 までを一括実行する日次バッチ
 * - 例外は failFast=true のときのみ伝播し、それ以外は警告として蓄積する
 */
export class DailyBatchService {
  private readonly tradeImportService: TradeImportService;
  private readonly tradeRepository: TradeRepository;
  private readonly tradeNoteGenerator: TradeNoteGeneratorService;
  private readonly marketIngestService: MarketIngestService;
  private readonly matchEvaluationService: MatchEvaluationService;
  private readonly notificationTriggerService: NotificationTriggerService;
  private readonly matchResultRepository: MatchResultRepository;
  private readonly marketDataService: MarketDataService;

  constructor(
    tradeImportService?: TradeImportService,
    tradeRepository?: TradeRepository,
    tradeNoteGenerator?: TradeNoteGeneratorService,
    marketIngestService?: MarketIngestService,
    matchEvaluationService?: MatchEvaluationService,
    notificationTriggerService?: NotificationTriggerService,
    matchResultRepository?: MatchResultRepository,
    marketDataService?: MarketDataService,
  ) {
    this.tradeImportService = tradeImportService || new TradeImportService();
    this.tradeRepository = tradeRepository || new TradeRepository();
    this.tradeNoteGenerator = tradeNoteGenerator || new TradeNoteGeneratorService();
    this.marketIngestService = marketIngestService || new MarketIngestService();
    this.matchEvaluationService = matchEvaluationService || new MatchEvaluationService();
    this.notificationTriggerService = notificationTriggerService || new NotificationTriggerService();
    this.matchResultRepository = matchResultRepository || new MatchResultRepository();
    this.marketDataService = marketDataService || new MarketDataService();
  }

  async run(options: DailyBatchOptions = {}): Promise<DailyBatchReport> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const startedAt = new Date();

    const report: DailyBatchReport = {
      startedAt,
      endedAt: startedAt,
      noteSummary: { requested: 0, generated: 0, failed: 0 },
      snapshotSummary: { symbols: [], ingested: 0 },
      matchSummary: { evaluated: 0 },
      notificationSummary: { sent: 0, skipped: 0, failed: 0 },
      warnings,
      errors,
    };

    // Step 1: CSV 取り込み（任意）
    if (options.csvFilePath) {
      try {
        report.importSummary = await this.tradeImportService.importFromCSV(options.csvFilePath);
      } catch (error) {
        const message = `CSV 取り込み失敗: ${(error as Error).message}`;
        if (options.failFast) throw new Error(message);
        errors.push(message);
      }
    }

    // Step 2: ノート未生成トレードの抽出
    const trades = await this.tradeRepository.findTradesWithoutNotes(options.maxNotes);
    report.noteSummary.requested = trades.length;

    // Step 3: ノート生成（市場コンテキストは軽量なリアルタイムデータを使用）
    for (const trade of trades) {
      try {
        const marketContext = await this.buildMarketContext(trade);
        await this.tradeNoteGenerator.generateAndSaveNote(trade, marketContext);
        report.noteSummary.generated += 1;
      } catch (error) {
        report.noteSummary.failed += 1;
        warnings.push(`ノート生成失敗 tradeId=${trade.id}: ${(error as Error).message}`);
      }
    }

    // Step 4: 市場スナップショット取得（15m/60m）
    const symbols = this.uniqueSymbols(trades);
    report.snapshotSummary.symbols = symbols;
    for (const symbol of symbols) {
      try {
        await this.marketIngestService.ingestSymbol(symbol);
        report.snapshotSummary.ingested += 2; // 15m と 60m の 2 本を想定
      } catch (error) {
        warnings.push(`市場データ取得失敗 symbol=${symbol}: ${(error as Error).message}`);
        if (options.failFast) throw error;
      }
    }

    // Step 5: 一致判定（TradeNote × MarketSnapshot）
    try {
      const matches = await this.matchEvaluationService.evaluateAllNotes();
      report.matchSummary.evaluated = matches.length;

      // Step 6: 通知判定（Note + Snapshot を取得して判定）
      const matchIds = matches.map((m) => m.id);
      const matchesWithRelations = await this.matchResultRepository.findWithRelations(matchIds);

      for (const match of matchesWithRelations) {
        try {
          const result = await this.notificationTriggerService.evaluateAndNotify(match as MatchResultWithRelations);
          if (result.shouldNotify && result.status === 'sent') {
            report.notificationSummary.sent += 1;
          } else if (result.status === 'skipped') {
            report.notificationSummary.skipped += 1;
          } else {
            report.notificationSummary.failed += 1;
          }
        } catch (error) {
          report.notificationSummary.failed += 1;
          warnings.push(`通知判定失敗 matchResultId=${match.id}: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      const message = `一致判定全体で失敗: ${(error as Error).message}`;
      if (options.failFast) throw new Error(message);
      errors.push(message);
    }

    report.endedAt = new Date();
    return report;
  }

  // 市場コンテキストを軽量に構築する（API 未設定でもダミーを返す）
  private async buildMarketContext(trade: Trade): Promise<MarketContext> {
    const market = await this.marketDataService.getCurrentMarketData(trade.symbol, '15m');

    return {
      previousClose: market.open,
      averageVolume: market.volume,
      rsi: market.indicators?.rsi,
      macd: market.indicators?.macd,
      timeframe: market.timeframe,
      marketHours: { isOpen: true, isNearOpen: false, isNearClose: false },
    };
  }

  private uniqueSymbols(trades: Trade[]): string[] {
    const set = new Set<string>();
    for (const t of trades) {
      set.add(t.symbol);
    }
    return Array.from(set);
  }
}
