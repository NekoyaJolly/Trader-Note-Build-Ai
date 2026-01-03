/**
 * 12次元特徴量ベクトル
 * 
 * Side-A（人間ノート）と Side-B（AIプラン）で共通使用する市場状態の表現。
 * 各値は 0-100 の正規化スコア。
 * 
 * これにより人間とAIの市場認識を同じ基準で比較可能。
 */

// ===========================================
// 型定義
// ===========================================

/**
 * 12次元特徴量ベクトル
 */
export interface FeatureVector12D {
  // トレンド系（4次元）
  /** トレンドの強さ - ADX等から算出（0=トレンドなし, 100=非常に強いトレンド） */
  trendStrength: number;
  /** トレンド方向 - 価格とMA200の乖離率（0=強い下降, 50=横ばい, 100=強い上昇） */
  trendDirection: number;
  /** MA配列の整列度 - 短期>中期>長期なら100、逆なら0 */
  maAlignment: number;
  /** MA群に対する価格位置 - MA群の上なら高スコア */
  pricePosition: number;

  // モメンタム系（3次元）
  /** RSIレベル - RSI値そのまま（0-100） */
  rsiLevel: number;
  /** MACDモメンタム - ヒストグラムの強さを正規化 */
  macdMomentum: number;
  /** ダイバージェンス検出 - 価格とオシレーターの乖離（0=なし, 100=強いダイバージェンス） */
  momentumDivergence: number;

  // ボラティリティ系（3次元）
  /** ボラティリティレベル - ATRを過去平均比で正規化 */
  volatilityLevel: number;
  /** ボリンジャーバンド幅 - バンド幅を正規化 */
  bbWidth: number;
  /** ボラティリティ傾向 - 拡大傾向なら高スコア（0=縮小中, 100=急拡大中） */
  volatilityTrend: number;

  // 価格構造系（2次元）
  /** サポートへの近さ - 最寄りサポートへの距離を正規化（100=直近） */
  supportProximity: number;
  /** レジスタンスへの近さ - 最寄りレジスタンスへの距離を正規化（100=直近） */
  resistanceProximity: number;
}

// ===========================================
// バリデーション
// ===========================================

/**
 * 0-100の範囲かチェック
 */
function isValidScore(value: number): boolean {
  return typeof value === 'number' && value >= 0 && value <= 100;
}

/**
 * 12次元特徴量のバリデーション
 */
export function validateFeatureVector(data: unknown): FeatureVector12D {
  const vector = data as Record<string, unknown>;
  const keys: (keyof FeatureVector12D)[] = [
    'trendStrength', 'trendDirection', 'maAlignment', 'pricePosition',
    'rsiLevel', 'macdMomentum', 'momentumDivergence',
    'volatilityLevel', 'bbWidth', 'volatilityTrend',
    'supportProximity', 'resistanceProximity',
  ];

  for (const key of keys) {
    if (!isValidScore(vector[key] as number)) {
      throw new Error(`Invalid ${key}: must be number 0-100`);
    }
  }

  return vector as unknown as FeatureVector12D;
}

// ===========================================
// ユーティリティ関数
// ===========================================

/**
 * 特徴量ベクトルを配列に変換（コサイン類似度計算用）
 */
export function featureVectorToArray(vector: FeatureVector12D): number[] {
  return [
    vector.trendStrength,
    vector.trendDirection,
    vector.maAlignment,
    vector.pricePosition,
    vector.rsiLevel,
    vector.macdMomentum,
    vector.momentumDivergence,
    vector.volatilityLevel,
    vector.bbWidth,
    vector.volatilityTrend,
    vector.supportProximity,
    vector.resistanceProximity,
  ];
}

/**
 * 2つの特徴量ベクトル間のコサイン類似度を計算
 * @returns 0-1 の類似度（1が完全一致）
 */
export function calculateCosineSimilarity(
  vectorA: FeatureVector12D,
  vectorB: FeatureVector12D
): number {
  const a = featureVectorToArray(vectorA);
  const b = featureVectorToArray(vectorB);

  // ドット積を計算
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  // ゼロベクトルの場合は0を返す
  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 空の特徴量ベクトルを生成（初期値として使用）
 */
export function createEmptyFeatureVector(): FeatureVector12D {
  return {
    trendStrength: 50,
    trendDirection: 50,
    maAlignment: 50,
    pricePosition: 50,
    rsiLevel: 50,
    macdMomentum: 50,
    momentumDivergence: 0,
    volatilityLevel: 50,
    bbWidth: 50,
    volatilityTrend: 50,
    supportProximity: 50,
    resistanceProximity: 50,
  };
}

/**
 * 特徴量ベクトルのサマリーを生成（デバッグ・ログ用）
 */
export function summarizeFeatureVector(vector: FeatureVector12D): string {
  const trend = vector.trendDirection > 60 ? '上昇' : vector.trendDirection < 40 ? '下降' : '横ばい';
  const strength = vector.trendStrength > 60 ? '強い' : vector.trendStrength < 40 ? '弱い' : '中程度';
  const volatility = vector.volatilityLevel > 60 ? '高' : vector.volatilityLevel < 40 ? '低' : '中';
  
  return `${strength}${trend}トレンド, ボラ${volatility}, RSI=${vector.rsiLevel.toFixed(0)}`;
}
