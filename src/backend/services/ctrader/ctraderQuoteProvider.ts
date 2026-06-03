/**
 * cTrader Quote プロバイダー (broker overlay)
 *
 * チャート上に重ねる「現在の bid/ask・スプレッド」を提供する broker レイヤー。
 * ローソ足 (EODHD/local) とは完全に分離されており、本プロバイダーが落ちても
 * チャートのローソ足表示には影響しない。
 *
 * 取得方針:
 * - cTrader の最新 bid/ask は historical tick API で直近の小窓 (数分) を引いて
 *   最新値を採用する (常時 WebSocket を張らない request スコープ取得)。
 * - SpreadBar テーブルは avg/max/p95 のみで bid/ask を保持しないため quote 源には使えない。
 * - cTrader 未接続 (OAuth 未設定) は disconnected、設定済みだが取得失敗は degraded を返す。
 */

import { CTraderDataService } from './ctraderDataService';
import { CTraderAuthService } from './ctraderAuthService';
import { prisma } from '../../db/client';
import { normalizeCTraderSymbol } from '../../../utils/symbolNormalization';
import type {
  BrokerQuote,
  BrokerQuoteResponse,
} from '../../../infrastructure/market/chart-data.types';

/** 最新 bid/ask の生値 (ローカル正規化後) */
export interface LatestBidAsk {
  bid: number;
  ask: number;
  timestamp: Date;
}

/** quote 取得の最小抽象 (テスト時に差し替え可能) */
export interface LatestQuoteFetcher {
  /** cTrader が利用可能か (OAuth 済み口座があるか) */
  isAvailable(): Promise<boolean>;
  /** 最新 bid/ask を取得 (取得不能時は null) */
  getLatestBidAsk(symbol: string): Promise<LatestBidAsk | null>;
}

/** 直近この時間幅の tick を引いて最新 bid/ask を決める */
const QUOTE_LOOKBACK_MS = 15 * 60 * 1000;

const DEGRADED_WARNING =
  'ブローカー (cTrader) の現在気配を取得できませんでした。発注はできません。';
const DISCONNECTED_WARNING =
  'ブローカー (cTrader) に接続されていません。チャートは表示できますが発注はできません。';

/**
 * cTrader historical tick を用いた既定の quote fetcher。
 */
class CTraderTickQuoteFetcher implements LatestQuoteFetcher {
  private dataService: CTraderDataService | null = null;
  private accountId: string | null = null;

  async isAvailable(): Promise<boolean> {
    await this.ensureConfigured();
    return this.dataService !== null && this.accountId !== null;
  }

  async getLatestBidAsk(symbol: string): Promise<LatestBidAsk | null> {
    await this.ensureConfigured();
    if (!this.dataService || !this.accountId) {
      return null;
    }
    const normalized = normalizeCTraderSymbol(symbol);
    const to = new Date();
    const from = new Date(to.getTime() - QUOTE_LOOKBACK_MS);

    const [bidTicks, askTicks] = await Promise.all([
      this.dataService.fetchTickDataInRange(this.accountId, normalized, 'bid', from, to),
      this.dataService.fetchTickDataInRange(this.accountId, normalized, 'ask', from, to),
    ]);
    // fetchTickDataInRange は時系列昇順で返すため末尾が最新
    const latestBid = bidTicks[bidTicks.length - 1];
    const latestAsk = askTicks[askTicks.length - 1];
    if (!latestBid || !latestAsk) {
      return null;
    }
    return {
      bid: latestBid.price,
      ask: latestAsk.price,
      timestamp: new Date(
        Math.max(latestBid.timestamp.getTime(), latestAsk.timestamp.getTime()),
      ),
    };
  }

  /** DB 永続化 token から有効口座を取得して遅延配線する */
  private async ensureConfigured(): Promise<void> {
    if (this.dataService && this.accountId) return;
    try {
      const authService = new CTraderAuthService(prisma);
      const token = await authService.getValidToken();
      if (token) {
        this.dataService = new CTraderDataService(authService);
        this.accountId = token.accountId;
      }
    } catch (error) {
      console.warn('[CTraderQuoteProvider] cTrader 自動配線エラー:', error);
    }
  }
}

export class CTraderQuoteProvider {
  private readonly fetcher: LatestQuoteFetcher;

  constructor(fetcher?: LatestQuoteFetcher) {
    this.fetcher = fetcher ?? new CTraderTickQuoteFetcher();
  }

  /**
   * 指定シンボルの現在 quote を取得する。
   * チャートに影響を与えないよう、ここで例外は投げず status で表現する。
   */
  async getQuote(symbol: string): Promise<BrokerQuoteResponse> {
    let available: boolean;
    try {
      available = await this.fetcher.isAvailable();
    } catch (error) {
      console.warn('[CTraderQuoteProvider] 接続確認エラー:', error);
      available = false;
    }

    if (!available) {
      return {
        quote: null,
        status: 'disconnected',
        warning: DISCONNECTED_WARNING,
      };
    }

    try {
      const latest = await this.fetcher.getLatestBidAsk(symbol);
      if (!latest) {
        return { quote: null, status: 'degraded', warning: DEGRADED_WARNING };
      }
      const quote: BrokerQuote = {
        symbol: normalizeCTraderSymbol(symbol),
        broker: 'cTrader',
        bid: latest.bid,
        ask: latest.ask,
        spread: latest.ask - latest.bid,
        timestamp: latest.timestamp.toISOString(),
        isRealtime: true,
      };
      return { quote, status: 'connected' };
    } catch (error) {
      console.warn('[CTraderQuoteProvider] quote 取得エラー:', error);
      return { quote: null, status: 'degraded', warning: DEGRADED_WARNING };
    }
  }
}

/** アプリ共通インスタンス */
export const ctraderQuoteProvider = new CTraderQuoteProvider();
