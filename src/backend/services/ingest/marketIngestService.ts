import { MarketSnapshotRepository } from '../../repositories/marketSnapshotRepository';
import { MarketDataService } from '../../../services/marketDataService';

/**
 * 市場データを取得し、15m / 60m 足として保存する Ingest サービス（Phase1 スコープ）
 */
export class MarketIngestService {
  private marketDataService: MarketDataService;
  private snapshotRepository: MarketSnapshotRepository;

  constructor() {
    this.marketDataService = new MarketDataService();
    this.snapshotRepository = new MarketSnapshotRepository();
  }

  /**
   * 単一シンボルに対し 15m と 60m の足を取得・保存する
   */
  async ingestSymbol(symbol: string): Promise<void> {
    const timeframes: Array<'15m' | '60m'> = ['15m', '60m'];

    for (const timeframe of timeframes) {
      await this.fetchAndStore(symbol, timeframe);
    }
  }

  /**
   * 任意のシンボル配列に対し、各時間足を保存する
   */
  async ingestSymbols(symbols: string[]): Promise<void> {
    for (const symbol of symbols) {
      await this.ingestSymbol(symbol);
    }
  }

  // 時間足ごとに取得・保存する
  private async fetchAndStore(symbol: string, timeframe: '15m' | '60m'): Promise<void> {
    const market = await this.marketDataService.getCurrentMarketData(symbol, timeframe);
    const bucketedAt = this.floorToTimeframe(market.timestamp, timeframe);

    await this.snapshotRepository.upsertSnapshot({
      symbol,
      timeframe,
      close: market.close,
      volume: market.volume,
      indicators: market.indicators ?? {},
      fetchedAt: bucketedAt,
    });
  }

  // 時間足の開始時刻に丸める（UTC 前提）
  private floorToTimeframe(date: Date, timeframe: '15m' | '60m'): Date {
    const ms = date.getTime();
    const unitMs = timeframe === '60m' ? 60 * 60 * 1000 : 15 * 60 * 1000;
    const floored = Math.floor(ms / unitMs) * unitMs;
    return new Date(floored);
  }
}
