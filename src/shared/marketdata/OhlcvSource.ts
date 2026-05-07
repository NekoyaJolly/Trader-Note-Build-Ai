/**
 * OHLCV データ取得の抽象 interface (PR ⑤)。
 *
 * 用途:
 * - Side-A 本格 BT / Side-B 進化ループ / 表示用キャッシュ などが共通で使う
 *   「OHLCV データを (symbol, timeframe, 期間) 指定で取り出す」抽象。
 * - 将来 OHLCV 取得方法を変える (例: 一括 API / WebSocket streaming / parquet
 *   ローカルキャッシュ) ときに **interface だけ満たせば呼び出し側が無変更**
 *   になるよう抽象化する。
 *
 * 設計方針:
 * - **canonical 実装は補完取得込み (= `HttpOhlcvSource`)**。DB cache を読み、
 *   不足期間は cTrader API で取得 + DB に保存して返す。これがアプリ全体で
 *   「期間内のデータが必ず揃う」前提を保証する唯一の正しい挙動。
 * - 旧経路として「DB 直読 (補完なし)」が `OHLCVRepository.findManyAsOHLCVData`
 *   経由で walkForwardService / dailyBatch / barLocator などから呼ばれている
 *   が、データ歯抜け時に誤った結果を返す危険があるため **将来撤廃方向**。
 *   後追い PR で順次 `HttpOhlcvSource` に切り替える。本 PR ではこれら呼び出し
 *   箇所は無変更。
 *
 * 将来追加の候補:
 * - `MultiTimeframeBatchOhlcvSource` (= 複数 timeframe を 1 HTTP で取得する
 *   `analysis-engine` 側 API ができたとき)
 * - `WebSocketOhlcvSource` (= 進行中バーまで含めたリアルタイム経路)
 * - `ParquetOhlcvSource` (= 学習データ用ローカルファイル)
 *
 * 重要: 「DB 直読のみ (= 補完なし)」を `OhlcvSource` の実装として **公開しない**
 * (= 旧経路の DbOhlcvSource ラッパーは作らない)。間違って使うと歯抜けで誤判定
 * する経路を増やすことになるため、旧経路は順次撤廃して `HttpOhlcvSource` に
 * 一本化する。
 */

import type { CanonicalTimeframe } from '../timeframes';

/** 1 バーの OHLCV (= 既存 backtestCalculations / surrogateFitnessSimulation と互換)。 */
export interface OhlcvBar {
  readonly timestamp: Date;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/** OHLCV 取得リクエスト。 */
export interface OhlcvFetchRequest {
  readonly symbol: string;
  readonly timeframe: CanonicalTimeframe;
  readonly startDate: Date;
  readonly endDate: Date;
}

/**
 * OHLCV データソースの抽象。実装は `HttpOhlcvSource` 等に委ねる。
 *
 * 実装規約:
 * - `fetchBars` は **時刻昇順** で返す (= bars[i].timestamp < bars[i+1].timestamp)
 * - 期間に該当バーが無い場合は **空配列** を返す (= 例外を投げない)
 * - 取得失敗 (= ネットワーク / 認証 / DB エラー) は例外を投げる
 * - 同じリクエストに対して **冪等** (= 再呼び出しで同じ配列が返る、決定性)
 */
export interface OhlcvSource {
  fetchBars(req: OhlcvFetchRequest): Promise<OhlcvBar[]>;
}

/**
 * 複数 timeframe の OHLCV を **並列取得** する helper。
 *
 * MTF (マルチタイムフレーム) 戦略の評価で「主 timeframe + 上位足」の bars を
 * 同時に取得するときに使う。timeframes 重複は内部で重複排除して 1 HTTP に集約。
 *
 * 戻り値は `Map<canonical timeframe, OhlcvBar[]>`。要求した timeframe に対応する
 * 値が必ず入る (= fetch エラー時は例外伝播)。
 */
export async function fetchMultiTimeframeBars(
  source: OhlcvSource,
  symbol: string,
  timeframes: readonly CanonicalTimeframe[],
  startDate: Date,
  endDate: Date,
): Promise<Map<CanonicalTimeframe, OhlcvBar[]>> {
  const unique: CanonicalTimeframe[] = [];
  const seen = new Set<string>();
  for (const tf of timeframes) {
    if (seen.has(tf)) continue;
    seen.add(tf);
    unique.push(tf);
  }
  const results = await Promise.all(
    unique.map((tf) => source.fetchBars({ symbol, timeframe: tf, startDate, endDate })),
  );
  const out = new Map<CanonicalTimeframe, OhlcvBar[]>();
  for (let i = 0; i < unique.length; i++) {
    out.set(unique[i], results[i]);
  }
  return out;
}
