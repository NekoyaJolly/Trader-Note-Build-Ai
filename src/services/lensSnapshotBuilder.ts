/**
 * LensSnapshotBuilder — ノート特徴(LensSnapshot)の生成サービス
 *
 * 正本設計: docs/architecture/NOTE_SIMILARITY_FOUNDATION.md §2-① / §3 / §5
 *
 * 責務:
 * - 指定時刻(eventTime)における NoteLensSnapshot を生成する**唯一の生成口**。
 *   ノート作成時(eventTime=トレード時刻)も市場照合時(eventTime=現在)も本サービスを通る
 *   ことで「作成時=照合時で同一の特徴定義・同一のコード」(§2-①)を構造的に保証する
 * - 旧実装の欠陥(ノート生成が「現在」の市場データで特徴量を計算しており、過去トレードの
 *   「その瞬間の市場」を捉えていなかった)を eventTime 起点のデータ取得で根本解決する
 *
 * データフロー:
 * 1. OHLCVCandle(DB) から eventTime 以前のバー列を取得(不足時は fetchAndCacheOhlcv で
 *    期間指定の取得を 1 回だけ試行)
 * 2. analysis-engine /v1/indicator-series を 1 回呼び、インジケーター系列 + ローソク足
 *    パターン flag + SMC / ChartPattern / Wyckoff payload を取得
 * 3. 状態レンズ(src/side-b/lenses/、純粋関数)を実行
 * 4. インジケーターレンズ(src/shared/similarity/)を実行
 * 5. NoteLensSnapshot に組み立てて返す
 *
 * 欠損耐性(§2-⑤): どの段階の失敗も snapshot 全体を失敗させず、該当レンズの欠落
 * (= 比較時にスキップ)+ warnings で表現する。バーが全く無い場合のみ snapshot=null。
 */

import {
  ChartPatternLens,
  DowTheoryLens,
  PatternLens,
  SMCLens,
  TimeSessionLens,
  VolatilityRegimeLens,
  WyckoffLens,
} from '../side-b/lenses';
import type { Lens, LensInput } from '../side-b/lenses/types';
import type { OHLCVBar } from '../side-b/lenses/utils/pivotDetection';
import { ALL_CANDLE_PATTERN_IDS, type CandlePatternId } from '../shared/patterns';
import {
  computeIndicatorLens,
  type IndicatorLensSpec,
  type IndicatorSeriesRequest,
} from '../shared/similarity/indicatorLenses';
import {
  createNoteLensSnapshot,
  lensEntryFromLensFeature,
  type LensSnapshotEntry,
  type NoteLensSnapshot,
} from '../shared/similarity/lensSnapshotTypes';
import {
  fetchIndicatorSeries,
  makeIndicatorCacheKey,
} from '../backend/services/analysisEngineClient';
import type { AnalysisEngineIndicatorSeriesResponse } from '../schemas/external/analysisEngine';
import { OHLCVRepository } from '../backend/repositories/ohlcvRepository';
import { fetchAndCacheOhlcv } from '../backend/services/fetchAndCacheOhlcv';
import { TIMEFRAME_MS } from '../infrastructure/market/ohlcvAggregation';
import { TimeframeSchema } from '../infrastructure/market/IMarketDataProvider';

/** スナップショット生成パラメータ */
export interface LensSnapshotBuildParams {
  readonly symbol: string;
  readonly timeframe: string;
  /** ノート=トレード時刻 / 市場側=評価時刻 */
  readonly eventTime: Date;
  readonly higherTimeframe?: string;
  /** 有効化するインジケーターレンズ仕様(resolveIndicatorLensSpecs / parseIndicatorLensId で解決済み) */
  readonly indicatorSpecs: ReadonlyArray<IndicatorLensSpec>;
  /**
   * バー不足時に期間指定フェッチ(fetchAndCacheOhlcv)で補完を試みるか。
   * ノート作成・バックフィルでは true、cron マッチング(毎回の外部フェッチを避けたい)では false を推奨
   */
  readonly ensureCoverage?: boolean;
  /** analysis-engine 呼び出しの相関 ID */
  readonly correlationId?: string;
}

/** スナップショット生成結果 */
export interface LensSnapshotBuildResult {
  /** 生成された snapshot。バーが全く取得できない場合のみ null */
  readonly snapshot: NoteLensSnapshot | null;
  /** 生成中に発生した非致命の警告(欠落レンズ・データ不足等) */
  readonly warnings: string[];
  /** 使用したバー数 */
  readonly barsUsed: number;
}

/** 最低限必要なバー数(これ未満なら ensureCoverage 時に補完を試みる) */
const MIN_PREFERRED_BARS = 100;

/** ウィンドウ最大バー数(指標 warmup を考慮した上限) */
const MAX_WINDOW_BARS = 500;

/** ウィンドウ既定バー数 */
const DEFAULT_WINDOW_BARS = 150;

/** 休場(週末等)を跨いでもバー数を確保するためのカレンダー係数 */
const CALENDAR_BUFFER_FACTOR = 2;

/** LensSnapshotBuilder の依存(テストで差し替え可能にする) */
export interface LensSnapshotBuilderDeps {
  ohlcvRepository?: Pick<OHLCVRepository, 'findManyAsOHLCVData'>;
  fetchAndCacheOhlcvFn?: typeof fetchAndCacheOhlcv;
  fetchIndicatorSeriesFn?: typeof fetchIndicatorSeries;
}

export class LensSnapshotBuilder {
  private readonly ohlcvRepository: Pick<OHLCVRepository, 'findManyAsOHLCVData'>;
  private readonly fetchAndCacheOhlcvFn: typeof fetchAndCacheOhlcv;
  private readonly fetchIndicatorSeriesFn: typeof fetchIndicatorSeries;
  /** 状態レンズ群(current_analysis は MarketAnalysis 必須のため Side-A 生成経路では対象外) */
  private readonly stateLenses: ReadonlyArray<Lens>;

  constructor(deps: LensSnapshotBuilderDeps = {}) {
    this.ohlcvRepository = deps.ohlcvRepository ?? new OHLCVRepository();
    this.fetchAndCacheOhlcvFn = deps.fetchAndCacheOhlcvFn ?? fetchAndCacheOhlcv;
    this.fetchIndicatorSeriesFn = deps.fetchIndicatorSeriesFn ?? fetchIndicatorSeries;
    this.stateLenses = [
      new TimeSessionLens(),
      new DowTheoryLens(),
      new VolatilityRegimeLens(),
      new PatternLens(),
      new SMCLens(),
      new ChartPatternLens(),
      new WyckoffLens(),
    ];
  }

  /**
   * 指定時刻の NoteLensSnapshot を生成する。
   */
  async build(params: LensSnapshotBuildParams): Promise<LensSnapshotBuildResult> {
    const warnings: string[] = [];
    const windowBars = this.resolveWindowBars(params.indicatorSpecs);
    const barMs = this.resolveBarMs(params.timeframe);
    if (barMs === null) {
      return {
        snapshot: null,
        warnings: [`未対応の時間足のため snapshot を生成できません: ${params.timeframe}`],
        barsUsed: 0,
      };
    }
    const windowStart = new Date(
      params.eventTime.getTime() - barMs * windowBars * CALENDAR_BUFFER_FACTOR
    );

    // 1. OHLCV バー取得(不足・鮮度切れ時は 1 回だけ期間指定フェッチで補完)
    //    - 不足: ウィンドウ内のバーが少なすぎる(新シンボル・過去トレードのバックフィル等)
    //    - 鮮度切れ: 最終バーが eventTime から離れすぎている(DB 取り込みが追いついていない)。
    //      これを補わないと「eventTime 時点の市場」ではなく古い窓で特徴を計算してしまう
    let bars = await this.loadBars(params.symbol, params.timeframe, windowStart, params.eventTime, windowBars);
    if (params.ensureCoverage ?? true) {
      const freshnessGapMs = Math.max(3 * barMs, 30 * 60_000);
      const lastBarTime = bars.length > 0 ? bars[bars.length - 1].timestamp.getTime() : null;
      const needsCoverage = bars.length < MIN_PREFERRED_BARS;
      const needsFreshness =
        lastBarTime !== null && params.eventTime.getTime() - lastBarTime > freshnessGapMs;
      if (needsCoverage || needsFreshness) {
        const fetchFrom =
          needsCoverage || lastBarTime === null ? windowStart : new Date(lastBarTime);
        const fetchResult = await this.fetchAndCacheOhlcvFn(
          params.symbol,
          params.timeframe,
          fetchFrom,
          params.eventTime
        );
        if (!fetchResult.success) {
          warnings.push(`OHLCV 期間フェッチ失敗(DB 内データのみで継続): ${fetchResult.error ?? '不明'}`);
        }
        bars = await this.loadBars(params.symbol, params.timeframe, windowStart, params.eventTime, windowBars);
      }
    }

    if (bars.length === 0) {
      warnings.push(
        `OHLCV バーが取得できないため snapshot を生成できません ` +
          `(symbol=${params.symbol}, timeframe=${params.timeframe}, eventTime=${params.eventTime.toISOString()})`
      );
      return { snapshot: null, warnings, barsUsed: 0 };
    }
    if (bars.length < MIN_PREFERRED_BARS) {
      warnings.push(`OHLCV バーが不足しています(${bars.length} 本)。一部レンズの確度が下がります`);
    }

    // 2. analysis-engine から指標系列 + パターン flag + SMC/CP/Wyckoff payload を 1 呼び出しで取得
    const seriesRequests = dedupeSeriesRequests(params.indicatorSpecs);
    let engineResponse: AnalysisEngineIndicatorSeriesResponse | null = null;
    try {
      engineResponse = await this.fetchIndicatorSeriesFn(
        {
          symbol: params.symbol,
          timeframe: params.timeframe,
          startDate: windowStart,
          endDate: params.eventTime,
          indicators: seriesRequests.map((req) => ({
            indicatorId: req.indicatorId,
            params: { ...req.params },
            field: req.field,
          })),
          patterns: [...ALL_CANDLE_PATTERN_IDS],
          includeSmc: true,
          includeChartPatterns: true,
          includeWyckoff: true,
        },
        params.correlationId ? { correlationId: params.correlationId } : undefined
      );
    } catch (error) {
      warnings.push(
        `analysis-engine 取得失敗(パターン/SMC/Wyckoff/指標レンズは欠落): ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }

    // 3. 状態レンズを実行
    const lensInput = this.buildLensInput(params, bars, engineResponse);
    const entries: Record<string, LensSnapshotEntry> = {};
    const lensResults = await Promise.allSettled(
      this.stateLenses.map((lens) => lens.compute(lensInput))
    );
    for (let i = 0; i < lensResults.length; i += 1) {
      const result = lensResults[i];
      if (result.status === 'rejected') {
        warnings.push(`状態レンズ ${this.stateLenses[i].name} の計算に失敗: ${String(result.reason)}`);
        continue;
      }
      const entry = lensEntryFromLensFeature(result.value);
      // confidence 0(計算材料なし)のレンズは保存しない(比較でもスキップされるためノイズ削減)
      if (entry.confidence > 0 && Object.keys(entry.features).length > 0) {
        entries[result.value.lensName] = entry;
      }
    }

    // 4. インジケーターレンズを実行
    if (params.indicatorSpecs.length > 0 && engineResponse !== null) {
      const closeSeries = alignCloseSeries(bars, engineResponse.timestamps);
      for (const spec of params.indicatorSpecs) {
        const seriesForLens: Record<string, ReadonlyArray<number | null>> = {};
        for (const req of spec.requiredSeries) {
          const key = makeIndicatorCacheKey(req.indicatorId, { ...req.params }, req.field);
          const series = engineResponse.series[key];
          if (series) {
            seriesForLens[req.seriesKey] = series;
          }
        }
        const entry = computeIndicatorLens(spec, { close: closeSeries, series: seriesForLens });
        if (entry.confidence > 0 && Object.keys(entry.features).length > 0) {
          entries[spec.lensId] = entry;
        } else {
          warnings.push(`インジケーターレンズ ${spec.lensId} は系列不足のため欠落`);
        }
      }
    }

    const snapshot = createNoteLensSnapshot({
      symbol: params.symbol,
      timeframe: params.timeframe,
      ...(params.higherTimeframe !== undefined ? { higherTimeframe: params.higherTimeframe } : {}),
      eventTime: params.eventTime,
      lenses: entries,
    });

    return { snapshot, warnings, barsUsed: bars.length };
  }

  /** DB から eventTime 以前のバー列(古い→新しい)を取得し、末尾 windowBars 本に絞る */
  private async loadBars(
    symbol: string,
    timeframe: string,
    startTime: Date,
    endTime: Date,
    windowBars: number
  ): Promise<OHLCVBar[]> {
    const rows = await this.ohlcvRepository.findManyAsOHLCVData({
      symbol,
      timeframe,
      startTime,
      endTime,
      orderBy: 'asc',
    });
    const bars: OHLCVBar[] = rows.map((row) => ({
      // OHLCVData.timestamp は number | Date のため Date に正規化する
      timestamp: row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }));
    return bars.length > windowBars ? bars.slice(bars.length - windowBars) : bars;
  }

  /** 指標 warmup(最大期間)を考慮したウィンドウバー数 */
  private resolveWindowBars(specs: ReadonlyArray<IndicatorLensSpec>): number {
    let maxPeriod = 0;
    for (const spec of specs) {
      for (const req of spec.requiredSeries) {
        for (const value of Object.values(req.params)) {
          maxPeriod = Math.max(maxPeriod, value);
        }
      }
    }
    return Math.min(MAX_WINDOW_BARS, Math.max(DEFAULT_WINDOW_BARS, maxPeriod * 2 + 60));
  }

  /** 時間足 → 1 バーのミリ秒(未対応の足は null) */
  private resolveBarMs(timeframe: string): number | null {
    const parsed = TimeframeSchema.safeParse(timeframe);
    return parsed.success ? TIMEFRAME_MS[parsed.data] : null;
  }

  /** 状態レンズへの入力を組み立てる */
  private buildLensInput(
    params: LensSnapshotBuildParams,
    bars: ReadonlyArray<OHLCVBar>,
    engineResponse: AnalysisEngineIndicatorSeriesResponse | null
  ): LensInput {
    const input: LensInput = {
      symbol: params.symbol,
      timeframe: params.timeframe,
      timestamp: params.eventTime,
      ohlcvBars: bars,
    };
    if (engineResponse) {
      const flags = buildPatternFlags(engineResponse.patterns);
      if (flags) {
        input.precomputedPatternFlags = flags;
      }
      if (engineResponse.smc) {
        input.precomputedSmcStructures = engineResponse.smc;
      }
      if (engineResponse.chartPatterns) {
        input.precomputedChartPatterns = engineResponse.chartPatterns;
      }
      if (engineResponse.wyckoff) {
        input.precomputedWyckoffPhases = engineResponse.wyckoff;
      }
    }
    return input;
  }
}

/** 複数レンズ仕様の必要系列をキャッシュキーで重複排除する */
function dedupeSeriesRequests(
  specs: ReadonlyArray<IndicatorLensSpec>
): IndicatorSeriesRequest[] {
  const seen = new Map<string, IndicatorSeriesRequest>();
  for (const spec of specs) {
    for (const req of spec.requiredSeries) {
      const key = makeIndicatorCacheKey(req.indicatorId, { ...req.params }, req.field);
      if (!seen.has(key)) {
        seen.set(key, req);
      }
    }
  }
  return [...seen.values()];
}

/**
 * analysis-engine の timestamps に整列した終値系列を作る。
 * DB バーと engine は同じ OHLCVCandle を読むため通常 1:1 だが、
 * 取得タイミング差で欠けたバーは NaN(レンズ側で無効値として扱われる)にする。
 */
function alignCloseSeries(
  bars: ReadonlyArray<OHLCVBar>,
  timestamps: ReadonlyArray<string>
): number[] {
  const closeByTime = new Map<number, number>();
  for (const bar of bars) {
    closeByTime.set(bar.timestamp.getTime(), bar.close);
  }
  return timestamps.map((iso) => closeByTime.get(new Date(iso).getTime()) ?? Number.NaN);
}

/**
 * analysis-engine の patterns(Record<string, boolean[]>)を PatternLens の入力
 * (全 12 パターンを必須キーとする Record)に変換する。空なら undefined。
 */
function buildPatternFlags(
  patterns: Readonly<Record<string, ReadonlyArray<boolean>>>
): Record<CandlePatternId, ReadonlyArray<boolean>> | undefined {
  const keys = Object.keys(patterns);
  if (keys.length === 0) {
    return undefined;
  }
  const flags = {} as Record<CandlePatternId, ReadonlyArray<boolean>>;
  for (const patternId of ALL_CANDLE_PATTERN_IDS) {
    flags[patternId] = patterns[patternId] ?? [];
  }
  return flags;
}
