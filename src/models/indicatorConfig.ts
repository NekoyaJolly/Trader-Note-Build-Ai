/**
 * インジケーター設定型定義
 *
 * 目的:
 * - ユーザーが選択可能な23種類のインジケーターを定義
 * - 同一インジケーターの複数期間選択をサポート
 * - TradeDefinition生成時の特徴量計算に使用
 *
 * PR #115: 23 指標のメタデータ canonical は `src/shared/indicators/registry.json`。
 * ここでは Side-A の既存 API (型 / INDICATOR_METADATA / helper) を維持しつつ
 * 中身は registry から構築する。新しい指標を追加したい時は registry.json を編集する。
 */

import type {
  IndicatorCategory as RegistryIndicatorCategory,
  IndicatorId as RegistryIndicatorId,
} from '../shared/indicators/registry';
import {
  INDICATOR_REGISTRY,
  getIndicatorRegistryEntry,
  getIndicatorsByCategory as getRegistryIndicatorsByCategory,
} from '../shared/indicators/registry';

/**
 * 利用可能なインジケーター種別 (Side-A 互換 alias)。
 *
 * indicatorts ライブラリの分類に基づく:
 * - momentum: モメンタム系（RSI, Stochastic, WilliamsR 等）
 * - trend: トレンド系（SMA, EMA, MACD, Aroon 等）
 * - volatility: ボラティリティ系（ATR, BB, KC 等）
 * - volume: 出来高系（OBV, VWAP, CMF 等）
 * - support_resistance: 支持/抵抗系 (Pivot 等)
 */
export type IndicatorCategory = RegistryIndicatorCategory;

/**
 * サポートするインジケーター ID (Side-A 互換 alias)。
 *
 * 23 種類: 既存 9 種 + 新規 11 種 + 追加 3 種。
 * 真の定義は `src/shared/indicators/registry.json` 側。
 */
export type IndicatorId = RegistryIndicatorId;

/**
 * インジケーターメタデータ
 * 
 * UI表示用およびバリデーション用の情報
 */
export interface IndicatorMetadata {
  // インジケーター識別子
  id: IndicatorId;
  // 日本語表示名
  displayName: string;
  // カテゴリ
  category: IndicatorCategory;
  // 説明文
  description: string;
  // デフォルトパラメータ
  defaultParams: IndicatorParams;
  // パラメータの制約
  paramConstraints: ParamConstraints;
}

/**
 * パラメータ制約定義
 */
export interface ParamConstraints {
  // 期間パラメータの最小値
  minPeriod?: number;
  // 期間パラメータの最大値
  maxPeriod?: number;
  // 標準偏差倍率の範囲（BB, KC用）
  // 注: BB/KCの標準偏差はindicatortsライブラリの制約により2固定
}

/**
 * 各インジケーターのパラメータ型
 * 
 * 同一インジケーターを複数期間で使用する場合、
 * 各設定は個別の IndicatorConfig として管理される
 */
export interface IndicatorParams {
  // 基本期間（RSI, SMA, EMA, ATR, CCI 等）
  period?: number;
  // MACD用: 短期EMA期間
  fastPeriod?: number;
  // MACD用: 長期EMA期間
  slowPeriod?: number;
  // MACD/Stochastic用: シグナル期間
  signalPeriod?: number;
  // Stochastic用: %K期間、%D期間
  kPeriod?: number;
  dPeriod?: number;
  // BB/KC用: 標準偏差の倍率
  // stdDevはindicatortsライブラリの制約により2固定のため削除
  // Parabolic SAR用
  step?: number;
  maxStep?: number;
  // Ichimoku用
  conversionPeriod?: number;  // 転換線期間
  basePeriod?: number;        // 基準線期間
  spanBPeriod?: number;       // 先行スパンB期間
  displacement?: number;      // 遅行スパン
  // Supertrend用
  multiplier?: number;        // ATR乗数
  // Pivot用
  pivotType?: 'standard' | 'fibonacci' | 'camarilla';  // 計算方式
}

/**
 * ユーザーが設定する単一インジケーター設定
 * 
 * 例: RSI(14) と RSI(7) を両方使う場合、
 * 2つの IndicatorConfig を作成する
 */
export interface IndicatorConfig {
  // 設定ID（ユニーク、UIでの識別用）
  configId: string;
  // インジケーター種別
  indicatorId: IndicatorId;
  // カスタムラベル（例: "RSI-短期", "RSI-中期"）
  label?: string;
  // パラメータ設定
  params: IndicatorParams;
  // 有効/無効フラグ
  enabled: boolean;
}

/**
 * インジケーターセット
 * 
 * ユーザーが選択した複数のインジケーター設定をまとめる
 */
export interface IndicatorSet {
  // セット名（例: "短期トレード用", "スイング用"）
  name: string;
  // 設定リスト（最大20個程度を推奨）
  configs: IndicatorConfig[];
  // 作成日時
  createdAt: Date;
  // 更新日時
  updatedAt: Date;
}

/**
 * registry.json の 1 エントリを Side-A 既存の `IndicatorMetadata` 形に投影する。
 * Side-B 用の `support` フィールド (pythonSeries / tsSurrogate) は Side-A の UI 側
 * では使わないので落とす。`defaultParams` の値は registry 側で number | string、
 * Side-A の `IndicatorParams` は number / string-literal を含むので素直に合致させる。
 */
function projectRegistryEntry(entry: (typeof INDICATOR_REGISTRY)[number]): IndicatorMetadata {
  return {
    id: entry.id,
    displayName: entry.displayName,
    category: entry.category,
    description: entry.description,
    // registry 側は Record<string, number | string>。`IndicatorParams` の optional field 群と
    // 整合する範囲しか入っていない (前提: registry.json をいじる側がレビューで担保)。
    defaultParams: entry.defaultParams,
    paramConstraints: { ...entry.paramConstraints },
  };
}

/**
 * 利用可能なインジケーターのメタデータ一覧 (Side-A 既存 API 互換)。
 *
 * 真の定義は `src/shared/indicators/registry.json`。本配列はそこから登録順を
 * 維持して構築する。UI / バリデーション / バックエンドの既存利用箇所
 * (`indicatorRoutes.ts` / `indicatorProfileService.ts` / `indicatorSettingsService.ts`)
 * は変更不要のまま動く。
 */
export const INDICATOR_METADATA: readonly IndicatorMetadata[] = Object.freeze(
  INDICATOR_REGISTRY.map(projectRegistryEntry),
);

/**
 * インジケーターIDからメタデータを取得
 *
 * @param id - インジケーターID
 * @returns メタデータまたはundefined
 */
export function getIndicatorMetadata(id: IndicatorId): IndicatorMetadata | undefined {
  const entry = getIndicatorRegistryEntry(id);
  return entry ? projectRegistryEntry(entry) : undefined;
}

/**
 * カテゴリでインジケーターをフィルタ
 *
 * @param category - インジケーターカテゴリ
 * @returns 該当カテゴリのメタデータ配列
 */
export function getIndicatorsByCategory(category: IndicatorCategory): IndicatorMetadata[] {
  return getRegistryIndicatorsByCategory(category).map(projectRegistryEntry);
}

/**
 * デフォルトのインジケーターセットを生成
 * 
 * MVP用の基本セット（9種類）
 * @returns デフォルトのIndicatorSet
 */
export function createDefaultIndicatorSet(): IndicatorSet {
  const now = new Date();
  return {
    name: 'デフォルト',
    configs: [
      { configId: 'rsi-14', indicatorId: 'rsi', label: 'RSI(14)', params: { period: 14 }, enabled: true },
      { configId: 'sma-20', indicatorId: 'sma', label: 'SMA(20)', params: { period: 20 }, enabled: true },
      { configId: 'ema-20', indicatorId: 'ema', label: 'EMA(20)', params: { period: 20 }, enabled: true },
      { configId: 'macd-default', indicatorId: 'macd', label: 'MACD', params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }, enabled: true },
      { configId: 'bb-20', indicatorId: 'bb', label: 'BB(20)', params: { period: 20 }, enabled: true },
      { configId: 'atr-14', indicatorId: 'atr', label: 'ATR(14)', params: { period: 14 }, enabled: true },
      { configId: 'stoch-14-3', indicatorId: 'stochastic', label: 'Stoch(14,3)', params: { kPeriod: 14, dPeriod: 3 }, enabled: true },
      { configId: 'obv-default', indicatorId: 'obv', label: 'OBV', params: {}, enabled: true },
      { configId: 'vwap-default', indicatorId: 'vwap', label: 'VWAP', params: {}, enabled: true },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * IndicatorConfig のパラメータをバリデーション
 * 
 * @param config - 検証対象の設定
 * @returns エラーメッセージ配列（空なら有効）
 */
export function validateIndicatorConfig(config: IndicatorConfig): string[] {
  const errors: string[] = [];
  const metadata = getIndicatorMetadata(config.indicatorId);

  if (!metadata) {
    errors.push(`不明なインジケーター: ${config.indicatorId}`);
    return errors;
  }

  const { paramConstraints } = metadata;
  const { params } = config;

  // 期間パラメータのバリデーション
  if (params.period !== undefined && paramConstraints.minPeriod !== undefined) {
    if (params.period < paramConstraints.minPeriod) {
      errors.push(`${metadata.displayName}の期間は${paramConstraints.minPeriod}以上にしてください`);
    }
  }
  if (params.period !== undefined && paramConstraints.maxPeriod !== undefined) {
    if (params.period > paramConstraints.maxPeriod) {
      errors.push(`${metadata.displayName}の期間は${paramConstraints.maxPeriod}以下にしてください`);
    }
  }

  // 注: BB/KCの標準偏差はindicatortsライブラリの制約により2固定

  return errors;
}
