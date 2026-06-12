/**
 * Side-A 実発注の安全ゲート。
 *
 * Phase 0 では安全確認 UI / 冪等性 / cTrader 動的仕様検証が未完のため、
 * 明示的に env で許可されるまで発注系 mutation を遮断する。
 */

export const TRADING_ORDER_EXECUTION_DISABLED_CODE = 'TRADING_ORDER_EXECUTION_DISABLED';
export const TRADING_ORDER_EXECUTION_DISABLED_MESSAGE =
  '実発注は安全ガード実装まで停止中です';

/**
 * 実発注系 mutation を許可するか判定する。
 *
 * 既定 OFF にする理由: env 未設定やデプロイ設定漏れで live order が開く事故を防ぐため。
 */
export function isTradingOrderExecutionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TRADING_ORDER_EXECUTION_ENABLED === 'true';
}
