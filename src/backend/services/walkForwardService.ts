/**
 * ウォークフォワードテストサービス
 * 
 * 目的:
 * - 過学習（オーバーフィッティング）の検出
 * - In-Sample期間で最適化された戦略がOut-of-Sample期間でも機能するか検証
 * - 固定分割方式（3〜5分割）で実装
 * 
 * アルゴリズム:
 * 1. テスト期間を N 分割
 * 2. 各分割で In-Sample (学習用) と Out-of-Sample (検証用) に分ける
 * 3. In-Sample でバックテスト → Out-of-Sample でバックテスト
 * 4. 勝率・PFの乖離から過学習スコアを算出
 */

import { PrismaClient, BacktestStatus, WalkForwardType } from '@prisma/client';
import {
  runBacktest,
  BacktestRequest,
  BacktestResult,
  BacktestTimeframe,
} from './strategyBacktestService';

// Prismaクライアントのシングルトンインスタンス
const prisma = new PrismaClient();

// ============================================
// 型定義
// ============================================

/** ウォークフォワードテスト実行リクエスト */
export interface WalkForwardRequest {
  /** 対象ストラテジーID */
  strategyId: string;
  /** テスト開始日 (YYYY-MM-DD) */
  startDate: string;
  /** テスト終了日 (YYYY-MM-DD) */
  endDate: string;
  /** 分割数（3〜5推奨） */
  splitCount?: number;
  /** In-Sample日数（省略時は自動計算） */
  inSampleDays?: number;
  /** Out-of-Sample日数（省略時は自動計算） */
  outOfSampleDays?: number;
  /** 時間足 */
  timeframe?: BacktestTimeframe;
  /** 初期資金 */
  initialCapital?: number;
  /** ロット数（通貨量） */
  lotSize?: number;
  /** レバレッジ（デフォルト25倍） */
  leverage?: number;
}

/** 分割結果 */
export interface SplitResult {
  /** 分割番号 */
  splitNumber: number;
  /** In-Sample期間 */
  inSamplePeriod: {
    start: string;
    end: string;
  };
  /** Out-of-Sample期間 */
  outOfSamplePeriod: {
    start: string;
    end: string;
  };
  /** In-Sample結果 */
  inSample: {
    winRate: number;
    tradeCount: number;
    profitFactor: number | null;
  };
  /** Out-of-Sample結果 */
  outOfSample: {
    winRate: number;
    tradeCount: number;
    profitFactor: number | null;
  };
  /** 勝率乖離（In - Out） */
  winRateDiff: number;
}

/** ウォークフォワードテスト結果 */
export interface WalkForwardResult {
  /** 実行ID */
  id: string;
  /** ストラテジーID */
  strategyId: string;
  /** テスト種別 */
  type: WalkForwardType;
  /** 分割数 */
  splitCount: number;
  /** 各分割の結果 */
  splits: SplitResult[];
  /** 過学習スコア（0.0〜1.0、低いほど良い） */
  overfitScore: number;
  /** 過学習警告フラグ */
  overfitWarning: boolean;
  /** 統計サマリー */
  summary: {
    /** In-Sample平均勝率 */
    avgInSampleWinRate: number;
    /** Out-of-Sample平均勝率 */
    avgOutOfSampleWinRate: number;
    /** 平均勝率乖離 */
    avgWinRateDiff: number;
    /** In-Sample合計トレード数 */
    totalInSampleTrades: number;
    /** Out-of-Sample合計トレード数 */
    totalOutOfSampleTrades: number;
  };
  /** 実行ステータス */
  status: 'completed' | 'failed';
  /** エラーメッセージ（失敗時） */
  errorMessage?: string;
}

// ============================================
// 期間分割ロジック
// ============================================

interface PeriodSplit {
  inSampleStart: Date;
  inSampleEnd: Date;
  outOfSampleStart: Date;
  outOfSampleEnd: Date;
}

/**
 * プリセットデータのタイムスタンプを取得
 * 休場日を含まない実際のデータポイントを取得する
 */
async function getPresetTimestamps(
  symbol: string,
  timeframe: string,
  startDate: Date,
  endDate: Date
): Promise<Date[]> {
  // OHLCVCandleから実際のタイムスタンプを取得
  const candles = await prisma.oHLCVCandle.findMany({
    where: {
      symbol,
      timeframe,
      timestamp: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: { timestamp: true },
    orderBy: { timestamp: 'asc' },
  });

  return candles.map(c => c.timestamp);
}

/**
 * 期間をプリセットデータのレコード数を基準に分割する
 * 
 * 休場日（週末・祝日）を含まず、実際のデータポイントで分割するため
 * より正確な IS/OOS 期間が得られる
 * 
 * ベストプラクティス（AmiBrokerガイド参考）:
 * - IS:OOS比率は70:30を推奨
 * - 短期間データでは分割数を少なくする（3分割が適切）
 * - 最小でも各Splitで統計的に有意なトレード数を確保
 * 
 * @param timestamps - プリセットの実データタイムスタンプ配列
 * @param splitCount - 分割数
 * @returns 分割された期間の配列
 */
function calculatePeriodSplitsFromTimestamps(
  timestamps: Date[],
  splitCount: number
): PeriodSplit[] {
  if (timestamps.length === 0) {
    console.log('[WalkForward] タイムスタンプが空のため分割できません');
    return [];
  }

  const totalRecords = timestamps.length;
  
  // 最小レコード数を緩和（IS: 30本以上、OOS: 15本以上）
  // 短期間データでも分析可能にする
  const MIN_IN_SAMPLE_RECORDS = 30;
  const MIN_OUT_OF_SAMPLE_RECORDS = 15;
  const MIN_RECORDS_PER_SPLIT = MIN_IN_SAMPLE_RECORDS + MIN_OUT_OF_SAMPLE_RECORDS; // 45本
  
  // データ量に応じて最適な分割数を自動計算
  // 各分割で最低45本必要なので、それを基準に調整
  const maxPossibleSplits = Math.floor(totalRecords / MIN_RECORDS_PER_SPLIT);
  const effectiveSplitCount = Math.min(splitCount, maxPossibleSplits, 3); // 最大3分割に制限
  
  if (effectiveSplitCount < 1) {
    console.log(`[WalkForward] データ不足: ${totalRecords}本では分割できません（最低${MIN_RECORDS_PER_SPLIT}本必要）`);
    return [];
  }
  
  if (effectiveSplitCount < splitCount) {
    console.log(`[WalkForward] 分割数を${splitCount}から${effectiveSplitCount}に自動調整（データ量: ${totalRecords}本）`);
  }
  
  const recordsPerSplit = Math.floor(totalRecords / effectiveSplitCount);
  
  // IS:OOS = 70:30 の比率で分割
  let inRecords = Math.floor(recordsPerSplit * 0.7);
  let outRecords = Math.floor(recordsPerSplit * 0.3);
  
  // 最小レコード数を満たすように調整
  inRecords = Math.max(inRecords, MIN_IN_SAMPLE_RECORDS);
  outRecords = Math.max(outRecords, MIN_OUT_OF_SAMPLE_RECORDS);
  
  console.log(`[WalkForward] データ基準分割: 総レコード=${totalRecords}, 分割数=${effectiveSplitCount}, IS=${inRecords}本, OOS=${outRecords}本`);

  const splits: PeriodSplit[] = [];
  let currentIndex = 0;

  for (let i = 0; i < effectiveSplitCount; i++) {
    // 残りのレコードが十分にあるかチェック
    const remainingRecords = totalRecords - currentIndex;
    
    // 最後の分割では残り全てを使う
    const isLastSplit = i === effectiveSplitCount - 1;
    
    if (!isLastSplit && remainingRecords < inRecords + outRecords) {
      console.log(`[WalkForward] Split ${i + 1}: 残りレコード不足 (${remainingRecords}本), スキップ`);
      break;
    }

    let actualInRecords = inRecords;
    let actualOutRecords = outRecords;
    
    // 最後の分割では残り全てを70:30で分割
    if (isLastSplit && remainingRecords > 0) {
      actualInRecords = Math.floor(remainingRecords * 0.7);
      actualOutRecords = remainingRecords - actualInRecords;
      console.log(`[WalkForward] 最後のSplit: 残り${remainingRecords}本を IS=${actualInRecords}本, OOS=${actualOutRecords}本 で分割`);
    }

    const inSampleStartIdx = currentIndex;
    const inSampleEndIdx = currentIndex + actualInRecords - 1;
    const outOfSampleStartIdx = inSampleEndIdx + 1;
    const outOfSampleEndIdx = Math.min(outOfSampleStartIdx + actualOutRecords - 1, totalRecords - 1);

    splits.push({
      inSampleStart: timestamps[inSampleStartIdx],
      inSampleEnd: timestamps[inSampleEndIdx],
      outOfSampleStart: timestamps[outOfSampleStartIdx],
      outOfSampleEnd: timestamps[outOfSampleEndIdx],
    });

    console.log(`[WalkForward] Split ${i + 1}: IS[${inSampleStartIdx}-${inSampleEndIdx}] ${timestamps[inSampleStartIdx].toISOString().split('T')[0]}〜${timestamps[inSampleEndIdx].toISOString().split('T')[0]}, OOS[${outOfSampleStartIdx}-${outOfSampleEndIdx}] ${timestamps[outOfSampleStartIdx].toISOString().split('T')[0]}〜${timestamps[outOfSampleEndIdx].toISOString().split('T')[0]}`);

    // 次の分割の開始位置
    currentIndex = outOfSampleEndIdx + 1;
  }

  return splits;
}

/**
 * 期間を固定分割する（フォールバック用 - プリセットがない場合）
 * 
 * 例: 12ヶ月のデータを4分割、In-Sample:Out-of-Sample = 2:1 の場合
 * Split 1: In(月1-2), Out(月3)
 * Split 2: In(月4-5), Out(月6)
 * Split 3: In(月7-8), Out(月9)
 * Split 4: In(月10-11), Out(月12)
 */
function calculatePeriodSplitsByDays(
  startDate: Date,
  endDate: Date,
  splitCount: number,
  inSampleDays?: number,
  outOfSampleDays?: number
): PeriodSplit[] {
  const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  
  // 日数が指定されていない場合は自動計算
  // デフォルト: In-Sample 70%, Out-of-Sample 30%
  const daysPerSplit = Math.floor(totalDays / splitCount);
  
  // 最小期間を確保（IS: 3日以上、OOS: 2日以上）
  const MIN_IN_SAMPLE_DAYS = 3;
  const MIN_OUT_OF_SAMPLE_DAYS = 2;
  
  let inDays = inSampleDays ?? Math.floor(daysPerSplit * 0.7);
  let outDays = outOfSampleDays ?? Math.floor(daysPerSplit * 0.3);
  
  // 最小期間を満たすように調整
  inDays = Math.max(inDays, MIN_IN_SAMPLE_DAYS);
  outDays = Math.max(outDays, MIN_OUT_OF_SAMPLE_DAYS);
  
  console.log(`[WalkForward] 日数ベース分割（フォールバック）: 総日数=${totalDays}, 分割数=${splitCount}, IS=${inDays}日, OOS=${outDays}日`);

  const splits: PeriodSplit[] = [];
  let currentStart = new Date(startDate);

  for (let i = 0; i < splitCount; i++) {
    const inSampleStart = new Date(currentStart);
    const inSampleEnd = new Date(currentStart);
    inSampleEnd.setDate(inSampleEnd.getDate() + inDays - 1);

    const outOfSampleStart = new Date(inSampleEnd);
    outOfSampleStart.setDate(outOfSampleStart.getDate() + 1);
    const outOfSampleEnd = new Date(outOfSampleStart);
    outOfSampleEnd.setDate(outOfSampleEnd.getDate() + outDays - 1);

    // 終了日を超えないように調整
    if (outOfSampleEnd > endDate) {
      outOfSampleEnd.setTime(endDate.getTime());
    }

    splits.push({
      inSampleStart,
      inSampleEnd,
      outOfSampleStart,
      outOfSampleEnd,
    });

    // 次の分割の開始位置
    currentStart = new Date(outOfSampleEnd);
    currentStart.setDate(currentStart.getDate() + 1);

    // 残り期間が不足したら終了
    if (currentStart >= endDate) {
      break;
    }
  }

  return splits;
}

/**
 * 過学習スコアを計算
 * 
 * 計算方法:
 * 1. 各分割の勝率乖離（In-Sample - Out-of-Sample）を計算
 * 2. 乖離の平均値と標準偏差を算出
 * 3. スコア = 正規化された乖離 (0.0〜1.0)
 * 
 * 解釈:
 * - 0.0〜0.2: 過学習の兆候なし（良好）
 * - 0.2〜0.4: 軽度の過学習の可能性
 * - 0.4〜0.6: 中程度の過学習
 * - 0.6以上: 深刻な過学習の疑い
 */
function calculateOverfitScore(splits: SplitResult[]): number {
  if (splits.length === 0) return 0;

  // 有効な分割のみ（トレード数が0でないもの）
  const validSplits = splits.filter(
    s => s.inSample.tradeCount > 0 && s.outOfSample.tradeCount > 0
  );

  if (validSplits.length === 0) return 0;

  // 勝率乖離の計算
  const diffs = validSplits.map(s => Math.max(0, s.winRateDiff)); // 正の乖離のみ（In > Out）
  const avgDiff = diffs.reduce((sum, d) => sum + d, 0) / diffs.length;

  // スコア正規化（乖離15%以上で1.0）
  const normalizedScore = Math.min(1, avgDiff / 0.15);

  return Math.round(normalizedScore * 100) / 100;
}

// ============================================
// メイン実行関数
// ============================================

/**
 * ウォークフォワードテストを実行
 */
export async function runWalkForwardTest(
  request: WalkForwardRequest
): Promise<WalkForwardResult> {
  const {
    strategyId,
    startDate,
    endDate,
    splitCount = 4,
    inSampleDays,
    outOfSampleDays,
    timeframe = '1h',
    initialCapital = 1000000,
    lotSize = 10000, // デフォルト1万通貨
    leverage = 25, // デフォルト25倍
  } = request;

  // ストラテジー存在チェック
  const strategy = await prisma.strategy.findUnique({
    where: { id: strategyId },
    include: {
      versions: {
        orderBy: { versionNumber: 'desc' },
        take: 1,
      },
    },
  });

  if (!strategy) {
    throw new Error(`ストラテジー ${strategyId} が見つかりません`);
  }

  const currentVersion = strategy.versions[0];
  if (!currentVersion) {
    throw new Error(`ストラテジー ${strategyId} にバージョンがありません`);
  }

  // WalkForwardRun を作成
  const run = await prisma.walkForwardRun.create({
    data: {
      strategyId,
      versionId: currentVersion.id,
      type: WalkForwardType.fixed_split,
      splitCount,
      inSampleDays: inSampleDays ?? 0, // 後で更新
      outOfSampleDays: outOfSampleDays ?? 0, // 後で更新
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      timeframe,
      status: BacktestStatus.running,
    },
  });

  try {
    console.log(`[WalkForward] 実行開始: ${strategy.name} (${splitCount}分割)`);

    // プリセットデータのタイムスタンプを取得して、データ基準で分割
    const timestamps = await getPresetTimestamps(
      strategy.symbol,
      timeframe,
      new Date(startDate),
      new Date(endDate)
    );

    let periodSplits: PeriodSplit[];
    let actualSplitCount = splitCount;
    
    if (timestamps.length > 0) {
      // プリセットデータがある場合: データ基準で分割（休場日を自動スキップ）
      // calculatePeriodSplitsFromTimestamps 内で分割数が自動調整される
      console.log(`[WalkForward] プリセットデータ ${timestamps.length} 件を基準に分割`);
      periodSplits = calculatePeriodSplitsFromTimestamps(timestamps, splitCount);
      actualSplitCount = periodSplits.length; // 実際に作成された分割数
    } else {
      // プリセットデータなし: 日数ベースで分割（フォールバック）
      console.log(`[WalkForward] プリセットデータなし、日数ベースで分割`);
      periodSplits = calculatePeriodSplitsByDays(
        new Date(startDate),
        new Date(endDate),
        splitCount,
        inSampleDays,
        outOfSampleDays
      );
    }
    
    if (periodSplits.length === 0) {
      throw new Error('期間分割に失敗しました。データが不足している可能性があります。');
    }

    const splitResults: SplitResult[] = [];

    // 各分割でバックテスト実行
    for (let i = 0; i < periodSplits.length; i++) {
      const split = periodSplits[i];
      console.log(`[WalkForward] Split ${i + 1}/${periodSplits.length} 実行中...`);

      // In-Sample バックテスト
      const inSampleRequest: BacktestRequest = {
        strategyId,
        startDate: split.inSampleStart.toISOString().split('T')[0],
        endDate: split.inSampleEnd.toISOString().split('T')[0],
        stage1Timeframe: timeframe,
        runStage2: false,
        initialCapital,
        lotSize,
        leverage,
      };
      const inSampleResult = await runBacktest(inSampleRequest);

      // Out-of-Sample バックテスト
      const outOfSampleRequest: BacktestRequest = {
        strategyId,
        startDate: split.outOfSampleStart.toISOString().split('T')[0],
        endDate: split.outOfSampleEnd.toISOString().split('T')[0],
        stage1Timeframe: timeframe,
        runStage2: false,
        initialCapital,
        lotSize,
        leverage,
      };
      const outOfSampleResult = await runBacktest(outOfSampleRequest);

      // 結果を集計
      const winRateDiff = inSampleResult.summary.winRate - outOfSampleResult.summary.winRate;

      const splitResult: SplitResult = {
        splitNumber: i + 1,
        inSamplePeriod: {
          start: split.inSampleStart.toISOString().split('T')[0],
          end: split.inSampleEnd.toISOString().split('T')[0],
        },
        outOfSamplePeriod: {
          start: split.outOfSampleStart.toISOString().split('T')[0],
          end: split.outOfSampleEnd.toISOString().split('T')[0],
        },
        inSample: {
          winRate: inSampleResult.summary.winRate,
          tradeCount: inSampleResult.summary.totalTrades,
          profitFactor: inSampleResult.summary.profitFactor,
        },
        outOfSample: {
          winRate: outOfSampleResult.summary.winRate,
          tradeCount: outOfSampleResult.summary.totalTrades,
          profitFactor: outOfSampleResult.summary.profitFactor,
        },
        winRateDiff,
      };

      splitResults.push(splitResult);

      // DBに分割結果を保存
      await prisma.walkForwardSplit.create({
        data: {
          runId: run.id,
          splitNumber: i + 1,
          inSampleStart: split.inSampleStart,
          inSampleEnd: split.inSampleEnd,
          outOfSampleStart: split.outOfSampleStart,
          outOfSampleEnd: split.outOfSampleEnd,
          inSampleWinRate: inSampleResult.summary.winRate,
          inSampleTradeCount: inSampleResult.summary.totalTrades,
          inSampleProfitFactor: inSampleResult.summary.profitFactor,
          outOfSampleWinRate: outOfSampleResult.summary.winRate,
          outOfSampleTradeCount: outOfSampleResult.summary.totalTrades,
          outOfSampleProfitFactor: outOfSampleResult.summary.profitFactor,
          winRateDiff,
        },
      });
    }

    // 過学習スコアを計算
    const overfitScore = calculateOverfitScore(splitResults);
    const overfitWarning = overfitScore >= 0.4;

    // サマリー計算
    const totalInSampleTrades = splitResults.reduce((sum, s) => sum + s.inSample.tradeCount, 0);
    const totalOutOfSampleTrades = splitResults.reduce((sum, s) => sum + s.outOfSample.tradeCount, 0);
    const avgInSampleWinRate = splitResults.length > 0
      ? splitResults.reduce((sum, s) => sum + s.inSample.winRate, 0) / splitResults.length
      : 0;
    const avgOutOfSampleWinRate = splitResults.length > 0
      ? splitResults.reduce((sum, s) => sum + s.outOfSample.winRate, 0) / splitResults.length
      : 0;
    const avgWinRateDiff = avgInSampleWinRate - avgOutOfSampleWinRate;

    // 実行結果を更新
    await prisma.walkForwardRun.update({
      where: { id: run.id },
      data: {
        status: BacktestStatus.completed,
        overfitScore,
        overfitWarning,
        inSampleDays: inSampleDays ?? Math.floor(
          (new Date(periodSplits[0]?.inSampleEnd || startDate).getTime() -
           new Date(periodSplits[0]?.inSampleStart || startDate).getTime()) /
          (1000 * 60 * 60 * 24)
        ),
        outOfSampleDays: outOfSampleDays ?? Math.floor(
          (new Date(periodSplits[0]?.outOfSampleEnd || endDate).getTime() -
           new Date(periodSplits[0]?.outOfSampleStart || endDate).getTime()) /
          (1000 * 60 * 60 * 24)
        ),
      },
    });

    console.log(`[WalkForward] 完了: 過学習スコア=${overfitScore}, 警告=${overfitWarning}, 実際の分割数=${actualSplitCount}`);

    return {
      id: run.id,
      strategyId,
      type: WalkForwardType.fixed_split,
      splitCount: actualSplitCount, // 実際に使用された分割数を返す
      splits: splitResults,
      overfitScore,
      overfitWarning,
      summary: {
        avgInSampleWinRate,
        avgOutOfSampleWinRate,
        avgWinRateDiff,
        totalInSampleTrades,
        totalOutOfSampleTrades,
      },
      status: 'completed',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '不明なエラー';
    
    // エラー状態で更新
    await prisma.walkForwardRun.update({
      where: { id: run.id },
      data: {
        status: BacktestStatus.failed,
      },
    });

    console.error('[WalkForward] 実行エラー:', errorMessage);

    return {
      id: run.id,
      strategyId,
      type: WalkForwardType.fixed_split,
      splitCount,
      splits: [],
      overfitScore: 0,
      overfitWarning: false,
      summary: {
        avgInSampleWinRate: 0,
        avgOutOfSampleWinRate: 0,
        avgWinRateDiff: 0,
        totalInSampleTrades: 0,
        totalOutOfSampleTrades: 0,
      },
      status: 'failed',
      errorMessage,
    };
  }
}

// ============================================
// 履歴取得
// ============================================

/**
 * ウォークフォワードテスト結果を取得
 */
export async function getWalkForwardResult(runId: string): Promise<WalkForwardResult | null> {
  const run = await prisma.walkForwardRun.findUnique({
    where: { id: runId },
    include: {
      splits: {
        orderBy: { splitNumber: 'asc' },
      },
    },
  });

  if (!run) return null;

  const splits: SplitResult[] = run.splits.map(s => ({
    splitNumber: s.splitNumber,
    inSamplePeriod: {
      start: s.inSampleStart.toISOString().split('T')[0],
      end: s.inSampleEnd.toISOString().split('T')[0],
    },
    outOfSamplePeriod: {
      start: s.outOfSampleStart.toISOString().split('T')[0],
      end: s.outOfSampleEnd.toISOString().split('T')[0],
    },
    inSample: {
      winRate: s.inSampleWinRate,
      tradeCount: s.inSampleTradeCount,
      profitFactor: s.inSampleProfitFactor,
    },
    outOfSample: {
      winRate: s.outOfSampleWinRate,
      tradeCount: s.outOfSampleTradeCount,
      profitFactor: s.outOfSampleProfitFactor,
    },
    winRateDiff: s.winRateDiff,
  }));

  // サマリー計算
  const totalInSampleTrades = splits.reduce((sum, s) => sum + s.inSample.tradeCount, 0);
  const totalOutOfSampleTrades = splits.reduce((sum, s) => sum + s.outOfSample.tradeCount, 0);
  const avgInSampleWinRate = splits.length > 0
    ? splits.reduce((sum, s) => sum + s.inSample.winRate, 0) / splits.length
    : 0;
  const avgOutOfSampleWinRate = splits.length > 0
    ? splits.reduce((sum, s) => sum + s.outOfSample.winRate, 0) / splits.length
    : 0;

  return {
    id: run.id,
    strategyId: run.strategyId,
    type: run.type,
    splitCount: run.splitCount,
    splits,
    overfitScore: run.overfitScore ?? 0,
    overfitWarning: run.overfitWarning ?? false,
    summary: {
      avgInSampleWinRate,
      avgOutOfSampleWinRate,
      avgWinRateDiff: avgInSampleWinRate - avgOutOfSampleWinRate,
      totalInSampleTrades,
      totalOutOfSampleTrades,
    },
    status: run.status === BacktestStatus.completed ? 'completed' : 'failed',
  };
}

/**
 * ストラテジーのウォークフォワードテスト履歴を取得
 */
export async function getWalkForwardHistory(
  strategyId: string,
  limit: number = 10
): Promise<WalkForwardResult[]> {
  const runs = await prisma.walkForwardRun.findMany({
    where: { strategyId },
    include: {
      splits: {
        orderBy: { splitNumber: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return runs.map(run => {
    const splits: SplitResult[] = run.splits.map(s => ({
      splitNumber: s.splitNumber,
      inSamplePeriod: {
        start: s.inSampleStart.toISOString().split('T')[0],
        end: s.inSampleEnd.toISOString().split('T')[0],
      },
      outOfSamplePeriod: {
        start: s.outOfSampleStart.toISOString().split('T')[0],
        end: s.outOfSampleEnd.toISOString().split('T')[0],
      },
      inSample: {
        winRate: s.inSampleWinRate,
        tradeCount: s.inSampleTradeCount,
        profitFactor: s.inSampleProfitFactor,
      },
      outOfSample: {
        winRate: s.outOfSampleWinRate,
        tradeCount: s.outOfSampleTradeCount,
        profitFactor: s.outOfSampleProfitFactor,
      },
      winRateDiff: s.winRateDiff,
    }));

    const totalInSampleTrades = splits.reduce((sum, s) => sum + s.inSample.tradeCount, 0);
    const totalOutOfSampleTrades = splits.reduce((sum, s) => sum + s.outOfSample.tradeCount, 0);
    const avgInSampleWinRate = splits.length > 0
      ? splits.reduce((sum, s) => sum + s.inSample.winRate, 0) / splits.length
      : 0;
    const avgOutOfSampleWinRate = splits.length > 0
      ? splits.reduce((sum, s) => sum + s.outOfSample.winRate, 0) / splits.length
      : 0;

    return {
      id: run.id,
      strategyId: run.strategyId,
      type: run.type,
      splitCount: run.splitCount,
      splits,
      overfitScore: run.overfitScore ?? 0,
      overfitWarning: run.overfitWarning ?? false,
      summary: {
        avgInSampleWinRate,
        avgOutOfSampleWinRate,
        avgWinRateDiff: avgInSampleWinRate - avgOutOfSampleWinRate,
        totalInSampleTrades,
        totalOutOfSampleTrades,
      },
      status: run.status === BacktestStatus.completed ? 'completed' : 'failed',
    };
  });
}
