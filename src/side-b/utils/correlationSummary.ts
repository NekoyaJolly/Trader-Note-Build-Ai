/**
 * RunLedger summary/reason に相関IDを付与する共通ユーティリティ。
 *
 * 目的: TopLevel / ADK Orchestrator / JobLedgerAdapter で同じ表記を使い、
 * 将来 prefix や区切り文字を変える場合のドリフトを防ぐ。
 */

/**
 * RunLedger に保存する要約へ相関IDを付与する。
 *
 * 戻り値側の envelope 契約は変更せず、永続化される summary/reason だけを拡張する用途で使う。
 */
export function withCorrelationSummary(
  summary: string | null | undefined,
  correlationId: string | null | undefined,
): string | null {
  const base = summary ?? null;
  if (!correlationId) return base;
  if (!base) return `correlationId=${correlationId}`;
  return `correlationId=${correlationId} ${base}`;
}
