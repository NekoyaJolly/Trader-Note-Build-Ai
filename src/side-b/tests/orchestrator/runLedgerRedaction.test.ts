/**
 * runLedgerRedaction helper の単体 test。
 *
 * 目的: summary / errorMessage / errorCode の長さ制限を境界値で検証する
 *   (summary / errorMessage は ... 付きで切り詰め、errorCode は完全一致比較を
 *   保つため ... を付けず単純切り捨て)。null / 空文字は null に正規化される。
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §7 / §17
 */
import {
  redactSummary,
  redactErrorMessage,
  redactErrorCode,
  SUMMARY_MAX_LENGTH,
  ERROR_MESSAGE_MAX_LENGTH,
  ERROR_CODE_MAX_LENGTH,
} from '../../services/runLedgerRedaction';

describe('redactSummary', () => {
  it('null / undefined / 空文字 / 空白だけ → null', () => {
    expect(redactSummary(null)).toBeNull();
    expect(redactSummary(undefined)).toBeNull();
    expect(redactSummary('')).toBeNull();
    expect(redactSummary('   ')).toBeNull();
  });

  it('上限以下はそのまま (trim 済み)', () => {
    expect(redactSummary('  ok  ')).toBe('ok');
    expect(redactSummary('a'.repeat(SUMMARY_MAX_LENGTH))).toBe('a'.repeat(SUMMARY_MAX_LENGTH));
  });

  it('上限超過は ... 付きで切り詰め (合計長は上限と同じ)', () => {
    const result = redactSummary('a'.repeat(SUMMARY_MAX_LENGTH + 100));
    expect(result?.length).toBe(SUMMARY_MAX_LENGTH);
    expect(result?.endsWith('...')).toBe(true);
  });
});

describe('redactErrorMessage', () => {
  it('上限超過は ... で切り詰め', () => {
    const result = redactErrorMessage('e'.repeat(ERROR_MESSAGE_MAX_LENGTH + 50));
    expect(result?.length).toBe(ERROR_MESSAGE_MAX_LENGTH);
    expect(result?.endsWith('...')).toBe(true);
  });

  it('null / 空文字 → null', () => {
    expect(redactErrorMessage(null)).toBeNull();
    expect(redactErrorMessage('')).toBeNull();
  });
});

describe('redactErrorCode', () => {
  it('上限超過は単純切り捨て (... を付けない、code は完全一致比較される前提)', () => {
    const result = redactErrorCode('c'.repeat(ERROR_CODE_MAX_LENGTH + 30));
    expect(result?.length).toBe(ERROR_CODE_MAX_LENGTH);
    expect(result?.endsWith('...')).toBe(false);
  });

  it('普通の短い code はそのまま', () => {
    expect(redactErrorCode('E_TIMEOUT')).toBe('E_TIMEOUT');
  });
});

