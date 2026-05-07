/**
 * `OhlcvSource` のデフォルト実装 (PR ⑤)。
 *
 * 既存の `src/backend/services/strategyBacktestService.ts:fetchHistoricalData`
 * (= DB cache + cTrader API 経由) を `OhlcvSource` interface でラップする。
 *
 * 既存呼び出し (Side-A 本格 BT / Side-B `SurrogateFitnessSimulator`) は
 * `fetchHistoricalData` を直呼びしている。本実装に切り替えると **挙動は無変更**
 * (= ラッパーは pass-through)、interface 経由になることで「将来別実装に
 * 差し替え可能」になる。
 */

import {
  fetchHistoricalData,
  type BacktestTimeframe,
} from '../../backend/services/strategyBacktestService';
import type { CanonicalTimeframe } from '../timeframes';
import type { OhlcvBar, OhlcvFetchRequest, OhlcvSource } from './OhlcvSource';

/**
 * canonical timeframe → BacktestTimeframe (= 既存 fetchHistoricalData の引数型)。
 *
 * 現状 BacktestTimeframe は canonical と完全一致 ('1m' / '5m' / ... / '1d') なので
 * 単純に as キャスト。将来 BacktestTimeframe が別系統に分岐したらここで分岐する。
 */
function toBacktestTimeframe(tf: CanonicalTimeframe): BacktestTimeframe {
  return tf;
}

export class HttpOhlcvSource implements OhlcvSource {
  async fetchBars(req: OhlcvFetchRequest): Promise<OhlcvBar[]> {
    const bars = await fetchHistoricalData(
      req.symbol,
      toBacktestTimeframe(req.timeframe),
      req.startDate,
      req.endDate,
    );
    // fetchHistoricalData の戻り値 (= OHLCVCandle 行 / OhlcvBar 互換) を
    // 本 interface の OhlcvBar に正規化。timestamp は Date、数値は number。
    return bars.map((b) => ({
      timestamp: b.timestamp instanceof Date ? b.timestamp : new Date(b.timestamp),
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume),
    }));
  }
}

/** 進化ループ / surrogate でデフォルト利用するシングルトン。 */
export const defaultHttpOhlcvSource: OhlcvSource = new HttpOhlcvSource();
