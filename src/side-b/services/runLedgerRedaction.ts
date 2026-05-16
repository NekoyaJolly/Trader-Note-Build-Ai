/**
 * RunLedger redaction helper
 *
 * AgentRun / AgentRunStep の summary / errorMessage / errorCode に保存する文字列を
 * 上限長で丸める。
 *
 * 目的: WBS §17「raw prompt / raw response / API key / DB row 全文を保存しない」を
 *   コード境界で強制する。Service 層は必ずこの helper を経由して
 *   Repository に渡す。
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §7 / §17
 */

/** summary の最大保存長 (それ以上は切り捨て + ellipsis) */
export const SUMMARY_MAX_LENGTH = 1024;

/** errorMessage の最大保存長 */
export const ERROR_MESSAGE_MAX_LENGTH = 512;

/** errorCode の最大保存長 (短いコード前提) */
export const ERROR_CODE_MAX_LENGTH = 64;

/**
 * summary を redaction 規約に従って丸める。
 *
 * - 文字列 → 長さを SUMMARY_MAX_LENGTH に切り詰め
 * - null / undefined / 空文字 → null (DB には NULL を入れる)
 *
 * **入力時点で redaction 済み文字列を期待する** (raw prompt / output を渡さない契約)。
 * Service 層は呼び出し側に「意味のある短い要約を渡す」ことを要求する。
 */
export function redactSummary(summary: string | null | undefined): string | null {
  if (summary == null) return null;
  const trimmed = summary.trim();
  if (trimmed === '') return null;
  if (trimmed.length <= SUMMARY_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, SUMMARY_MAX_LENGTH - 3)}...`;
}

/**
 * errorMessage を redaction 規約に従って丸める。stack trace は含めない前提。
 */
export function redactErrorMessage(message: string | null | undefined): string | null {
  if (message == null) return null;
  const trimmed = message.trim();
  if (trimmed === '') return null;
  if (trimmed.length <= ERROR_MESSAGE_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, ERROR_MESSAGE_MAX_LENGTH - 3)}...`;
}

/**
 * errorCode を丸める。enum 的な短い文字列を想定 (完全一致比較されるので ... は付けない)。
 */
export function redactErrorCode(code: string | null | undefined): string | null {
  if (code == null) return null;
  const trimmed = code.trim();
  if (trimmed === '') return null;
  if (trimmed.length <= ERROR_CODE_MAX_LENGTH) return trimmed;
  return trimmed.slice(0, ERROR_CODE_MAX_LENGTH);
}
