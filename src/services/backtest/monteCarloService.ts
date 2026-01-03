/**
 * モンテカルロシミュレーションサービス
 * 
 * 目的:
 * - ランダムエントリー戦略をシミュレートし、実際の戦略と比較
 * - 戦略のパフォーマンスが「運」ではなく「優位性」によるものか検証
 * - 勝率・PF・最大DDの分布を計算し、パーセンタイルを算出
 * 
 * 参考:
 * - モンテカルロ法による統計的検定
 * - ランダムウォーク仮説の検証
 */

import { OHLCVRepository } from '../../backend/repositories/ohlcvRepository';
import { calculateSummary, BacktestResultSummary, BacktestTradeEvent, TradeSide } from '../../backend/services/backtestCalculations';
import { OHLCVData } from '../indicators/indicatorService';
import { v4 as uuidv4 } from 'uuid';

// モンテカルロシミュレーションパラメータ
export interface MonteCarloParams {
  /** 銘柄 */
  symbol: string;
  /** 時間足 */
  timeframe: string;
  /** 開始日 */
  startDate: Date;
  /** 終了日 */
  endDate: Date;
  /** シミュレーション回数 */
  iterations: 100 | 500 | 1000;
  /** 利確幅（%） */
  takeProfit: number;
  /** 損切幅（%） */
  stopLoss: number;
  /** 最大保有時間（分） */
  maxHoldingMinutes: number;
  /** 初期資金 */
  initialCapital: number;
  /** ロット数 */
  lotSize: number;
  /** エントリー確率（各キャンドルでエントリーする確率） */
  entryProbability?: number;
  /** 比較対象の戦略結果（オプション） */
  actualStrategy?: BacktestResultSummary;
}

// モンテカルロ結果
export interface MonteCarloResult {
  /** 実行回数 */
  iterations: number;
  /** 各シミュレーションの結果 */
  simulations: SimulationResult[];
  /** 統計サマリー */
  statistics: MonteCarloStatistics;
  /** 比較結果（実際の戦略との比較） */
  comparison?: StrategyComparison;
}

// 個別シミュレーション結果（軽量版）
export interface SimulationResult {
  /** シミュレーションID */
  id: number;
  /** 勝率 */
  winRate: number;
  /** プロフィットファクター */
  profitFactor: number;
  /** 最大ドローダウン率 */
  maxDrawdownRate: number;
  /** 純損益率 */
  netProfitRate: number;
  /** トレード数 */
  totalTrades: number;
}

// モンテカルロ統計
export interface MonteCarloStatistics {
  /** 勝率の統計 */
  winRate: DistributionStats;
  /** プロフィットファクターの統計 */
  profitFactor: DistributionStats;
  /** 最大ドローダウン率の統計 */
  maxDrawdownRate: DistributionStats;
  /** 純損益率の統計 */
  netProfitRate: DistributionStats;
}

// 分布統計
export interface DistributionStats {
  /** 平均 */
  mean: number;
  /** 中央値 */
  median: number;
  /** 標準偏差 */
  stdDev: number;
  /** 最小値 */
  min: number;
  /** 最大値 */
  max: number;
  /** パーセンタイル */
  percentiles: {
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  };
  /** ヒストグラムデータ */
  histogram: HistogramBin[];
}

// ヒストグラムビン
export interface HistogramBin {
  /** ビンの下限 */
  min: number;
  /** ビンの上限 */
  max: number;
  /** 頻度 */
  count: number;
  /** 割合 */
  percentage: number;
}

// 戦略比較結果
export interface StrategyComparison {
  /** 勝率のパーセンタイル（実際の戦略がランダムより何%上か） */
  winRatePercentile: number;
  /** プロフィットファクターのパーセンタイル */
  profitFactorPercentile: number;
  /** 最大ドローダウンのパーセンタイル（低い方が良い） */
  maxDrawdownPercentile: number;
  /** 純損益率のパーセンタイル */
  netProfitRatePercentile: number;
  /** 総合評価 */
  overallAssessment: 'excellent' | 'good' | 'average' | 'poor' | 'very_poor';
  /** 評価コメント */
  comment: string;
}

/**
 * モンテカルロシミュレーションサービスクラス
 */
export class MonteCarloService {
  private readonly ohlcvRepository: OHLCVRepository;
  
  constructor(ohlcvRepository?: OHLCVRepository) {
    this.ohlcvRepository = ohlcvRepository || new OHLCVRepository();
  }
  
  /**
   * モンテカルロシミュレーションを実行
   */
  async runSimulation(params: MonteCarloParams): Promise<MonteCarloResult> {
    console.log(`[MonteCarloService] シミュレーション開始: ${params.iterations}回`);
    
    // OHLCVデータを取得（findManyAsOHLCVData を使用）
    const ohlcvData: OHLCVData[] = await this.ohlcvRepository.findManyAsOHLCVData({
      symbol: params.symbol,
      timeframe: params.timeframe,
      startTime: params.startDate,
      endTime: params.endDate,
    });
    
    if (ohlcvData.length < 10) {
      throw new Error(`データが不足しています: ${ohlcvData.length}本`);
    }
    
    console.log(`[MonteCarloService] OHLCVデータ取得: ${ohlcvData.length}本`);
    
    // シミュレーション実行
    const simulations: SimulationResult[] = [];
    const entryProbability = params.entryProbability || 0.05; // デフォルト5%
    
    for (let i = 0; i < params.iterations; i++) {
      const result = this.runSingleSimulation(
        ohlcvData,
        params,
        entryProbability,
        i
      );
      simulations.push(result);
      
      // 進捗ログ（100回ごと）
      if ((i + 1) % 100 === 0) {
        console.log(`[MonteCarloService] 進捗: ${i + 1}/${params.iterations}`);
      }
    }
    
    // 統計計算
    const statistics = this.calculateStatistics(simulations);
    
    // 比較結果（実際の戦略が提供されている場合）
    let comparison: StrategyComparison | undefined;
    if (params.actualStrategy) {
      comparison = this.compareWithActual(simulations, params.actualStrategy);
    }
    
    console.log(`[MonteCarloService] シミュレーション完了`);
    
    return {
      iterations: params.iterations,
      simulations,
      statistics,
      comparison,
    };
  }
  
  /**
   * 単一シミュレーションを実行（ランダムエントリー）
   */
  private runSingleSimulation(
    ohlcvData: OHLCVData[],
    params: MonteCarloParams,
    entryProbability: number,
    simulationId: number
  ): SimulationResult {
    const trades: BacktestTradeEvent[] = [];
    let inPosition = false;
    let entryCandle: OHLCVData | null = null;
    let entryIndex = 0;
    let side: TradeSide = 'buy';
    
    for (let i = 0; i < ohlcvData.length; i++) {
      const candle = ohlcvData[i];
      
      if (!inPosition) {
        // ランダムにエントリーするかどうか決定
        if (Math.random() < entryProbability) {
          inPosition = true;
          entryCandle = candle;
          entryIndex = i;
          // ランダムに売買方向を決定
          side = Math.random() < 0.5 ? 'buy' : 'sell';
        }
      } else if (entryCandle) {
        // ポジション保有中 - エグジット条件をチェック
        const entryPrice = entryCandle.close;
        const currentPrice = candle.close;
        const holdingMinutes = (new Date(candle.timestamp).getTime() - new Date(entryCandle.timestamp).getTime()) / 60000;
        
        // 損益率を計算
        const pnlPercent = side === 'buy'
          ? ((currentPrice - entryPrice) / entryPrice) * 100
          : ((entryPrice - currentPrice) / entryPrice) * 100;
        
        let exitReason: 'take_profit' | 'stop_loss' | 'timeout' | null = null;
        
        // 利確
        if (pnlPercent >= params.takeProfit) {
          exitReason = 'take_profit';
        }
        // 損切り
        else if (pnlPercent <= -params.stopLoss) {
          exitReason = 'stop_loss';
        }
        // タイムアウト
        else if (holdingMinutes >= params.maxHoldingMinutes) {
          exitReason = 'timeout';
        }
        
        if (exitReason) {
          // トレード記録
          const pnl = (pnlPercent / 100) * params.initialCapital;
          trades.push({
            eventId: uuidv4(),
            entryTime: entryCandle.timestamp instanceof Date 
              ? entryCandle.timestamp.toISOString() 
              : String(entryCandle.timestamp),
            entryPrice,
            exitTime: candle.timestamp instanceof Date 
              ? candle.timestamp.toISOString() 
              : String(candle.timestamp),
            exitPrice: currentPrice,
            side,
            lotSize: params.lotSize,
            pnl,
            pnlPercent,
            exitReason,
          });
          
          inPosition = false;
          entryCandle = null;
        }
      }
    }
    
    // サマリー計算
    const summary = calculateSummary(trades, params.initialCapital);
    
    return {
      id: simulationId,
      winRate: summary.winRate,
      profitFactor: summary.profitFactor === Infinity ? 10 : summary.profitFactor,
      maxDrawdownRate: summary.maxDrawdownRate,
      netProfitRate: summary.netProfitRate,
      totalTrades: summary.totalTrades,
    };
  }
  
  /**
   * 統計を計算
   */
  private calculateStatistics(simulations: SimulationResult[]): MonteCarloStatistics {
    return {
      winRate: this.calculateDistribution(simulations.map(s => s.winRate)),
      profitFactor: this.calculateDistribution(simulations.map(s => s.profitFactor)),
      maxDrawdownRate: this.calculateDistribution(simulations.map(s => s.maxDrawdownRate)),
      netProfitRate: this.calculateDistribution(simulations.map(s => s.netProfitRate)),
    };
  }
  
  /**
   * 分布統計を計算
   */
  private calculateDistribution(values: number[]): DistributionStats {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    
    // 基本統計
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);
    
    // パーセンタイル
    const getPercentile = (p: number): number => {
      const index = Math.floor((p / 100) * (n - 1));
      return sorted[index];
    };
    
    // ヒストグラム作成（10ビン）
    const min = sorted[0];
    const max = sorted[n - 1];
    const binWidth = (max - min) / 10 || 0.1;
    const histogram: HistogramBin[] = [];
    
    for (let i = 0; i < 10; i++) {
      const binMin = min + binWidth * i;
      const binMax = min + binWidth * (i + 1);
      const count = values.filter(v => v >= binMin && (i === 9 ? v <= binMax : v < binMax)).length;
      histogram.push({
        min: binMin,
        max: binMax,
        count,
        percentage: (count / n) * 100,
      });
    }
    
    return {
      mean,
      median: sorted[Math.floor(n / 2)],
      stdDev,
      min: sorted[0],
      max: sorted[n - 1],
      percentiles: {
        p5: getPercentile(5),
        p25: getPercentile(25),
        p50: getPercentile(50),
        p75: getPercentile(75),
        p95: getPercentile(95),
      },
      histogram,
    };
  }
  
  /**
   * 実際の戦略と比較
   */
  private compareWithActual(
    simulations: SimulationResult[],
    actual: BacktestResultSummary
  ): StrategyComparison {
    // 各指標のパーセンタイルを計算
    const winRatePercentile = this.getPercentileRank(
      simulations.map(s => s.winRate),
      actual.winRate
    );
    const profitFactorPercentile = this.getPercentileRank(
      simulations.map(s => s.profitFactor),
      actual.profitFactor
    );
    const maxDrawdownPercentile = this.getPercentileRank(
      simulations.map(s => s.maxDrawdownRate),
      actual.maxDrawdownRate,
      true // 低いほうが良い
    );
    const netProfitRatePercentile = this.getPercentileRank(
      simulations.map(s => s.netProfitRate),
      actual.netProfitRate
    );
    
    // 総合評価
    const avgPercentile = (winRatePercentile + profitFactorPercentile + (100 - maxDrawdownPercentile) + netProfitRatePercentile) / 4;
    
    let overallAssessment: StrategyComparison['overallAssessment'];
    let comment: string;
    
    if (avgPercentile >= 90) {
      overallAssessment = 'excellent';
      comment = '戦略はランダムエントリーを大幅に上回っています。統計的に有意な優位性があると考えられます。';
    } else if (avgPercentile >= 75) {
      overallAssessment = 'good';
      comment = '戦略はランダムエントリーより良好なパフォーマンスを示しています。優位性がある可能性が高いです。';
    } else if (avgPercentile >= 50) {
      overallAssessment = 'average';
      comment = '戦略はランダムエントリーと同程度のパフォーマンスです。優位性は不明確です。';
    } else if (avgPercentile >= 25) {
      overallAssessment = 'poor';
      comment = '戦略はランダムエントリーを下回っています。パラメータの見直しを検討してください。';
    } else {
      overallAssessment = 'very_poor';
      comment = '戦略はランダムエントリーを大幅に下回っています。戦略の根本的な見直しが必要です。';
    }
    
    return {
      winRatePercentile,
      profitFactorPercentile,
      maxDrawdownPercentile,
      netProfitRatePercentile,
      overallAssessment,
      comment,
    };
  }
  
  /**
   * パーセンタイル順位を計算
   * 
   * 「実際の戦略がランダムシミュレーション結果のうち何%を上回っているか」を返す
   * 例: 戦略の勝率が48.5%で、100回のシミュレーションのうち95回が勝率48.5%未満なら、
   *     戦略は上位5%（パーセンタイル95）に位置する
   */
  private getPercentileRank(
    values: number[],
    target: number,
    lowerIsBetter = false
  ): number {
    // targetより劣る値の数をカウント
    // 通常: targetより低い値の割合 = target以下の順位パーセンタイル
    // lowerIsBetter: targetより高い値の割合 = targetが低いほど良い順位
    const count = values.filter(v => lowerIsBetter ? v > target : v < target).length;
    return (count / values.length) * 100;
  }
}

// シングルトンエクスポート
export const monteCarloService = new MonteCarloService();
