/**
 * チャート OHLCV API ルート
 *
 * GET /api/chart/candles
 *   チャートのローソク足 (OHLCV) を取得する主経路。EODHD を主データソースとし、
 *   障害時はローカルキャッシュ (OHLCVCandle) にフォールバックする。
 *   **cTrader には依存しない** ため、cTrader 障害でもローソク足は表示できる。
 *
 * 分析結果 (12次元特徴量等) は従来通り /api/market-analysis/:symbol が担う。
 * 本ルートはローソ足取得専用で、分析 API とは責務を分ける。
 *
 * HTTP ステータス方針 (404 を乱用しない):
 *   - symbol 不正 / 未対応      → 404
 *   - timeframe 不正            → 400
 *   - 必須パラメータ不足          → 400
 *   - 外部障害かつキャッシュ無し   → 503
 *   - symbol 有効・データ無し     → 200 (candles: [] + warning)
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import { chartDataService } from '../../services/chartDataService';
import { ChartDataError } from '../../infrastructure/market/chart-data.types';
import { validateQuery, getValidatedQuery, validateBody } from '../../middleware/validateRequest';
import {
  ChartCandlesQuerySchema,
  type ChartCandlesQuery,
  ChartIndicatorSeriesRequestSchema,
  type ChartIndicatorSeriesRequest,
} from '../../schemas/api/chart';
import { fetchIndicatorSeries } from '../services/analysisEngineClient';
import type { AnalysisEngineIndicatorSeriesResponse } from '../../schemas/external/analysisEngine';
// レンズ条件 (#3) プレビュー: backtest/live と同じレンズ系列計算を通す(評価1経路)
import { appendLensSeriesToCache, buildEvaluationCaches } from '../services/strategyBacktestService';
import { appendStateLensSeriesToCache, type StateLensBar } from '../../services/stateLensSeries';
import { prisma } from '../db/client';
import { ohlcvRepository } from '../repositories/ohlcvRepository';
import { normalizeCTraderSymbol, toSlashSymbol } from '../../utils/symbolNormalization';

const router = Router();

/**
 * GET /api/chart/candles?symbol=&timeframe=&from=&to=&limit=
 *
 * クエリ検証は validateQuery ミドルウェアに委譲 (不正時は 400 + details を返す)。
 */
router.get('/candles', validateQuery(ChartCandlesQuerySchema), async (_req: Request, res: Response) => {
  const { symbol, timeframe, from, to, limit } = getValidatedQuery<ChartCandlesQuery>(res);

  try {
    const result = await chartDataService.getCandles({
      symbol,
      timeframe,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit,
    });
    // ChartCandlesResponse をそのまま返す ({ candles, meta, warning })
    res.json(result);
  } catch (error) {
    if (error instanceof ChartDataError) {
      const status = mapChartErrorToStatus(error.kind);
      // 原因追跡用ログ (provider / symbol / timeframe / range / error type)
      console.warn(
        `[ChartCandles] ${error.kind} symbol=${symbol} timeframe=${timeframe} ` +
          `range=${from ?? '-'}〜${to ?? '-'} detail=${error.detail ?? '-'}`,
      );
      res.status(status).json({
        success: false,
        error: error.message,
        kind: error.kind,
      });
      return;
    }
    console.error(
      `[ChartCandles] 予期せぬエラー symbol=${symbol} timeframe=${timeframe}:`,
      error,
    );
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'チャートデータの取得に失敗しました',
    });
  }
});

/**
 * POST /api/chart/indicator-series
 *
 * 指定シンボル・時間足・期間について、analysis-engine (pandas-ta) が計算した指標系列
 * (+ ローソク足パターンフラグ) を返す。指標計算をフロントで自前実装せず analysis-engine に
 * 一元化するための公開ルート。バックテスト・進化ループが使う `fetchIndicatorSeries` を
 * そのままブラウザに公開する薄いプロキシ。
 *
 * OHLCV は analysis-engine が DB (OHLCVCandle) を直読みする設計のため、呼び出し側は
 * 事前に GET /api/chart/candles で同一期間のローソク足を取得 (= DB へキャッシュ) しておく。
 *
 * レスポンスは AnalysisEngineIndicatorSeriesResponse ({ symbol, timeframe, timestamps,
 * series: Record<cacheKey, (number|null)[]>, patterns: Record<patternId, boolean[]> }) を
 * そのまま返す。cacheKey 規約は Node/Python 共通 (makeIndicatorCacheKey)。
 *
 * HTTP ステータス方針:
 *   - body 不正                   → 400 (validateBody)
 *   - analysis-engine 障害・不正応答 → 502 (upstream 依存の失敗)
 */
/**
 * プレビュー用レンズ特徴系列 (#3) を計算する。
 *
 * バックテスト/ライブと同じ appendLensSeriesToCache を通すことで評価 1 経路を維持する。
 * closes は analysis-engine が読んだのと同じ DB (OHLCVCandle) から取得し、
 * response.timestamps へ timestamp 一致(秒精度)で整列する。
 * 失敗時は undefined を返し、プレビューはレンズ条件を不成立として描画する(安全側)。
 */
async function buildLensSeriesForPreview(
  body: ChartIndicatorSeriesRequest,
  result: AnalysisEngineIndicatorSeriesResponse,
): Promise<Record<string, (number | null)[]> | undefined> {
  try {
    const candles = await ohlcvRepository.findMany({
      symbol: body.symbol,
      timeframe: body.timeframe,
      startTime: new Date(body.startDate),
      endTime: new Date(body.endDate),
      orderBy: 'asc',
    });
    const closeBySecond = new Map<number, number>();
    for (const candle of candles) {
      const close = Number(candle.close);
      if (Number.isFinite(close)) {
        closeBySecond.set(Math.floor(candle.timestamp.getTime() / 1000), close);
      }
    }
    const closes = result.timestamps.map((ts) => {
      const ms = Date.parse(ts);
      return Number.isFinite(ms)
        ? (closeBySecond.get(Math.floor(ms / 1000)) ?? Number.NaN)
        : Number.NaN;
    });

    // 今回のレスポンスに含まれる系列はキャッシュ経由で再利用される(同系列の二重取得防止)
    const { indicatorCache } = buildEvaluationCaches({ series: result.series });
    const lensConditions = body.lensIds.map((lensId) => ({ lensId }));
    await appendLensSeriesToCache({
      indicatorCache,
      lensConditions,
      symbol: body.symbol,
      timeframe: body.timeframe,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
      closes,
    });

    // 状態レンズ (#3 第2弾): 欠損足を除外した有効バー列で計算し、後段で response 軸へ整列する
    // (EODHD 由来の OHLC=null ギャップ足を含めるとレンズ計算が壊れるため除外が規約)
    const validBars: StateLensBar[] = candles
      .filter(
        (candle) =>
          Number.isFinite(Number(candle.open)) &&
          Number.isFinite(Number(candle.high)) &&
          Number.isFinite(Number(candle.low)) &&
          Number.isFinite(Number(candle.close))
      )
      .map((candle) => ({
        timestamp: candle.timestamp,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume: Number(candle.volume ?? 0),
      }));
    const stateCache = new Map<string, number[]>();
    await appendStateLensSeriesToCache({
      indicatorCache: stateCache,
      lensConditions,
      symbol: body.symbol,
      timeframe: body.timeframe,
      bars: validBars,
      engineSeries: {
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        fetchIndicatorSeriesFn: fetchIndicatorSeries,
      },
    });
    // 有効バー軸 → response.timestamps 軸へ秒精度で整列
    const barIndexBySecond = new Map<number, number>();
    validBars.forEach((bar, index) => {
      barIndexBySecond.set(Math.floor(bar.timestamp.getTime() / 1000), index);
    });

    const lensSeries: Record<string, (number | null)[]> = {};
    // 全区間 null の系列 (skip/cyclic 等のエンコード不能キー) はレスポンスに含めない
    // (肥大化防止。フロントはキー欠落 = 条件不成立として同じ安全側挙動。Copilot レビュー対応 PR #401)
    const putIfAnyFinite = (key: string, values: (number | null)[]): void => {
      if (values.some((v) => v !== null)) {
        lensSeries[key] = values;
      }
    };
    for (const [key, values] of indicatorCache) {
      if (key.startsWith('lens:')) {
        // JSON は NaN を表現できないため null に明示変換する(フロントは null→NaN で復元)
        putIfAnyFinite(key, values.map((v) => (Number.isFinite(v) ? v : null)));
      }
    }
    for (const [key, values] of stateCache) {
      putIfAnyFinite(
        key,
        result.timestamps.map((ts) => {
          const ms = Date.parse(ts);
          if (!Number.isFinite(ms)) return null;
          const index = barIndexBySecond.get(Math.floor(ms / 1000));
          if (index === undefined) return null;
          const v = values[index];
          return Number.isFinite(v) ? v : null;
        })
      );
    }
    return lensSeries;
  } catch (error) {
    console.warn(
      `[ChartIndicatorSeries] レンズ系列の計算に失敗 (プレビューはレンズ条件を不成立扱い) ` +
        `symbol=${body.symbol} timeframe=${body.timeframe} lensIds=${body.lensIds.join(',')}:`,
      error,
    );
    return undefined;
  }
}

router.post(
  '/indicator-series',
  validateBody(ChartIndicatorSeriesRequestSchema),
  async (req: Request, res: Response) => {
    const body = req.body as ChartIndicatorSeriesRequest;

    try {
      const result = await fetchIndicatorSeries({
        symbol: body.symbol,
        timeframe: body.timeframe,
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        indicators: body.indicators,
        patterns: body.patterns,
      });
      // レンズ条件 (#3): 要求があればレンズ特徴系列(数値エンコード済み)を additive に付与
      const lensSeries =
        body.lensIds.length > 0 ? await buildLensSeriesForPreview(body, result) : undefined;
      res.json(lensSeries ? { ...result, lensSeries } : result);
    } catch (error) {
      console.error(
        `[ChartIndicatorSeries] 取得失敗 symbol=${body.symbol} timeframe=${body.timeframe} ` +
          `indicators=${body.indicators.length} patterns=${body.patterns.length}:`,
        error,
      );
      res.status(502).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : '指標系列の取得に失敗しました (analysis-engine)',
      });
    }
  },
);

// ============================================
// GET /api/chart/symbols
//
// チャートの銘柄ピッカーを動的に埋めるためのシンボル候補。
// 出所を結合して返す (フロントにシンボル一覧をハードコードさせないため = 条件7):
//   1. cTrader getAvailableSymbols (接続できる場合。30 分キャッシュで接続頻度を抑制し
//      複数接続競合を避ける。失敗・タイムアウトは握りつぶして次へ)
//   2. OHLCVCandle DB に存在する symbol (これまで取得・永続化した銘柄。利用に応じて増える)
//   3. 1+2 が空のコールドスタート時のみ最小シード (majors)
// フロント側は free-text 入力 + この候補の datalist で、任意シンボルを動的に選べる。
// ============================================

interface ChartSymbolOption {
  /** 正規化シンボル (例 XAUUSD)。API パラメータにそのまま使う */
  value: string;
  /** 表示用ラベル (例 XAU/USD) */
  label: string;
}
interface ChartSymbolsPayload {
  symbols: ChartSymbolOption[];
  source: 'ctrader' | 'db' | 'seed';
}

// majors を候補の先頭に出すための表示優先度
const MAJOR_ORDER = [
  'XAUUSD', 'EURUSD', 'USDJPY', 'GBPUSD', 'AUDUSD',
  'USDCHF', 'USDCAD', 'NZDUSD', 'XAGUSD',
];
// コールドスタート (broker 未接続 & DB 空) 時のみ使う最小シード
const SEED_SYMBOLS = ['XAUUSD', 'EURUSD', 'USDJPY', 'GBPUSD'];

const SYMBOLS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 分
let symbolsCache: { payload: ChartSymbolsPayload; fetchedAt: number } | null = null;

/** majors 優先 + 残りはアルファベット順に並べる */
function sortChartSymbols(options: ChartSymbolOption[]): ChartSymbolOption[] {
  return options.sort((a, b) => {
    const ia = MAJOR_ORDER.indexOf(a.value);
    const ib = MAJOR_ORDER.indexOf(b.value);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.value.localeCompare(b.value);
  });
}

/** cTrader 利用可能シンボルを timeout 付きで取得 (未接続・失敗・タイムアウトは空配列)。 */
async function fetchCtraderSymbolNames(timeoutMs: number): Promise<string[]> {
  const token = await prisma.cTraderToken.findFirst({
    where: { NOT: { accountId: { startsWith: 'ctrader_' } } },
    orderBy: { lastConnectedAt: 'desc' },
  });
  if (!token) return [];
  const numericAccountId = parseInt(token.accountId, 10);
  if (Number.isNaN(numericAccountId) || numericAccountId <= 0) return [];

  const { CTraderAuthService } = await import('../services/ctrader/ctraderAuthService');
  const { CTraderDataService } = await import('../services/ctrader/ctraderDataService');
  const dataService = new CTraderDataService(new CTraderAuthService(prisma));

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('cTrader symbols timeout')), timeoutMs),
  );
  const symbols = await Promise.race([
    dataService.getAvailableSymbols(token.accountId),
    timeout,
  ]);
  return symbols.map((s) => s.symbolName);
}

router.get('/symbols', async (_req: Request, res: Response) => {
  // 30 分キャッシュ: cTrader 接続を頻繁に張らない (複数接続競合の回避)
  if (symbolsCache && Date.now() - symbolsCache.fetchedAt < SYMBOLS_CACHE_TTL_MS) {
    res.json({ success: true, data: symbolsCache.payload });
    return;
  }

  const byValue = new Map<string, string>(); // value(正規化) -> label(スラッシュ)
  let source: ChartSymbolsPayload['source'] = 'db';

  // 1. cTrader (接続できれば最優先)。失敗・タイムアウトは握りつぶして DB/シードへ。
  try {
    const names = await fetchCtraderSymbolNames(6000);
    if (names.length > 0) {
      source = 'ctrader';
      for (const name of names) {
        const value = normalizeCTraderSymbol(name);
        if (value.length >= 3) byValue.set(value, toSlashSymbol(name));
      }
    }
  } catch (error) {
    console.warn(
      '[ChartSymbols] cTrader シンボル取得に失敗 (DB/シードにフォールバック):',
      error instanceof Error ? error.message : error,
    );
  }

  // 2. これまで OHLCV を取得・永続化した symbol を結合 (利用に応じて候補が増える)
  //    symbol だけ欲しいので distinct: ['symbol'] に寄せた getDistinctSymbols を使う
  //    (getAvailablePairs だと timeframe 分だけ symbol が重複し転送が無駄になる)。
  try {
    const dbSymbols = await ohlcvRepository.getDistinctSymbols();
    for (const dbSymbol of dbSymbols) {
      const value = normalizeCTraderSymbol(dbSymbol);
      if (value.length >= 3 && !byValue.has(value)) {
        byValue.set(value, toSlashSymbol(dbSymbol));
      }
    }
  } catch (error) {
    console.warn(
      '[ChartSymbols] DB シンボル取得に失敗:',
      error instanceof Error ? error.message : error,
    );
  }

  // 3. コールドスタート (broker 未接続 & DB 空) のみ最小シード
  if (byValue.size === 0) {
    source = 'seed';
    for (const value of SEED_SYMBOLS) byValue.set(value, toSlashSymbol(value));
  }

  const symbols = sortChartSymbols(
    Array.from(byValue.entries()).map(([value, label]) => ({ value, label })),
  );
  const payload: ChartSymbolsPayload = { symbols, source };
  symbolsCache = { payload, fetchedAt: Date.now() };
  res.json({ success: true, data: payload });
});

/** ChartDataError.kind → HTTP ステータス */
function mapChartErrorToStatus(kind: ChartDataError['kind']): number {
  switch (kind) {
    case 'invalid_symbol':
      return 404;
    case 'invalid_timeframe':
      return 400;
    case 'upstream_unavailable':
      return 503;
    default:
      return 500;
  }
}

export default router;
