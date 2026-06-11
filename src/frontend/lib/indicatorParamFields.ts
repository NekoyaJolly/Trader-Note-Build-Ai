/**
 * インジケーター別パラメータ入力フィールド定義
 *
 * 目的:
 * - 「どのインジケーターがどのパラメータ (期間等) を持つか」の定義を 1 箇所に集約する (DRY)
 * - IndicatorConfigModal (サイドバーのインジケーター設定) と
 *   ProfileEditModal (settings/profiles のプロファイル編集) の両方から参照する
 *
 * UI コンポーネントから独立した純粋なデータ定義 (PR #387 Copilot レビュー対応で
 * IndicatorConfigModal.tsx から分離。モーダル実装への結合とバンドル肥大を避ける)。
 */

import type { IndicatorParams } from "@/types/indicator";

/**
 * パラメータ入力フィールドの設定
 */
export interface ParamFieldConfig {
  key: keyof IndicatorParams;
  label: string;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * インジケーターIDからパラメータフィールド設定を取得
 */
export function getParamFields(indicatorId: string): ParamFieldConfig[] {
  switch (indicatorId) {
    case 'rsi':
    case 'sma':
    case 'ema':
    case 'dema':
    case 'tema':
    case 'atr':
    case 'williamsR':
    case 'roc':
    case 'mfi':
    case 'cmf':
    case 'aroon':
    case 'cci':
      return [{ key: 'period', label: '期間', min: 1, max: 500 }];
    case 'macd':
      return [
        { key: 'fastPeriod', label: '短期EMA', min: 1, max: 100 },
        { key: 'slowPeriod', label: '長期EMA', min: 1, max: 100 },
        { key: 'signalPeriod', label: 'シグナル', min: 1, max: 100 },
      ];
    case 'stochastic':
      return [
        { key: 'kPeriod', label: '%K期間', min: 1, max: 100 },
        { key: 'dPeriod', label: '%D期間', min: 1, max: 100 },
      ];
    case 'bb':
    case 'kc':
      // BB/KCの標準偏差はindicatortsライブラリの制約により2固定
      return [
        { key: 'period', label: '期間', min: 1, max: 100 },
      ];
    case 'psar':
      return [
        { key: 'step', label: 'ステップ', min: 0.01, max: 0.5, step: 0.01 },
        { key: 'maxStep', label: '最大ステップ', min: 0.1, max: 1, step: 0.01 },
      ];
    case 'ichimoku':
      return [
        { key: 'conversionPeriod', label: '転換線', min: 1, max: 100 },
        { key: 'basePeriod', label: '基準線', min: 1, max: 100 },
        { key: 'spanBPeriod', label: '先行スパンB', min: 1, max: 200 },
        { key: 'displacement', label: '遅行スパン', min: 1, max: 100 },
      ];
    case 'obv':
    case 'vwap':
      return []; // パラメータなし
    default:
      return [{ key: 'period', label: '期間', min: 1, max: 500 }];
  }
}
