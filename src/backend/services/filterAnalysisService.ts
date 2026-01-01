/**
 * フィルター分析サービス
 * 
 * 目的:
 * - バックテスト結果から勝ち/負けトレードのインジケーター傾向を分析
 * - 有効なフィルター候補を自動提案
 * - 複数フィルター（最大5つ）を追加した場合の効果をシミュレート
 */

import { rsi, sma, ema, macd, bb } from 'indicatorts';
import { BacktestTradeEvent, TradeSide } from './backtestCalculations';
import { OHLCV, BacktestTimeframe } from './strategyBacktestService';

// ============================================
// 型定義
// ============================================

/** 分析対象インジケーター */
export type AnalysisIndicator = 
  | 'SMA_20' 
  | 'SMA_50' 
  | 'SMA_200'
  | 'EMA_20'
  | 'EMA_50'
  | 'RSI_14'
  | 'MACD_HIST'
  | 'BB_UPPER'
  | 'BB_LOWER'
  | 'BB_POSITION'; // 価格がBB内のどの位置にあるか（0〜1）

/** インジケーター分析結果 */
export interface IndicatorAnalysis {
  indicator: AnalysisIndicator;
  displayName: string;
  /** 勝ちトレード時の平均値 */
  winAverage: number;
  /** 負けトレード時の平均値 */
  loseAverage: number;
  /** 差（winAverage - loseAverage） */
  difference: number;
  /** 差の絶対値が大きいほど有効なフィルター候補 */
  significanceScore: number;
  /** 推奨フィルター条件 */
  suggestedCondition: string;
  /** フィルター適用時の予測改善率（%） */
  estimatedImprovement: number;
}

/** フィルター分析リクエスト */
export interface FilterAnalysisRequest {
  trades: BacktestTradeEvent[];
  ohlcvData: OHLCV[];
  timeframe: BacktestTimeframe;
}

/** フィルター分析結果 */
export interface FilterAnalysisResult {
  /** 分析したトレード数 */
  totalTrades: number;
  winTrades: number;
  loseTrades: number;
  /** 各インジケーターの分析結果（有効度順） */
  indicators: IndicatorAnalysis[];
  /** 推奨フィルター組み合わせ */
  recommendedFilters: FilterSuggestion[];
}

/** フィルター提案 */
export interface FilterSuggestion {
  filters: AnalysisIndicator[];
  displayName: string;
  estimatedWinRate: number;
  estimatedPF: number;
  estimatedTradeCount: number;
}

/** フィルター検証リクエスト */
export interface FilterVerifyRequest {
  trades: BacktestTradeEvent[];
  ohlcvData: OHLCV[];
  timeframe: BacktestTimeframe;
  /** 適用するフィルター（最大5つ） */
  filters: FilterCondition[];
  initialCapital: number;
}

/** フィルター条件 */
export interface FilterCondition {
  indicator: AnalysisIndicator;
  operator: '<' | '<=' | '>' | '>=' | '=';
  value: number;
}

/** フィルター検証結果 */
export interface FilterVerifyResult {
  /** フィルター適用前 */
  before: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    netProfit: number;
  };
  /** フィルター適用後 */
  after: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    netProfit: number;
    filteredOutTrades: number;
  };
  /** 改善効果 */
  improvement: {
    winRateChange: number;
    pfChange: number;
    tradeReduction: number;
  };
}

// ============================================
// インジケーター計算
// ============================================

/**
 * 全プリセットインジケーターを計算
 */
function calculateAllIndicators(data: OHLCV[]): Map<AnalysisIndicator, number[]> {
  const closes = data.map(d => d.close);
  const highs = data.map(d => d.high);
  const lows = data.map(d => d.low);
  
  const result = new Map<AnalysisIndicator, number[]>();
  
  // SMA
  result.set('SMA_20', sma(closes, { period: 20 }));
  result.set('SMA_50', sma(closes, { period: 50 }));
  result.set('SMA_200', sma(closes, { period: 200 }));
  
  // EMA
  result.set('EMA_20', ema(closes, { period: 20 }));
  result.set('EMA_50', ema(closes, { period: 50 }));
  
  // RSI
  result.set('RSI_14', rsi(closes, { period: 14 }));
  
  // MACD
  const macdResult = macd(closes, { fast: 12, slow: 26, signal: 9 });
  // histogram = macdLine - signalLine（手動計算）
  const macdHist = macdResult.macdLine.map((m, i) => m - (macdResult.signalLine[i] || 0));
  result.set('MACD_HIST', macdHist);
  
  // ボリンジャーバンド（multiplierはサポートされていないのでperiodのみ）
  const bbResult = bb(closes, { period: 20 });
  result.set('BB_UPPER', bbResult.upper);
  result.set('BB_LOWER', bbResult.lower);
  
  // BB Position: 価格がBB内のどの位置にあるか（0=下限、1=上限）
  const bbPosition: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const upper = bbResult.upper[i];
    const lower = bbResult.lower[i];
    if (upper && lower && upper !== lower) {
      bbPosition.push((closes[i] - lower) / (upper - lower));
    } else {
      bbPosition.push(0.5);
    }
  }
  result.set('BB_POSITION', bbPosition);
  
  return result;
}

/**
 * インジケーター表示名を取得
 */
function getDisplayName(indicator: AnalysisIndicator): string {
  const names: Record<AnalysisIndicator, string> = {
    'SMA_20': 'SMA(20)',
    'SMA_50': 'SMA(50)',
    'SMA_200': 'SMA(200)',
    'EMA_20': 'EMA(20)',
    'EMA_50': 'EMA(50)',
    'RSI_14': 'RSI(14)',
    'MACD_HIST': 'MACDヒストグラム',
    'BB_UPPER': 'BB上限',
    'BB_LOWER': 'BB下限',
    'BB_POSITION': 'BB位置(0-1)',
  };
  return names[indicator];
}

// ============================================
// 分析関数
// ============================================

/**
 * フィルター分析を実行
 * 
 * バックテスト結果から勝ち/負けトレードのインジケーター傾向を分析し、
 * 有効なフィルター候補を提案
 */
export function analyzeFilters(request: FilterAnalysisRequest): FilterAnalysisResult {
  const { trades, ohlcvData } = request;
  
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      winTrades: 0,
      loseTrades: 0,
      indicators: [],
      recommendedFilters: [],
    };
  }
  
  // インジケーター計算
  const indicators = calculateAllIndicators(ohlcvData);
  
  // タイムスタンプ→インデックスマッピング作成
  const timeToIndex = new Map<string, number>();
  ohlcvData.forEach((d, i) => {
    timeToIndex.set(d.timestamp.toISOString(), i);
  });
  
  // 勝ち/負けトレードを分類
  const winTrades = trades.filter(t => t.pnl > 0);
  const loseTrades = trades.filter(t => t.pnl <= 0);
  
  // 各インジケーターについて勝ち/負けの平均値を計算
  const analysisResults: IndicatorAnalysis[] = [];
  
  for (const [indicatorKey, values] of indicators) {
    // 勝ちトレード時のインジケーター値を収集
    const winValues: number[] = [];
    for (const trade of winTrades) {
      const index = timeToIndex.get(trade.entryTime);
      if (index !== undefined && values[index] !== undefined && !isNaN(values[index])) {
        winValues.push(values[index]);
      }
    }
    
    // 負けトレード時のインジケーター値を収集
    const loseValues: number[] = [];
    for (const trade of loseTrades) {
      const index = timeToIndex.get(trade.entryTime);
      if (index !== undefined && values[index] !== undefined && !isNaN(values[index])) {
        loseValues.push(values[index]);
      }
    }
    
    if (winValues.length === 0 || loseValues.length === 0) continue;
    
    const winAverage = winValues.reduce((a, b) => a + b, 0) / winValues.length;
    const loseAverage = loseValues.reduce((a, b) => a + b, 0) / loseValues.length;
    const difference = winAverage - loseAverage;
    
    // 正規化して有効度スコアを計算
    const maxVal = Math.max(...values.filter(v => !isNaN(v)));
    const minVal = Math.min(...values.filter(v => !isNaN(v)));
    const range = maxVal - minVal || 1;
    const significanceScore = Math.abs(difference) / range * 100;
    
    // 推奨条件を生成
    let suggestedCondition = '';
    let estimatedImprovement = 0;
    
    if (difference > 0) {
      // 勝ちの方が値が高い → 高い時にエントリー
      suggestedCondition = `${getDisplayName(indicatorKey)} > ${(winAverage * 0.8 + loseAverage * 0.2).toFixed(2)}`;
      estimatedImprovement = significanceScore * 0.5;
    } else {
      // 勝ちの方が値が低い → 低い時にエントリー
      suggestedCondition = `${getDisplayName(indicatorKey)} < ${(winAverage * 0.2 + loseAverage * 0.8).toFixed(2)}`;
      estimatedImprovement = significanceScore * 0.5;
    }
    
    analysisResults.push({
      indicator: indicatorKey,
      displayName: getDisplayName(indicatorKey),
      winAverage,
      loseAverage,
      difference,
      significanceScore,
      suggestedCondition,
      estimatedImprovement: Math.min(estimatedImprovement, 30), // 最大30%改善
    });
  }
  
  // 有効度スコア順にソート
  analysisResults.sort((a, b) => b.significanceScore - a.significanceScore);
  
  // 推奨フィルター組み合わせを生成（上位3つの組み合わせ）
  const recommendedFilters: FilterSuggestion[] = [];
  
  if (analysisResults.length >= 1) {
    // トップ1
    recommendedFilters.push({
      filters: [analysisResults[0].indicator],
      displayName: analysisResults[0].suggestedCondition,
      estimatedWinRate: Math.min((winTrades.length / trades.length) * 100 + analysisResults[0].estimatedImprovement * 0.5, 70),
      estimatedPF: 1.0 + analysisResults[0].estimatedImprovement * 0.02,
      estimatedTradeCount: Math.floor(trades.length * 0.7),
    });
  }
  
  if (analysisResults.length >= 2) {
    // トップ2組み合わせ
    const combined = analysisResults.slice(0, 2);
    recommendedFilters.push({
      filters: combined.map(a => a.indicator),
      displayName: combined.map(a => a.suggestedCondition).join(' AND '),
      estimatedWinRate: Math.min((winTrades.length / trades.length) * 100 + (combined[0].estimatedImprovement + combined[1].estimatedImprovement) * 0.4, 75),
      estimatedPF: 1.0 + (combined[0].estimatedImprovement + combined[1].estimatedImprovement) * 0.015,
      estimatedTradeCount: Math.floor(trades.length * 0.5),
    });
  }
  
  if (analysisResults.length >= 3) {
    // トップ3組み合わせ
    const combined = analysisResults.slice(0, 3);
    recommendedFilters.push({
      filters: combined.map(a => a.indicator),
      displayName: combined.map(a => a.suggestedCondition).join(' AND '),
      estimatedWinRate: Math.min((winTrades.length / trades.length) * 100 + combined.reduce((sum, a) => sum + a.estimatedImprovement, 0) * 0.3, 80),
      estimatedPF: 1.0 + combined.reduce((sum, a) => sum + a.estimatedImprovement, 0) * 0.012,
      estimatedTradeCount: Math.floor(trades.length * 0.35),
    });
  }
  
  return {
    totalTrades: trades.length,
    winTrades: winTrades.length,
    loseTrades: loseTrades.length,
    indicators: analysisResults,
    recommendedFilters,
  };
}

/**
 * フィルター適用効果を検証
 * 
 * 選択したフィルター（最大5つ）を適用した場合の改善効果をシミュレート
 */
export function verifyFilters(request: FilterVerifyRequest): FilterVerifyResult {
  const { trades, ohlcvData, filters, initialCapital } = request;
  
  if (filters.length === 0 || filters.length > 5) {
    throw new Error('フィルターは1〜5個まで選択してください');
  }
  
  // インジケーター計算
  const indicators = calculateAllIndicators(ohlcvData);
  
  // タイムスタンプ→インデックスマッピング
  const timeToIndex = new Map<string, number>();
  ohlcvData.forEach((d, i) => {
    timeToIndex.set(d.timestamp.toISOString(), i);
  });
  
  // フィルター適用前の統計
  const beforeWins = trades.filter(t => t.pnl > 0).length;
  const beforeLosses = trades.filter(t => t.pnl <= 0).length;
  const beforeWinRate = trades.length > 0 ? beforeWins / trades.length : 0;
  const beforeGrossProfit = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const beforeGrossLoss = Math.abs(trades.filter(t => t.pnl <= 0).reduce((sum, t) => sum + t.pnl, 0));
  const beforePF = beforeGrossLoss > 0 ? beforeGrossProfit / beforeGrossLoss : beforeGrossProfit > 0 ? Infinity : 0;
  const beforeNetProfit = beforeGrossProfit - beforeGrossLoss;
  
  // フィルター適用
  const filteredTrades = trades.filter(trade => {
    const index = timeToIndex.get(trade.entryTime);
    if (index === undefined) return false;
    
    // すべてのフィルター条件を満たすかチェック
    for (const filter of filters) {
      const values = indicators.get(filter.indicator);
      if (!values || values[index] === undefined || isNaN(values[index])) {
        return false;
      }
      
      const value = values[index];
      switch (filter.operator) {
        case '<': if (!(value < filter.value)) return false; break;
        case '<=': if (!(value <= filter.value)) return false; break;
        case '>': if (!(value > filter.value)) return false; break;
        case '>=': if (!(value >= filter.value)) return false; break;
        case '=': if (!(Math.abs(value - filter.value) < 0.0001)) return false; break;
      }
    }
    
    return true;
  });
  
  // フィルター適用後の統計
  const afterWins = filteredTrades.filter(t => t.pnl > 0).length;
  const afterLosses = filteredTrades.filter(t => t.pnl <= 0).length;
  const afterWinRate = filteredTrades.length > 0 ? afterWins / filteredTrades.length : 0;
  const afterGrossProfit = filteredTrades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const afterGrossLoss = Math.abs(filteredTrades.filter(t => t.pnl <= 0).reduce((sum, t) => sum + t.pnl, 0));
  const afterPF = afterGrossLoss > 0 ? afterGrossProfit / afterGrossLoss : afterGrossProfit > 0 ? Infinity : 0;
  const afterNetProfit = afterGrossProfit - afterGrossLoss;
  
  return {
    before: {
      totalTrades: trades.length,
      winRate: beforeWinRate,
      profitFactor: beforePF,
      netProfit: beforeNetProfit,
    },
    after: {
      totalTrades: filteredTrades.length,
      winRate: afterWinRate,
      profitFactor: afterPF,
      netProfit: afterNetProfit,
      filteredOutTrades: trades.length - filteredTrades.length,
    },
    improvement: {
      winRateChange: afterWinRate - beforeWinRate,
      pfChange: afterPF - beforePF,
      tradeReduction: (trades.length - filteredTrades.length) / trades.length,
    },
  };
}

/**
 * 利用可能なフィルターインジケーター一覧を取得
 */
export function getAvailableFilterIndicators(): { id: AnalysisIndicator; name: string; description: string }[] {
  return [
    { id: 'SMA_20', name: 'SMA(20)', description: '20期間単純移動平均線' },
    { id: 'SMA_50', name: 'SMA(50)', description: '50期間単純移動平均線（中期トレンド）' },
    { id: 'SMA_200', name: 'SMA(200)', description: '200期間単純移動平均線（長期トレンド）' },
    { id: 'EMA_20', name: 'EMA(20)', description: '20期間指数移動平均線' },
    { id: 'EMA_50', name: 'EMA(50)', description: '50期間指数移動平均線' },
    { id: 'RSI_14', name: 'RSI(14)', description: '14期間RSI（0-100）' },
    { id: 'MACD_HIST', name: 'MACDヒストグラム', description: 'MACD - シグナルライン' },
    { id: 'BB_UPPER', name: 'BB上限', description: 'ボリンジャーバンド上限' },
    { id: 'BB_LOWER', name: 'BB下限', description: 'ボリンジャーバンド下限' },
    { id: 'BB_POSITION', name: 'BB位置', description: '価格のBB内位置（0=下限、1=上限）' },
  ];
}
