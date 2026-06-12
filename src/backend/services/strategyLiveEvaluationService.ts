/**
 * ストラテジー ライブ条件評価サービス (Phase γ-1)
 *
 * 正本: docs/side-a/completion-roadmap.md §3「ライブ条件評価エンジン」
 *
 * 責務:
 * - active なストラテジー(アラート有効)の条件ツリーを**現在の市場**に対して評価し、
 *   成立したら既存の StrategyAlert 発火経路(triggerAlert: クールダウン/チャネル/ログ)に渡す
 * - 「評価 1 経路化」: バックテストと**同じ評価器**(`evaluateConditionGroup`)・
 *   **同じキャッシュ変換**(`buildEvaluationCaches`)・**同じ指標ソース**(analysis-engine)を使う。
 *   ライブ専用の判定ロジックを持たない(将来の挙動乖離を構造的に防ぐ)
 *
 * 評価方式:
 * - 直近 WINDOW_BARS 本のバー列を取り、**最終バー時点**で条件が成立しているかを判定する
 * - IF_THEN / SEQUENCE などの状態を持つ条件は、バックテストと同様に
 *   ウォームアップ以降のバーを順に評価して状態を構築してから最終バーで判定する
 * - 通知の抑制(クールダウン等)は既存 triggerAlert の責務(本サービスは判定まで)
 */

import type { TradeSide } from '@prisma/client';
import type { CandlePatternId } from '../../shared/patterns';
import type { ConditionGroup, EvaluationContext, OHLCV } from './strategyConditionEvaluator';
import { evaluateConditionGroup,
  collectTimeframeOverrides,
  collectLensConditions,
  buildTimeframeIndexMap,
  type TimeframeView,
} from './strategyConditionEvaluator';
import type { StrategyDetail } from './strategyService';
import { getStrategy } from './strategyService';
import type { BacktestTimeframe } from './strategyBacktestService';
import {
  appendLensSeriesToCache,
  buildEvaluationCaches,
  fetchHistoricalData,
  isBacktestTimeframe,
} from './strategyBacktestService';
import { fetchIndicatorSeries, fetchIndicatorSeriesByStrategyVersion } from './analysisEngineClient';
import { fetchAndCacheOhlcv } from './fetchAndCacheOhlcv';
import type { AlertWithStrategy, TriggerAlertResult } from './strategyAlertService';
import { listEnabledAlerts, triggerAlert } from './strategyAlertService';
import { TIMEFRAME_MS } from '../../infrastructure/market/ohlcvAggregation';
import { TimeframeSchema } from '../../infrastructure/market/IMarketDataProvider';
import type { JsonValue } from '../../utils/jsonValue';

/** 評価ウィンドウのバー数(ウォームアップ 50 本 + 評価文脈 120 本) */
const WINDOW_BARS = 170;

/** バックテストと同じウォームアップ本数(最初の 50 本は指標計算用にスキップ) */
const WARMUP_BARS = 50;

/** 評価に最低限必要なバー数(これ未満は insufficient_data でスキップ) */
const MIN_REQUIRED_BARS = 60;

/** 休場(週末等)を跨いでもバー数を確保するためのカレンダー係数 */
const CALENDAR_BUFFER_FACTOR = 2;

/** 1 ストラテジー分の評価結果 */
export interface LiveEvaluationStrategyResult {
  readonly strategyId: string;
  readonly strategyName: string;
  readonly symbol: string;
  readonly timeframe: string | null;
  /** 方向別の条件成立状況(side=both は buy/sell の 2 件) */
  readonly evaluations: ReadonlyArray<{ side: TradeSide; conditionMet: boolean }>;
  /** アラートが実際に発火(通知送信)されたか */
  readonly triggered: boolean;
  /** 評価できなかった/発火しなかった理由 */
  readonly skipReason?: string;
}

/** ライブ評価 1 実行分のサマリー */
export interface LiveEvaluationRunResult {
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly durationMs: number;
  /** 評価対象になったアラート数 */
  readonly alertsEvaluated: number;
  /** 条件が成立したストラテジー数 */
  readonly conditionMet: number;
  /** 実際に通知が発火したストラテジー数 */
  readonly triggered: number;
  /** スキップ理由 → 件数 */
  readonly skipped: Record<string, number>;
  readonly errors: string[];
  readonly strategies: LiveEvaluationStrategyResult[];
}

/** DI 用の依存(テストで差し替え) */
export interface LiveStrategyEvaluationDeps {
  listEnabledAlertsFn?: typeof listEnabledAlerts;
  getStrategyFn?: typeof getStrategy;
  fetchHistoricalDataFn?: typeof fetchHistoricalData;
  fetchAndCacheOhlcvFn?: typeof fetchAndCacheOhlcv;
  fetchIndicatorSeriesFn?: typeof fetchIndicatorSeriesByStrategyVersion;
  /** レンズ条件 (#3) の必要系列取得(明示指定 API)。テストで差し替え */
  fetchLensSeriesFn?: typeof fetchIndicatorSeries;
  triggerAlertFn?: typeof triggerAlert;
}

export class LiveStrategyEvaluationService {
  private readonly listEnabledAlertsFn: typeof listEnabledAlerts;
  private readonly getStrategyFn: typeof getStrategy;
  private readonly fetchHistoricalDataFn: typeof fetchHistoricalData;
  private readonly fetchAndCacheOhlcvFn: typeof fetchAndCacheOhlcv;
  private readonly fetchIndicatorSeriesFn: typeof fetchIndicatorSeriesByStrategyVersion;
  private readonly fetchLensSeriesFn: typeof fetchIndicatorSeries;
  private readonly triggerAlertFn: typeof triggerAlert;

  constructor(deps: LiveStrategyEvaluationDeps = {}) {
    this.listEnabledAlertsFn = deps.listEnabledAlertsFn ?? listEnabledAlerts;
    this.getStrategyFn = deps.getStrategyFn ?? getStrategy;
    this.fetchHistoricalDataFn = deps.fetchHistoricalDataFn ?? fetchHistoricalData;
    this.fetchAndCacheOhlcvFn = deps.fetchAndCacheOhlcvFn ?? fetchAndCacheOhlcv;
    this.fetchIndicatorSeriesFn = deps.fetchIndicatorSeriesFn ?? fetchIndicatorSeriesByStrategyVersion;
    this.fetchLensSeriesFn = deps.fetchLensSeriesFn ?? fetchIndicatorSeries;
    this.triggerAlertFn = deps.triggerAlertFn ?? triggerAlert;
  }

  /**
   * アラート有効な全ストラテジーをライブ評価する(cron から 15 分間隔で呼ばれる想定)。
   * ストラテジー単位の失敗は握って継続する(1 件の失敗が全体を止めない)。
   */
  async evaluateActiveStrategyAlerts(): Promise<LiveEvaluationRunResult> {
    const startedAt = new Date();
    const errors: string[] = [];
    const skipped: Record<string, number> = {};
    const strategies: LiveEvaluationStrategyResult[] = [];
    const bumpSkip = (reason: string): void => {
      skipped[reason] = (skipped[reason] ?? 0) + 1;
    };

    const alerts = await this.listEnabledAlertsFn();

    // 同一 symbol × timeframe のバー列は 1 回だけロードする(run 内キャッシュ)
    const barsCache = new Map<string, { bars: OHLCV[]; warning?: string }>();

    for (const alert of alerts) {
      try {
        const result = await this.evaluateSingleAlert(alert, barsCache, startedAt);
        strategies.push(result);
        if (result.skipReason !== undefined) {
          bumpSkip(result.skipReason);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${alert.strategy.name} (${alert.strategy.symbol}): ${message}`);
        console.error(
          `[LiveStrategyEval] 評価エラー (継続): strategyId=${alert.strategyId}`,
          error
        );
      }
    }

    const finishedAt = new Date();
    const result: LiveEvaluationRunResult = {
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      alertsEvaluated: strategies.length,
      conditionMet: strategies.filter((s) => s.evaluations.some((e) => e.conditionMet)).length,
      triggered: strategies.filter((s) => s.triggered).length,
      skipped,
      errors,
      strategies,
    };
    console.log(
      `[LiveStrategyEval] 完了: evaluated=${result.alertsEvaluated} ` +
        `conditionMet=${result.conditionMet} triggered=${result.triggered} ` +
        `errors=${errors.length} durationMs=${result.durationMs}`
    );
    return result;
  }

  /** 1 アラート分の評価 */
  private async evaluateSingleAlert(
    alert: AlertWithStrategy,
    barsCache: Map<string, { bars: OHLCV[]; warning?: string }>,
    now: Date
  ): Promise<LiveEvaluationStrategyResult> {
    const base = {
      strategyId: alert.strategyId,
      strategyName: alert.strategy.name,
      symbol: alert.strategy.symbol,
    };

    const strategy = await this.getStrategyFn(alert.strategyId);
    if (!strategy) {
      return { ...base, timeframe: null, evaluations: [], triggered: false, skipReason: 'strategy_not_found' };
    }
    if (strategy.status !== 'active') {
      return { ...base, timeframe: strategy.timeframe, evaluations: [], triggered: false, skipReason: 'strategy_not_active' };
    }
    if (!strategy.currentVersion) {
      return { ...base, timeframe: strategy.timeframe, evaluations: [], triggered: false, skipReason: 'no_current_version' };
    }
    const timeframe = strategy.timeframe;
    if (!timeframe) {
      // レガシー行(timeframe 未設定)は評価基準足が決められないためスキップ
      return { ...base, timeframe: null, evaluations: [], triggered: false, skipReason: 'no_timeframe' };
    }
    const parsedTf = TimeframeSchema.safeParse(timeframe);
    if (!parsedTf.success) {
      return { ...base, timeframe, evaluations: [], triggered: false, skipReason: 'unsupported_timeframe' };
    }
    const barMs = TIMEFRAME_MS[parsedTf.data];

    // === バー列の取得(run 内キャッシュ + 鮮度の自己回復) ===
    const cacheKey = `${strategy.symbol}__${timeframe}`;
    let cached = barsCache.get(cacheKey);
    if (!cached) {
      cached = await this.loadFreshBars(strategy.symbol, timeframe as BacktestTimeframe, barMs, now);
      barsCache.set(cacheKey, cached);
    }
    const bars = cached.bars;
    if (bars.length < MIN_REQUIRED_BARS) {
      return { ...base, timeframe, evaluations: [], triggered: false, skipReason: 'insufficient_data' };
    }
    // 鮮度の最終ガード: 市場開場中なのに最終バーが古すぎる場合は誤発火を避けて評価しない
    const staleLimitMs = Math.max(6 * barMs, 2 * 60 * 60 * 1000);
    const lastBarTime = bars[bars.length - 1].timestamp.getTime();
    if (now.getTime() - lastBarTime > staleLimitMs) {
      return { ...base, timeframe, evaluations: [], triggered: false, skipReason: 'stale_market_data' };
    }

    // === 指標系列の取得(バー列と同一範囲で index 整合を保証) ===
    const indicatorSeries = await this.fetchIndicatorSeriesFn({
      strategyId: strategy.id,
      versionId: strategy.currentVersion.id,
      symbol: strategy.symbol,
      timeframe,
      startDate: bars[0].timestamp,
      endDate: bars[bars.length - 1].timestamp,
      patterns: [],
    });
    const { indicatorCache, patternCache } = buildEvaluationCaches(indicatorSeries);
    // evaluator は currentIndex でバー列と指標系列の両方を引くため、長さ不一致は
    // 誤った時点の指標値で判定する事故になる。ズレ検出時は評価しない
    const seriesLengths = [...indicatorCache.values()].map((v) => v.length);
    if (seriesLengths.some((len) => len !== bars.length)) {
      return { ...base, timeframe, evaluations: [], triggered: false, skipReason: 'series_alignment_mismatch' };
    }

    // === 条件評価(バックテストと同じ評価器・同じ entryPlans 構成) ===
    const entryConditions = strategy.currentVersion.entryConditions as ConditionGroup | null;
    const shortEntryConditions =
      (strategy.currentVersion.shortEntryConditions ?? null) as ConditionGroup | null;
    const entryPlans: { side: TradeSide; group: ConditionGroup | null }[] =
      strategy.side === 'both'
        ? [
            { side: 'buy', group: entryConditions },
            { side: 'sell', group: shortEntryConditions },
          ]
        : [{ side: strategy.side === 'sell' ? 'sell' : 'buy', group: entryConditions }];

    // === レンズ条件 (#3): per-bar レンズ系列を基準足キャッシュに追加(バックテストと同じ経路) ===
    const allLensConditions = entryPlans.flatMap((plan) => collectLensConditions(plan.group));
    await appendLensSeriesToCache({
      indicatorCache,
      lensConditions: allLensConditions.filter(
        (c) => !c.timeframeOverride || c.timeframeOverride === timeframe
      ),
      symbol: strategy.symbol,
      timeframe,
      startDate: bars[0].timestamp,
      endDate: bars[bars.length - 1].timestamp,
      closes: bars.map((bar) => bar.close),
      fetchIndicatorSeriesFn: this.fetchLensSeriesFn,
    });

    // === MTF: timeframeOverride 条件用の別時間足ビューを準備 (Phase γ) ===
    // バー列はバックテストと同じ「確定バーのみ参照」の indexMap で整列し、
    // 進行中の上位足バーによる早すぎる発火 (lookahead) を防ぐ。
    const overrideTimeframes = new Set<string>();
    for (const plan of entryPlans) {
      for (const tf of collectTimeframeOverrides(plan.group, timeframe)) {
        overrideTimeframes.add(tf);
      }
    }
    const timeframeViews = new Map<string, TimeframeView>();
    for (const tf of overrideTimeframes) {
      const parsedViewTf = TimeframeSchema.safeParse(tf);
      // TimeframeSchema は '1M' 等も許容するが、loadFreshBars / 指標取得が対応する
      // BacktestTimeframe 集合 (MTF override は 1d/1w まで) 以外は安全にスキップする
      // (手動編集 JSON で未対応足が紛れても誤判定しない。Copilot レビュー対応)
      if (!parsedViewTf.success || !isBacktestTimeframe(tf)) {
        return { ...base, timeframe, evaluations: [], triggered: false, skipReason: 'mtf_unsupported_timeframe' };
      }
      const viewBarMs = TIMEFRAME_MS[parsedViewTf.data];
      const viewCacheKey = `${strategy.symbol}__${tf}`;
      let viewCached = barsCache.get(viewCacheKey);
      if (!viewCached) {
        viewCached = await this.loadFreshBars(strategy.symbol, tf, viewBarMs, now);
        barsCache.set(viewCacheKey, viewCached);
      }
      const viewBars = viewCached.bars;
      if (viewBars.length < MIN_REQUIRED_BARS) {
        return { ...base, timeframe, evaluations: [], triggered: false, skipReason: 'mtf_insufficient_data' };
      }
      // 鮮度ガード (基準足と同じ規則をビューの足幅でスケール)
      const viewStaleLimitMs = Math.max(6 * viewBarMs, 2 * 60 * 60 * 1000);
      const viewLastBarTime = viewBars[viewBars.length - 1].timestamp.getTime();
      if (now.getTime() - viewLastBarTime > viewStaleLimitMs) {
        return { ...base, timeframe, evaluations: [], triggered: false, skipReason: 'mtf_stale_market_data' };
      }
      const viewSeries = await this.fetchIndicatorSeriesFn({
        strategyId: strategy.id,
        versionId: strategy.currentVersion.id,
        symbol: strategy.symbol,
        timeframe: tf,
        startDate: viewBars[0].timestamp,
        endDate: viewBars[viewBars.length - 1].timestamp,
        patterns: [],
      });
      const viewCaches = buildEvaluationCaches(viewSeries);
      // パターン条件のみのストラテジーは indicatorCache が空のため patternCache も検証する
      const viewLengths = [
        ...viewCaches.indicatorCache.values(),
        ...viewCaches.patternCache.values(),
      ].map((v) => v.length);
      if (viewLengths.some((len) => len !== viewBars.length)) {
        return { ...base, timeframe, evaluations: [], triggered: false, skipReason: 'mtf_series_alignment_mismatch' };
      }
      // レンズ条件 (#3): この足を override に指定したレンズ条件の系列をビュー側キャッシュへ
      await appendLensSeriesToCache({
        indicatorCache: viewCaches.indicatorCache,
        lensConditions: allLensConditions.filter((c) => c.timeframeOverride === tf),
        symbol: strategy.symbol,
        timeframe: tf,
        startDate: viewBars[0].timestamp,
        endDate: viewBars[viewBars.length - 1].timestamp,
        closes: viewBars.map((bar) => bar.close),
        fetchIndicatorSeriesFn: this.fetchLensSeriesFn,
      });
      timeframeViews.set(tf, {
        data: viewBars,
        indicatorCache: viewCaches.indicatorCache,
        patternCache: viewCaches.patternCache,
        indexMap: buildTimeframeIndexMap(bars, barMs, viewBars, viewBarMs),
      });
    }

    const evaluations: { side: TradeSide; conditionMet: boolean }[] = [];
    for (const plan of entryPlans) {
      if (!plan.group) {
        evaluations.push({ side: plan.side, conditionMet: false });
        continue;
      }
      const met = await this.evaluateGroupAtLatestBar(
        strategy,
        bars,
        indicatorCache,
        patternCache,
        plan.group,
        timeframeViews.size > 0 ? timeframeViews : undefined
      );
      evaluations.push({ side: plan.side, conditionMet: met });
    }

    const anyMet = evaluations.some((e) => e.conditionMet);
    if (!anyMet) {
      return { ...base, timeframe, evaluations, triggered: false };
    }

    // === アラート発火(クールダウン・チャネル送信・ログは triggerAlert の責務) ===
    const indicatorValues = this.collectLatestIndicatorValues(
      indicatorCache,
      bars,
      evaluations.filter((e) => e.conditionMet).map((e) => e.side)
    );
    const triggerResult: TriggerAlertResult = await this.triggerAlertFn({
      strategyId: strategy.id,
      // ライブ評価は条件の真偽判定のため、成立 = 1.0 を渡す(minMatchScore は常に満たす)
      matchScore: 1.0,
      indicatorValues,
    });

    console.log(
      `[LiveStrategyEval] 条件成立: ${strategy.name} (${strategy.symbol} ${timeframe}) ` +
        `sides=${evaluations.filter((e) => e.conditionMet).map((e) => e.side).join(',')} ` +
        `triggered=${triggerResult.triggered}` +
        (triggerResult.skipReason ? ` skip=${triggerResult.skipReason}` : '')
    );

    const result: LiveEvaluationStrategyResult = {
      ...base,
      timeframe,
      evaluations,
      triggered: triggerResult.triggered,
      ...(triggerResult.triggered || triggerResult.skipReason === undefined
        ? {}
        : { skipReason: `alert_${normalizeSkipReason(triggerResult.skipReason)}` }),
    };
    return result;
  }

  /**
   * 最終バー時点での条件成立を判定する。
   * 状態を持つ条件(IF_THEN/SEQUENCE)はバックテストと同様にウォームアップ以降を
   * 順に評価して状態を構築する。状態を持たない条件は最終バーのみ評価(高速化)。
   */
  private async evaluateGroupAtLatestBar(
    strategy: StrategyDetail,
    bars: OHLCV[],
    indicatorCache: Map<string, number[]>,
    patternCache: Map<CandlePatternId, boolean[]>,
    group: ConditionGroup,
    timeframeViews?: Map<string, TimeframeView>
  ): Promise<boolean> {
    const ctx: EvaluationContext = {
      data: bars,
      currentIndex: 0,
      indicatorCache,
      patternCache,
      strategy,
      ...(timeframeViews !== undefined ? { timeframeViews } : {}),
    };
    const lastIndex = bars.length - 1;
    if (!isStatefulConditionGroup(group)) {
      ctx.currentIndex = lastIndex;
      return evaluateConditionGroup(ctx, group);
    }
    // 状態構築のためのリプレイ(バックテストの i ループと同じ走査)
    const startIndex = Math.min(WARMUP_BARS, lastIndex);
    let met = false;
    for (let i = startIndex; i <= lastIndex; i += 1) {
      ctx.currentIndex = i;
      const result = await evaluateConditionGroup(ctx, group);
      if (i === lastIndex) {
        met = result;
      }
    }
    return met;
  }

  /**
   * バー列を取得し、不足・鮮度切れなら期間指定フェッチで 1 回だけ自己回復する。
   * (LensSnapshotBuilder と同じ方針。fetchHistoricalData の coversEnd 許容は週末対応で
   *  49h と広いため、ライブ用の鮮度判定はここで別途行う)
   */
  private async loadFreshBars(
    symbol: string,
    timeframe: BacktestTimeframe,
    barMs: number,
    now: Date
  ): Promise<{ bars: OHLCV[]; warning?: string }> {
    const windowStart = new Date(now.getTime() - barMs * WINDOW_BARS * CALENDAR_BUFFER_FACTOR);
    let bars = await this.fetchHistoricalDataFn(symbol, timeframe, windowStart, now, false);
    const freshnessGapMs = Math.max(3 * barMs, 30 * 60_000);
    const lastBarTime = bars.length > 0 ? bars[bars.length - 1].timestamp.getTime() : null;
    const needsCoverage = bars.length < MIN_REQUIRED_BARS;
    const needsFreshness = lastBarTime !== null && now.getTime() - lastBarTime > freshnessGapMs;
    let warning: string | undefined;
    if (needsCoverage || needsFreshness) {
      const fetchFrom = needsCoverage || lastBarTime === null ? windowStart : new Date(lastBarTime);
      try {
        const fetchResult = await this.fetchAndCacheOhlcvFn(symbol, timeframe, fetchFrom, now);
        if (!fetchResult.success) {
          warning = `OHLCV 補完フェッチ失敗: ${fetchResult.error ?? '不明'}`;
        }
      } catch (error) {
        warning = `OHLCV 補完フェッチ例外: ${error instanceof Error ? error.message : String(error)}`;
      }
      bars = await this.fetchHistoricalDataFn(symbol, timeframe, windowStart, now, false);
    }
    // ウィンドウ超過分は末尾(最新側)を残して切り詰める
    if (bars.length > WINDOW_BARS) {
      bars = bars.slice(bars.length - WINDOW_BARS);
    }
    return warning !== undefined ? { bars, warning } : { bars };
  }

  /** 発火時に記録する最新インジケーター値のスナップショットを作る */
  private collectLatestIndicatorValues(
    indicatorCache: Map<string, number[]>,
    bars: OHLCV[],
    metSides: TradeSide[]
  ): Record<string, JsonValue> {
    const lastBar = bars[bars.length - 1];
    const values: Record<string, JsonValue> = {
      bar_time: lastBar.timestamp.toISOString(),
      close: lastBar.close,
      met_sides: metSides,
    };
    let count = 0;
    for (const [key, series] of indicatorCache.entries()) {
      if (count >= 24) {
        // ログ用スナップショットの肥大化防止(全系列は保存しない)
        break;
      }
      const latest = series[series.length - 1];
      if (Number.isFinite(latest)) {
        values[key] = latest;
        count += 1;
      }
    }
    return values;
  }
}

/**
 * triggerAlert の日本語 skipReason を集計用の短い理由コードに変換する。
 * (triggerAlert 側の文言は UI 向けのため変更せず、集計側で吸収する)
 */
function normalizeSkipReason(reason: string): string {
  if (reason.includes('クールダウン')) {
    return 'cooldown';
  }
  if (reason.includes('スコア')) {
    return 'score_below_min';
  }
  if (reason.includes('無効')) {
    return 'disabled';
  }
  if (reason.includes('存在しません')) {
    return 'not_configured';
  }
  return 'other';
}

/** 条件ツリーが状態(IF_THEN/SEQUENCE)を含むかを再帰判定する */
export function isStatefulConditionGroup(group: ConditionGroup): boolean {
  if (group.operator === 'IF_THEN' || group.operator === 'SEQUENCE') {
    return true;
  }
  for (const condition of group.conditions ?? []) {
    if (isConditionGroup(condition) && isStatefulConditionGroup(condition)) {
      return true;
    }
  }
  return false;
}

/**
 * ネスト条件が ConditionGroup かを判別する。
 * IndicatorCondition も operator(比較演算子)を持つため、論理演算子の集合に
 * 含まれるかどうかで判別する。
 */
function isConditionGroup(
  condition: ConditionGroup | { conditionId?: string } | { type?: string }
): condition is ConditionGroup {
  if (typeof condition !== 'object' || condition === null || !('operator' in condition)) {
    return false;
  }
  const operator = condition.operator;
  return (
    typeof operator === 'string' &&
    ['AND', 'OR', 'NOT', 'IF_THEN', 'SEQUENCE'].includes(operator)
  );
}
