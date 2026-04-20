/**
 * 進化ループ由来の statement パーサー
 *
 * Phase 5A 旧実装では EdgeHypothesis.statement の先頭に
 * `[DSL:<uuid>] ` というプレフィックスが付与されていた。
 * このヘルパーはプレフィックスを除去し、表示用テキストと
 * DSL ID を分離して返す。
 */

export interface ParsedEvolutionStatement {
  /** UI に表示するテキスト（プレフィックス除去済み） */
  displayText: string;
  /** DSL UUID（進化ループ由来でなければ null） */
  dslId: string | null;
  /** プレフィックスが存在したかどうか */
  isEvolutionPrefixed: boolean;
}

const DSL_PREFIX_RE = /^\[DSL:([0-9a-f-]+)\]\s*/i;

export function parseEvolutionStatement(
  raw: string,
): ParsedEvolutionStatement {
  if (!raw) {
    return { displayText: "", dslId: null, isEvolutionPrefixed: false };
  }

  const match = DSL_PREFIX_RE.exec(raw);
  if (!match) {
    return { displayText: raw, dslId: null, isEvolutionPrefixed: false };
  }

  return {
    displayText: raw.slice(match[0].length) || raw,
    dslId: match[1],
    isEvolutionPrefixed: true,
  };
}
