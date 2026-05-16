/**
 * Hotfix: 既存プランを再利用 / 削除する判定ロジック(純粋関数)
 *
 * このファイルは **副作用なし**(module-load で Prisma 等に一切触らない)。
 * そのため ユニットテストは aiOrchestrator 全体をロードせずにこの関数だけ
 * 検証できる。CI 環境で新しいテストスイートが Prisma 接続を増やして
 * pool_size を超えてしまう問題を回避するため、このファイルに切り出した。
 *
 * 背景:
 *   日次プラン生成ジョブが一度 scenarios=0(ノートレード判断)のプランを
 *   保存すると、その日の残り時間はすべてキャッシュヒットで同じ空プランを
 *   返し続け、createTradeFromPlan が失敗し続ける問題があった。
 *   scenarios=0 は正常動作だが、キャッシュに居残らせない。
 */

/** `decideExistingPlanAction` の判定結果。 */
export type ExistingPlanDecision =
  | { action: 'reuse'; reason: 'cache-hit' }
  | { action: 'delete'; reason: 'forceRefresh' }
  | { action: 'delete'; reason: 'empty-scenarios' };

/**
 * 既存プランを再利用するか、削除して再生成するかを判定する。
 *
 * ルール:
 *   - forceRefresh=true          → delete (forceRefresh)
 *   - scenarios.length === 0     → delete (empty-scenarios / ノートレード判断の空プラン)
 *   - それ以外(scenarios >= 1)  → reuse  (cache-hit)
 */
/**
 * 本関数は scenarios フィールドの「配列か」「長さが 0 か」だけを参照する。
 * 呼び出し側の具体型 (`AITradeScenario[]` 等) と互換であるように、
 * `length` プロパティだけを要求する `ArrayLike` 互換の最小契約を宣言する。
 */
interface PlanWithScenariosShape {
  /** シナリオ列。中身は問わず length のみ参照する */
  scenarios?: { readonly length: number } | null;
}

export function decideExistingPlanAction(
  existingPlan: PlanWithScenariosShape | null | undefined,
  forceRefresh: boolean,
): ExistingPlanDecision {
  if (forceRefresh) {
    return { action: 'delete', reason: 'forceRefresh' };
  }
  const scenarios = existingPlan?.scenarios;
  const count = Array.isArray(scenarios) ? scenarios.length : 0;
  if (count === 0) {
    return { action: 'delete', reason: 'empty-scenarios' };
  }
  return { action: 'reuse', reason: 'cache-hit' };
}
