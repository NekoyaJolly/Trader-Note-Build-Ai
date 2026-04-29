/**
 * Phase 6 hotfix: LLM 応答から JSON を堅牢に抽出するユーティリティ
 *
 * 既存の `parseProposalArray` / `parseProposalJson` / `parseJsonLoose` で共有する
 * 共通ロジック。3 段階の fallback で JSON を抽出する:
 *
 *   1. 生のまま JSON.parse を試みる
 *   2. 応答全体が Markdown コードフェンスで包まれている場合 (^```json ... ```$) に限り
 *      中身を取り出して parse
 *   3. 最後の手段: 最外の `[...]` または `{...}` をバランス検出で切り出して parse
 *
 * これまでの問題:
 *   - 正規表現 /```(?:json)?\s*([\s\S]*?)```/ が無条件に先に走っていたため、
 *     応答がプレーン JSON でその *内部文字列* に ``` を含むマークダウンが
 *     混入していたとき、本文中の断片を fence と誤マッチして JSON.parse を壊していた。
 *
 * 対策:
 *   - まず生の JSON.parse を優先 (誤マッチを回避)
 *   - fence 除去は **応答全体を包む fence** 限定 (行頭/末尾アンカー + 前後空白のみ許容)
 *   - 最後の bracket balance 抽出で 会話的な前置き/後置きが混ざるケースにも対応
 */

export type ExtractResult<T = unknown> =
  | { ok: true; data: T; via: 'raw' | 'fence' | 'bracket' }
  | { ok: false; error: string };

/**
 * LLM 応答文字列から JSON をパースして返す。どの経路でパースできたかも返す。
 * 3 段階全て失敗したら `ok: false` + `error` を返す。
 *
 * @param content LLM 応答本文 (trim される)
 */
export function extractJson<T = unknown>(content: string): ExtractResult<T> {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: '空文字列' };
  }

  // 1. 生のまま JSON.parse
  try {
    const data = JSON.parse(trimmed) as T;
    return { ok: true, data, via: 'raw' };
  } catch {
    /* fallback */
  }

  // 2. 応答全体が Markdown フェンスで包まれている場合に限り中身を取り出す
  //    行頭/末尾アンカー + 前後の空白のみ許容することで、本文中の ``` 誤マッチを回避
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch?.[1]) {
    try {
      const data = JSON.parse(fenceMatch[1].trim()) as T;
      return { ok: true, data, via: 'fence' };
    } catch {
      /* fallback to bracket extraction */
    }
  }

  // 3. 最後の手段: 最外の [...] or {...} をバランス検出で切り出す
  const bracket = extractOutermostBrackets(trimmed);
  if (bracket) {
    try {
      const data = JSON.parse(bracket) as T;
      return { ok: true, data, via: 'bracket' };
    } catch {
      /* fall through */
    }
  }

  return { ok: false, error: 'JSON として解釈できない(raw/fence/bracket すべて失敗)' };
}

/**
 * 文字列の最初に登場する `[` or `{` から、文字列リテラルとエスケープを考慮した
 * バランスマッチで対応する閉じ括弧までを切り出す。
 *
 * 切り出せない場合は null。不完全な JSON (Unterminated string 等) は null となる。
 */
export function extractOutermostBrackets(s: string): string | null {
  // 開始位置を見つける
  let start = -1;
  let openChar = '';
  let closeChar = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '[') {
      start = i;
      openChar = '[';
      closeChar = ']';
      break;
    }
    if (c === '{') {
      start = i;
      openChar = '{';
      closeChar = '}';
      break;
    }
  }
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (c === '\\') {
        escaped = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === openChar) {
      depth++;
    } else if (c === closeChar) {
      depth--;
      if (depth === 0) {
        return s.slice(start, i + 1);
      }
    }
  }
  return null;
}
