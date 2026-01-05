/**
 * AIトレードプラン（TradePlan）型定義
 * 
 * Plan AIが生成するトレードプラン。
 * 
 * 設計思想:
 * Plan AI = 「解釈・戦略立案」
 * - Research AIから12次元特徴量を受け取る
 * - OHLCVデータも参照して総合判断
 * - トレンド解釈、価格レベル判定、シナリオ生成を行う
 * - gpt-4oの高い推論能力を活用
 */

// ===========================================
// Plan AIで生成する型（Researchから移動）
// ===========================================

/**
 * 市場レジーム（Plan AIが判定）
 */
export type MarketRegime =
  | 'strong_uptrend'    // 強い上昇トレンド
  | 'uptrend'           // 上昇トレンド
  | 'range'             // レンジ相場
  | 'downtrend'         // 下降トレンド
  | 'strong_downtrend'  // 強い下降トレンド
  | 'volatile';         // 高ボラティリティ（方向不明）

/**
 * 重要価格レベル（Plan AIが判定）
 */
export interface KeyLevels {
  /** 強いレジスタンス（1-4個） */
  strongResistance: number[];
  /** レジスタンス（1-4個） */
  resistance: number[];
  /** サポート（1-4個） */
  support: number[];
  /** 強いサポート（1-4個） */
  strongSupport: number[];
}

// ===========================================
// 型定義
// ===========================================

/**
 * エントリー条件
 */
export interface EntryCondition {
  /** 注文タイプ */
  type: 'limit' | 'market' | 'stop';
  /** エントリー価格 */
  price: number;
  /** 条件説明（自然言語） */
  condition: string;
  /** トリガーとなる指標 */
  triggerIndicators: string[];
}

/**
 * ストップロス設定
 */
export interface StopLoss {
  /** SL価格 */
  price: number;
  /** pips換算 */
  pips: number;
  /** 設定根拠 */
  reason: string;
}

/**
 * テイクプロフィット設定
 */
export interface TakeProfit {
  /** TP価格 */
  price: number;
  /** pips換算 */
  pips: number;
  /** 設定根拠 */
  reason: string;
}

/**
 * シナリオ優先度
 */
export type ScenarioPriority = 'primary' | 'secondary' | 'alternative';

/**
 * トレードシナリオ
 */
export interface AITradeScenario {
  id: string;
  /** シナリオ名（例: "押し目買いシナリオ"） */
  name: string;
  /** 方向 */
  direction: 'long' | 'short';
  /** 優先度 */
  priority: ScenarioPriority;

  // エントリー条件
  entry: EntryCondition;

  // リスク管理
  stopLoss: StopLoss;
  takeProfit: TakeProfit;

  // 分析
  /** リスクリワード比 */
  riskReward: number;
  /** 信頼度（0-100） */
  confidence: number;
  /** AIの判断根拠（詳細） */
  rationale: string;

  // 無効化条件
  invalidationConditions: string[];
}

/**
 * 市場分析（プラン内）- Plan AIが生成
 */
export interface PlanMarketAnalysis {
  /** 市場レジーム */
  regime: MarketRegime;
  /** レジーム判定の確信度 */
  regimeConfidence: number;
  /** トレンド方向 */
  trendDirection: 'up' | 'down' | 'sideways';
  /** ボラティリティ */
  volatility: 'low' | 'medium' | 'high';
  /** 重要価格レベル */
  keyLevels: KeyLevels;
  /** 市場サマリー */
  summary: string;
  /** 追加考察 */
  additionalInsights?: string[];
}

/**
 * AIトレードプラン
 */
export interface AITradePlan {
  id: string;
  createdAt: Date;
  targetDate: string;
  symbol: string;

  // リサーチ参照
  researchId: string;

  // 市場分析
  marketAnalysis: PlanMarketAnalysis;

  // トレードシナリオ
  scenarios: AITradeScenario[];

  // メタ情報
  overallConfidence: number;
  warnings: string[];
  aiModel: string;
  tokenUsage: number;
}

/**
 * プラン生成リクエスト
 */
export interface GeneratePlanRequest {
  symbol: string;
  targetDate?: string;
  researchId?: string;
}

/**
 * プラン生成レスポンス
 */
export interface GeneratePlanResponse {
  success: boolean;
  plan: AITradePlan;
  researchUsed: {
    id: string;
    cached: boolean;
  };
}

/**
 * Plan AI出力型（AIからのレスポンス）
 * 
 * 含まれる内容:
 * - 市場レジーム判定（Research AIから移動）
 * - 重要価格レベル（Research AIから移動）
 * - トレードシナリオ
 */
export interface PlanAIOutput {
  marketAnalysis: PlanMarketAnalysis;
  scenarios: Omit<AITradeScenario, 'id'>[];
  overallConfidence: number;
  warnings: string[];
}

// ===========================================
// バリデーション
// ===========================================

/** 有効なレジーム値 */
const VALID_REGIMES: MarketRegime[] = [
  'strong_uptrend', 'uptrend', 'range', 'downtrend', 'strong_downtrend', 'volatile'
];

/**
 * Plan AI出力のバリデーション
 */
export function validatePlanAIOutput(data: unknown): PlanAIOutput {
  const obj = data as Record<string, unknown>;

  // 必須フィールドの存在チェック
  if (!obj.marketAnalysis || !obj.scenarios || !Array.isArray(obj.scenarios)) {
    throw new Error('Required fields missing in Plan AI output');
  }

  const ma = obj.marketAnalysis as Record<string, unknown>;
  
  // レジームのバリデーション
  if (!VALID_REGIMES.includes(ma.regime as MarketRegime)) {
    throw new Error(`Invalid regime: ${ma.regime}`);
  }

  // シナリオ数のバリデーション
  const scenarios = obj.scenarios as unknown[];
  if (scenarios.length < 1 || scenarios.length > 3) {
    throw new Error('scenarios must have 1-3 items');
  }

  // 信頼度のバリデーション
  const overallConfidence = obj.overallConfidence as number;
  if (typeof overallConfidence !== 'number' || overallConfidence < 0 || overallConfidence > 100) {
    throw new Error('overallConfidence must be number 0-100');
  }

  // 各シナリオの基本バリデーション
  for (const scenario of scenarios) {
    const s = scenario as Record<string, unknown>;
    if (!s.name || !s.direction || !s.entry || !s.stopLoss || !s.takeProfit) {
      throw new Error('Scenario missing required fields');
    }
    if (s.direction !== 'long' && s.direction !== 'short') {
      throw new Error('Invalid direction');
    }
  }

  return {
    marketAnalysis: ma as unknown as PlanMarketAnalysis,
    scenarios: scenarios as Omit<AITradeScenario, 'id'>[],
    overallConfidence,
    warnings: (obj.warnings as string[]) || [],
  };
}

// ===========================================
// ユーティリティ関数
// ===========================================

/**
 * プライマリシナリオを取得
 */
export function getPrimaryScenario(plan: AITradePlan): AITradeScenario | undefined {
  return plan.scenarios.find(s => s.priority === 'primary');
}

/**
 * シナリオのリスク金額を計算（仮想用）
 * @param scenario シナリオ
 * @param positionSize ポジションサイズ
 * @returns リスク金額
 */
export function calculateRiskAmount(
  scenario: AITradeScenario,
  positionSize: number
): number {
  return Math.abs(scenario.entry.price - scenario.stopLoss.price) * positionSize;
}

/**
 * 信頼度を日本語表現に変換
 */
export function confidenceToJapanese(confidence: number): string {
  if (confidence >= 90) return '非常に高い';
  if (confidence >= 70) return '高い';
  if (confidence >= 50) return '中程度';
  if (confidence >= 30) return '低い';
  return '非常に低い';
}

/**
 * 優先度を日本語に変換
 */
export function priorityToJapanese(priority: ScenarioPriority): string {
  const map: Record<ScenarioPriority, string> = {
    primary: 'メイン',
    secondary: 'サブ',
    alternative: '代替',
  };
  return map[priority];
}

/**
 * 方向を日本語に変換
 */
export function directionToJapanese(direction: 'long' | 'short'): string {
  return direction === 'long' ? 'ロング' : 'ショート';
}

/**
 * 方向に対応する絵文字を返す
 */
export function directionToEmoji(direction: 'long' | 'short'): string {
  return direction === 'long' ? '🟢' : '🔴';
}

/**
 * レジームを日本語に変換
 */
export function regimeToJapanese(regime: MarketRegime): string {
  const map: Record<MarketRegime, string> = {
    strong_uptrend: '強い上昇トレンド',
    uptrend: '上昇トレンド',
    range: 'レンジ相場',
    downtrend: '下降トレンド',
    strong_downtrend: '強い下降トレンド',
    volatile: '高ボラティリティ',
  };
  return map[regime];
}

/**
 * レジームに対応する絵文字を返す
 */
export function regimeToEmoji(regime: MarketRegime): string {
  const map: Record<MarketRegime, string> = {
    strong_uptrend: '🚀',
    uptrend: '📈',
    range: '➡️',
    downtrend: '📉',
    strong_downtrend: '💥',
    volatile: '🌪️',
  };
  return map[regime];
}
