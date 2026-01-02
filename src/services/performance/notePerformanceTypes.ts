/**
 * ノートパフォーマンス関連の型定義
 * 
 * フェーズ9「ノートの自己評価」で使用する型を定義
 * EvaluationLog から集計したノートの有効性分析データ
 * 
 * @see src/backend/repositories/evaluationLogRepository.ts
 */

/**
 * 相場状況の分類
 * EvaluationLog の diagnostics や marketSnapshot から判定
 */
export type MarketCondition = 'trending_up' | 'trending_down' | 'ranging' | 'volatile';

/**
 * 時間帯別パフォーマンス
 * UTC 時間（0-23）で集計
 */
export interface HourlyPerformance {
  /** 時間（0-23、UTC） */
  hour: number;
  /** その時間帯での発火率 */
  triggerRate: number;
  /** その時間帯での平均類似度 */
  avgSimilarity: number;
  /** 評価回数（この時間帯での） */
  evaluationCount: number;
}

/**
 * 相場状況別パフォーマンス
 */
export interface ConditionPerformance {
  /** 相場状況 */
  condition: MarketCondition;
  /** その状況での発火率 */
  triggerRate: number;
  /** その状況での平均類似度 */
  avgSimilarity: number;
  /** 評価回数（この状況での） */
  evaluationCount: number;
}

/**
 * 弱いパターン（このノートが機能しない状況）
 */
export interface WeakPattern {
  /** パターンの説明（例: "ボラティリティ急上昇時"） */
  description: string;
  /** 発生回数 */
  occurrences: number;
  /** このパターンでの平均類似度 */
  avgSimilarity: number;
  /** 詳細情報（検出に使用した条件等） */
  details?: Record<string, unknown>;
}

/**
 * ノートパフォーマンスレポート
 * 
 * フェーズ9 の主要出力
 * EvaluationLog の集計結果を構造化したもの
 */
export interface NotePerformanceReport {
  /** ノート ID */
  noteId: string;
  /** シンボル */
  symbol: string;
  
  // === 基本統計 ===
  /** 総評価回数 */
  totalEvaluations: number;
  /** 発火回数（triggered=true） */
  triggeredCount: number;
  /** 発火率（triggeredCount / totalEvaluations） */
  triggerRate: number;
  /** 平均類似度 */
  avgSimilarity: number;
  /** 最高類似度 */
  maxSimilarity: number;
  /** 最低類似度 */
  minSimilarity: number;
  
  // === 時間帯別パフォーマンス ===
  /** 時間帯別（0-23時、UTC） */
  performanceByHour: HourlyPerformance[];
  
  // === 相場状況別パフォーマンス ===
  /** 相場状況別 */
  performanceByMarketCondition: ConditionPerformance[];
  
  // === 弱いパターン ===
  /** このノートが機能しない状況のパターン */
  weakPatterns: WeakPattern[];
  
  // === メタ情報 ===
  /** 最初の評価日時 */
  firstEvaluatedAt: Date | null;
  /** 最後の評価日時 */
  lastEvaluatedAt: Date | null;
  /** レポート生成日時 */
  generatedAt: Date;
}

/**
 * ノートランキングエントリ
 */
export interface NoteRankingEntry {
  /** ノート ID */
  noteId: string;
  /** シンボル */
  symbol: string;
  /** 発火率 */
  triggerRate: number;
  /** 総評価回数 */
  totalEvaluations: number;
  /** 平均類似度 */
  avgSimilarity: number;
  /** 総合スコア（0-100） */
  overallScore: number;
  /** 順位 */
  rank: number;
}

/**
 * パフォーマンスレポート生成オプション
 */
export interface PerformanceReportOptions {
  /** 集計期間の開始（指定しない場合は全期間） */
  from?: Date;
  /** 集計期間の終了（指定しない場合は現在） */
  to?: Date;
  /** 弱いパターン検出の閾値（これ以下の類似度をウィークとみなす） */
  weakThreshold?: number;
  /** 時間足で絞り込み */
  timeframe?: string;
}

/**
 * 相場状況判定の入力
 * MarketSnapshot または EvaluationLog.diagnostics から取得
 */
export interface MarketConditionInput {
  /** RSI 値（0-100） */
  rsi?: number;
  /** トレンド方向 */
  trend?: 'bullish' | 'bearish' | 'neutral';
  /** ATR（ボラティリティ指標） */
  atr?: number;
  /** ATR の移動平均（ボラティリティ比較用） */
  atrAvg?: number;
  /** 価格変動率（%） */
  priceChangePercent?: number;
}
