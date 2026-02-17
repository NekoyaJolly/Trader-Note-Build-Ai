/**
 * ストラテジー関連の型定義
 * 
 * 目的:
 * - インジケーター条件を組み合わせた売買戦略の定義
 * - バックテスト・アラート用のストラテジー管理
 * 
 * Phase A: AND/OR/NOT 論理演算子
 * Phase B: IF-THEN, SEQUENCE 追加、バックテスト機能
 */

import type { IndicatorId, IndicatorParams } from './indicator';

// ============================================
// 対応シンボル
// ============================================

/**
 * 対応通貨ペア（Phase A 初期対応）
 */
export const SUPPORTED_SYMBOLS = [
  'USDJPY',
  'EURJPY',
  'GBPJPY',
  'AUDJPY',
  'EURUSD',
  'GBPUSD',
  'AUDUSD',
  'XAUUSD', // GOLD
] as const;

export type SupportedSymbol = typeof SUPPORTED_SYMBOLS[number];

/**
 * シンボル表示情報
 */
export const SYMBOL_INFO: Record<SupportedSymbol, { label: string; category: string }> = {
  USDJPY: { label: 'USD/JPY', category: 'JPYペア' },
  EURJPY: { label: 'EUR/JPY', category: 'JPYペア' },
  GBPJPY: { label: 'GBP/JPY', category: 'JPYペア' },
  AUDJPY: { label: 'AUD/JPY', category: 'JPYペア' },
  EURUSD: { label: 'EUR/USD', category: 'USDペア' },
  GBPUSD: { label: 'GBP/USD', category: 'USDペア' },
  AUDUSD: { label: 'AUD/USD', category: 'USDペア' },
  XAUUSD: { label: 'XAU/USD (GOLD)', category: '貴金属' },
};

// ============================================
// 論理演算子・比較演算子
// ============================================

/**
 * 論理演算子
 * Phase A: AND, OR, NOT
 * Phase B: IF_THEN, SEQUENCE 追加
 */
export type LogicalOperator = 'AND' | 'OR' | 'NOT' | 'IF_THEN' | 'SEQUENCE';

/**
 * 比較演算子
 */
export type ComparisonOperator = 
  | '<'           // より小さい
  | '<='          // 以下
  | '='           // 等しい
  | '>='          // 以上
  | '>'           // より大きい
  | 'cross_above' // 上抜け（クロスアップ）
  | 'cross_below' // 下抜け（クロスダウン）
  | 'GC'          // ゴールデンクロス（上抜けの別名）
  | 'DC'          // デッドクロス（下抜けの別名）
  | 'Touch'       // タッチ（接触/近接） - 旧形式（後方互換）
  | 'touch_close' // 終値タッチ（終値ベースの近接/一致）
  | 'touch_wick'; // ヒゲタッチ（当該バーの high-low の範囲到達）

/**
 * 比較演算子の表示情報
 */
export const COMPARISON_OPERATOR_INFO: Record<ComparisonOperator, { label: string; description: string }> = {
  '<': { label: 'より小さい', description: '左辺が右辺より小さい' },
  '<=': { label: '以下', description: '左辺が右辺以下' },
  '=': { label: '等しい', description: '左辺と右辺が等しい（誤差許容あり）' },
  '>=': { label: '以上', description: '左辺が右辺以上' },
  '>': { label: 'より大きい', description: '左辺が右辺より大きい' },
  'cross_above': { label: '上抜け', description: '前回は下、今回は上（クロスアップ）' },
  'cross_below': { label: '下抜け', description: '前回は上、今回は下（クロスダウン）' },
  GC: { label: 'ゴールデンクロス', description: '上抜け（別名）' },
  DC: { label: 'デッドクロス', description: '下抜け（別名）' },
  Touch: { label: 'タッチ（旧）', description: '旧形式: 近接/接触/反転を含む（後方互換）' },
  touch_close: { label: '終値でタッチ', description: '終値ベースの一致/近接（基本はclose）' },
  touch_wick: { label: 'ヒゲでタッチ', description: '当該バーの high-low に到達（価格が線に触れるイメージ）' },
};

// ============================================
// ローソク足パターン条件（バックテスト強化）
// ============================================

export type CandlePatternId =
  | 'pinbar'
  | 'hammer'
  | 'shooting_star'
  | 'engulfing_bull'
  | 'engulfing_bear'
  | 'doji'
  | 'thrust_bull'
  | 'thrust_bear';

export type PatternOperator = 'is_true' | 'is_false';

export interface PatternCondition {
  conditionId: string;
  type: 'pattern';
  patternId: CandlePatternId;
  operator: PatternOperator;
}

/**
 * 論理演算子の表示情報
 */
export const LOGICAL_OPERATOR_INFO: Record<LogicalOperator, { label: string; description: string }> = {
  AND: { label: 'かつ', description: 'すべての条件を満たす' },
  OR: { label: 'または', description: 'いずれかの条件を満たす' },
  NOT: { label: '〜でない', description: '条件を満たさない' },
  IF_THEN: { label: 'IF→THEN', description: 'IF条件成立後にTHEN条件を評価' },
  SEQUENCE: { label: '順序', description: '条件が順番に成立する' },
};

// ============================================
// インジケーター条件
// ============================================

/**
 * インジケーターのフィールド（出力値）
 * インジケーターごとに異なるフィールドを持つ
 */
export type IndicatorField = 
  | 'value'     // 単一値（RSI, ATR など）
  | 'macd'      // MACD線
  | 'signal'    // シグナル線
  | 'histogram' // ヒストグラム
  | 'upper'     // 上バンド（BB, KC）
  | 'middle'    // 中央線
  | 'lower'     // 下バンド
  | 'k'         // %K（ストキャスティクス）
  | 'd'         // %D
  | 'tenkan'    // 転換線（一目均衡表）
  | 'kijun'     // 基準線
  | 'senkouA'   // 先行スパンA
  | 'senkouB'   // 先行スパンB
  | 'chikou';   // 遅行スパン

/**
 * インジケーターごとの利用可能フィールド
 */
export const INDICATOR_FIELDS: Record<IndicatorId, IndicatorField[]> = {
  rsi: ['value'],
  sma: ['value'],
  ema: ['value'],
  macd: ['macd', 'signal', 'histogram'],
  bb: ['upper', 'middle', 'lower'],
  atr: ['value'],
  stochastic: ['k', 'd'],
  obv: ['value'],
  vwap: ['value'],
  williamsR: ['value'],
  cci: ['value'],
  aroon: ['value'], // aroonUp, aroonDown は簡略化
  roc: ['value'],
  mfi: ['value'],
  cmf: ['value'],
  dema: ['value'],
  tema: ['value'],
  kc: ['upper', 'middle', 'lower'],
  psar: ['value'],
  ichimoku: ['tenkan', 'kijun', 'senkouA', 'senkouB', 'chikou'],
};

/**
 * フィールド表示名
 */
export const FIELD_LABELS: Record<IndicatorField, string> = {
  value: '値',
  macd: 'MACD線',
  signal: 'シグナル線',
  histogram: 'ヒストグラム',
  upper: '上バンド',
  middle: '中央線',
  lower: '下バンド',
  k: '%K',
  d: '%D',
  tenkan: '転換線',
  kijun: '基準線',
  senkouA: '先行スパンA',
  senkouB: '先行スパンB',
  chikou: '遅行スパン',
};

/**
 * 比較対象の種類
 */
export type CompareTargetType = 'fixed' | 'indicator' | 'price';

/**
 * 比較対象（固定値）
 */
export interface FixedValueTarget {
  type: 'fixed';
  value: number;
}

/**
 * 比較対象（別のインジケーター）
 */
export interface IndicatorTarget {
  type: 'indicator';
  indicatorId: IndicatorId;
  params: IndicatorParams;
  field: IndicatorField;
}

/**
 * 比較対象（価格）
 */
export interface PriceTarget {
  type: 'price';
  priceType: 'open' | 'high' | 'low' | 'close';
}

/**
 * 比較対象の共用型
 */
export type CompareTarget = FixedValueTarget | IndicatorTarget | PriceTarget;

/**
 * 単一のインジケーター条件
 */
export interface IndicatorCondition {
  /** 条件の一意ID */
  conditionId: string;
  /** 左辺: インジケーターID */
  indicatorId: IndicatorId;
  /** 左辺: インジケーターパラメータ */
  params: IndicatorParams;
  /** 左辺: インジケーターのフィールド */
  field: IndicatorField;
  /** 比較演算子 */
  operator: ComparisonOperator;
  /** 右辺: 比較対象 */
  compareTarget: CompareTarget;
}

// ============================================
// 条件グループ（再帰的構造）
// ============================================

/**
 * 条件グループ（複数条件を論理演算子で結合）
 */
export interface ConditionGroup {
  /** グループの一意ID */
  groupId: string;
  /** 論理演算子 */
  operator: LogicalOperator;
  /** 子要素（条件 or サブグループ） */
  conditions: (IndicatorCondition | PatternCondition | ConditionGroup)[];

  /** SEQUENCE専用: 各ステップ間の最大バー数（未指定なら evaluator 側のデフォルト） */
  maxBarsBetweenSteps?: number;

  /** IF-THEN専用（将来拡張） */
  ifCondition?: ConditionGroup | IndicatorCondition | PatternCondition;
  thenCondition?: ConditionGroup | IndicatorCondition | PatternCondition;
  maxBarsToWait?: number;
}

/**
 * 条件がIndicatorConditionかどうかを判定する型ガード
 */
export function isIndicatorCondition(
  condition: IndicatorCondition | PatternCondition | ConditionGroup
): condition is IndicatorCondition {
  return 'indicatorId' in condition;
}

export function isPatternCondition(
  condition: IndicatorCondition | PatternCondition | ConditionGroup
): condition is PatternCondition {
  return 'type' in condition && (condition as { type?: string }).type === 'pattern';
}

/**
 * 条件がConditionGroupかどうかを判定する型ガード
 */
export function isConditionGroup(
  condition: IndicatorCondition | PatternCondition | ConditionGroup
): condition is ConditionGroup {
  return 'conditions' in condition;
}

// ============================================
// エントリー・イグジット設定
// ============================================

/**
 * エントリータイミング
 */
export type EntryTiming =
  | 'next_open'     // 次足始値（デフォルト）
  | 'current_close'; // 現足終値（現足エントリーの近似）

/**
 * TP/SL の単位
 */
export type ExitUnit = 'percent' | 'pips';

/**
 * イグジット設定
 */
export interface ExitSettings {
  /** 利確（Take Profit） */
  takeProfit: {
    value: number;
    unit: ExitUnit;
  };
  /** 損切（Stop Loss） */
  stopLoss: {
    value: number;
    unit: ExitUnit;
  };
  /** 最大保有時間（分）- オプション */
  maxHoldingMinutes?: number;
}

// ============================================
// ストラテジー本体
// ============================================

/**
 * トレード方向（ストラテジー用）
 * - BOTH は「両建て許容」を意味する（現時点のバックテストは暫定で片側のみ実行）
 */
export type StrategyDirection = 'buy' | 'sell' | 'both';

/**
 * トレード方向（バックテスト/イベント用）
 */
export type TradeSide = 'buy' | 'sell';

/**
 * ストラテジーステータス
 */
export type StrategyStatus = 'draft' | 'active' | 'archived';

/**
 * ストラテジーバージョン（履歴保存用）
 */
export interface StrategyVersion {
  /** バージョンID（APIからの応答） */
  id: string;
  /** バージョン番号（1, 2, 3...） */
  versionNumber: number;
  /** エントリー条件 */
  entryConditions: ConditionGroup;
  /** イグジット設定 */
  exitSettings: ExitSettings;
  /** エントリータイミング */
  entryTiming: EntryTiming;
  /** 作成日時 */
  createdAt: string;
  /** 変更理由メモ（オプション） */
  changeNote?: string | null;
}

/**
 * ストラテジー（メインエンティティ）
 */
export interface Strategy {
  /** ストラテジーID */
  id: string;
  /** ストラテジー名 */
  name: string;
  /** 説明 */
  description?: string;
  /** 対象シンボル */
  symbol: SupportedSymbol;
  /** トレード方向 */
  side: StrategyDirection;
  /** ステータス */
  status: StrategyStatus;
  /** 現在のバージョンID */
  currentVersionId: string;
  /** 現在のバージョン（展開済み） */
  currentVersion: StrategyVersion;
  /** バージョン履歴 */
  versions: StrategyVersion[];
  /** 作成日時 */
  createdAt: string;
  /** 更新日時 */
  updatedAt: string;
  /** タグ */
  tags?: string[];
}

// ============================================
// API リクエスト/レスポンス型
// ============================================

/**
 * ストラテジー作成リクエスト
 */
export interface CreateStrategyRequest {
  name: string;
  description?: string;
  symbol: SupportedSymbol;
  side: StrategyDirection;
  entryConditions: ConditionGroup;
  exitSettings: ExitSettings;
  entryTiming?: EntryTiming;
  tags?: string[];
}

/**
 * ストラテジー更新リクエスト
 */
export interface UpdateStrategyRequest {
  name?: string;
  description?: string;
  symbol?: SupportedSymbol;
  side?: StrategyDirection;
  entryConditions?: ConditionGroup;
  exitSettings?: ExitSettings;
  entryTiming?: EntryTiming;
  status?: StrategyStatus;
  tags?: string[];
  changeNote?: string;
}

/**
 * ストラテジー一覧のサマリー
 */
export interface StrategySummary {
  id: string;
  name: string;
  symbol: SupportedSymbol;
  side: StrategyDirection;
  status: StrategyStatus;
  versionCount: number;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

/**
 * ストラテジー一覧取得パラメータ
 */
export interface FetchStrategiesParams {
  status?: StrategyStatus;
  symbol?: SupportedSymbol;
  limit?: number;
}

// ============================================
// ユーティリティ関数
// ============================================

/**
 * 新しい条件IDを生成
 */
export function generateConditionId(): string {
  return `cond_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 新しいグループIDを生成
 */
export function generateGroupId(): string {
  return `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * デフォルトの単一条件を生成
 */
export function createDefaultCondition(): IndicatorCondition {
  return {
    conditionId: generateConditionId(),
    indicatorId: 'rsi',
    params: { period: 14 },
    field: 'value',
    operator: '<',
    compareTarget: { type: 'fixed', value: 30 },
  };
}

/**
 * デフォルトの条件グループを生成
 */
export function createDefaultConditionGroup(): ConditionGroup {
  return {
    groupId: generateGroupId(),
    operator: 'AND',
    conditions: [createDefaultCondition()],
  };
}

/**
 * デフォルトのイグジット設定を生成
 */
export function createDefaultExitSettings(): ExitSettings {
  return {
    takeProfit: { value: 1.0, unit: 'percent' },
    stopLoss: { value: 0.5, unit: 'percent' },
    maxHoldingMinutes: undefined,
  };
}

// ============================================
// IF-THEN / SEQUENCE 専用型（Phase B）
// ============================================

/**
 * IF-THEN条件グループ
 * IF部が成立した後、指定時間内にTHEN部を評価
 */
export interface IfThenConditionGroup {
  groupId: string;
  operator: 'IF_THEN';
  /** IF部（トリガー条件） */
  ifCondition: ConditionGroup | IndicatorCondition;
  /** THEN部（確認条件） */
  thenCondition: ConditionGroup | IndicatorCondition;
  /** IF成立後、THEN評価を継続する最大バー数 */
  maxBarsToWait: number;
}

/**
 * SEQUENCE条件グループ
 * 条件が順番に成立することを要求
 */
export interface SequenceConditionGroup {
  groupId: string;
  operator: 'SEQUENCE';
  /** 順序付き条件リスト */
  sequence: (ConditionGroup | IndicatorCondition)[];
  /** 各ステップ間の最大バー数 */
  maxBarsBetweenSteps: number;
}

/**
 * 拡張条件グループ（Phase B対応）
 */
export type ExtendedConditionGroup = 
  | ConditionGroup 
  | IfThenConditionGroup 
  | SequenceConditionGroup;

/**
 * IF-THEN条件かどうかを判定する型ガード
 */
export function isIfThenConditionGroup(
  group: ExtendedConditionGroup
): group is IfThenConditionGroup {
  return 'operator' in group && group.operator === 'IF_THEN';
}

/**
 * SEQUENCE条件かどうかを判定する型ガード
 */
export function isSequenceConditionGroup(
  group: ExtendedConditionGroup
): group is SequenceConditionGroup {
  return 'operator' in group && group.operator === 'SEQUENCE';
}

// ============================================
// バックテスト関連型（Phase B）
// ============================================

/**
 * バックテストの時間足
 */
export type BacktestTimeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

/**
 * バックテストステージ
 * Stage1: 15m以上で高速スキャン
 * Stage2: 1mで精密検証
 */
export type BacktestStage = 'stage1' | 'stage2';

/**
 * バックテスト実行リクエスト
 */
export interface BacktestRequest {
  /** 対象ストラテジーID */
  strategyId: string;
  /** バックテスト期間（開始） */
  startDate: string;
  /** バックテスト期間（終了） */
  endDate: string;
  /** Stage1の時間足（15m, 30m, 1h, 4h, 1d） */
  stage1Timeframe: BacktestTimeframe;
  /** Stage2を実行するか（精密検証） */
  runStage2: boolean;
  /** 初期資金 */
  initialCapital: number;
  /** ポジションサイズ（ロット） */
  positionSize: number;
}

/**
 * バックテスト結果サマリー
 */
export interface BacktestResultSummary {
  /** 総トレード数 */
  totalTrades: number;
  /** 勝ちトレード数 */
  winningTrades: number;
  /** 負けトレード数 */
  losingTrades: number;
  /** 勝率 (%) */
  winRate: number;
  /** 純損益 */
  netProfit: number;
  /** 純損益率 (%) */
  netProfitRate: number;
  /** 最大ドローダウン */
  maxDrawdown: number;
  /** 最大ドローダウン率 (%) */
  maxDrawdownRate: number;
  /** プロフィットファクター */
  profitFactor: number;
  /** 平均利益 */
  averageWin: number;
  /** 平均損失 */
  averageLoss: number;
  /** リスクリワード比 */
  riskRewardRatio: number;
  /** 最大連勝 */
  maxConsecutiveWins: number;
  /** 最大連敗 */
  maxConsecutiveLosses: number;
  /** シャープレシオ（年率換算） */
  sharpeRatio?: number;
  /** ソルティノレシオ（下方リスクのみ考慮） */
  sortinoRatio?: number;
  /** t検定によるp値（帰無仮説: 平均リターン = 0） */
  pValue?: number;
  /** 統計的有意性（p < 0.05） */
  isStatisticallySignificant?: boolean;
  /** 信頼度レベル（トレード数ベース） */
  confidenceLevel?: 'low' | 'medium' | 'high';
  /** 停止理由（破産など） */
  stoppedReason?: 'bankruptcy' | 'completed';
  /** 最終資金残高 */
  finalCapital?: number;
}

/**
 * バックテストイベント（個別トレード）
 */
export interface BacktestTradeEvent {
  /** イベントID */
  eventId: string;
  /** エントリー日時 */
  entryTime: string;
  /** エントリー価格 */
  entryPrice: number;
  /** イグジット日時 */
  exitTime: string;
  /** イグジット価格 */
  exitPrice: number;
  /** 売買方向 */
  side: TradeSide;
  /** ポジションサイズ */
  positionSize: number;
  /** 損益 */
  pnl: number;
  /** 損益率 (%) */
  pnlPercent: number;
  /** イグジット理由 */
  exitReason: 'take_profit' | 'stop_loss' | 'timeout' | 'signal';
  /** 条件成立時のインジケーター値 */
  indicatorValues?: Record<string, number>;
}

/**
 * バックテスト実行結果
 */
export interface BacktestResult {
  /** 結果ID */
  id: string;
  /** ストラテジーID */
  strategyId: string;
  /** バージョン番号 */
  versionNumber: number;
  /** 実行日時 */
  executedAt: string;
  /** バックテスト期間（開始） */
  startDate: string;
  /** バックテスト期間（終了） */
  endDate: string;
  /** 使用した時間足 */
  timeframe: BacktestTimeframe;
  /** ステージ */
  stage: BacktestStage;
  /** 結果サマリー */
  summary: BacktestResultSummary;
  /** 個別トレードイベント */
  trades: BacktestTradeEvent[];
  /** 実行ステータス */
  status: 'running' | 'completed' | 'failed';
  /** エラーメッセージ（失敗時） */
  errorMessage?: string;
}

/**
 * バックテスト実行ステータス
 */
export interface BacktestRunStatus {
  /** 実行ID */
  runId: string;
  /** ステータス */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** 進捗率 (0-100) */
  progress: number;
  /** 現在処理中のステージ */
  currentStage?: BacktestStage;
  /** 処理済みバー数 */
  processedBars?: number;
  /** 総バー数 */
  totalBars?: number;
  /** 開始時刻 */
  startedAt?: string;
  /** 完了時刻 */
  completedAt?: string;
}
