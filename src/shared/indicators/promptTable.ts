/**
 * mutation / crossover prompt 用の指標 metadata テーブル整形 (PR #117e)。
 *
 * registry.json (canonical) から動的に整形して `{{INDICATOR_METADATA_TABLE}}` macro
 * として LLM に渡す。registry を更新するだけで mutation / crossover の出力が
 * 「現在 evaluator が動く範囲」に追従する (= drift 防止 + LLM が無駄な未対応 lens を
 * 出さない)。
 *
 * セクション分けの方針:
 *   - **実装済 (mutation 推奨)**: tsSurrogate=true && pythonSeries=true
 *     → TS surrogate で fitness が出る + Python 正式 BT も動く
 *   - **Python BT のみ対応**: tsSurrogate=false && pythonSeries=true
 *     → TS surrogate では `false` 評価で fitness=0 になる、推奨度は低い
 *   - **完全未対応**: pythonSeries=false (& 当然 tsSurrogate=false)
 *     → 出力禁止 (= 出すと unsupportedConditions で観測)
 */

import { INDICATOR_REGISTRY, type IndicatorRegistryEntry } from './registry';

function formatDefaultParams(params: IndicatorRegistryEntry['defaultParams']): string {
  const entries = Object.entries(params);
  if (entries.length === 0) return '(なし)';
  // PR #117e Copilot review #1: 文字列値 (例: pivotType="standard") は引用符付きで表示。
  // LLM に「値が文字列」であることを伝えるため (引用符なしだと数値や未クォート token と
  // 誤解する誘因になる)。
  return entries
    .map(([k, v]) => (typeof v === 'string' ? `${k}="${v}"` : `${k}=${v}`))
    .join(', ');
}

function formatRow(entry: IndicatorRegistryEntry, columns: 3 | 2): string {
  if (columns === 3) {
    return `| \`${entry.id}\` | ${entry.category} | ${formatDefaultParams(entry.defaultParams)} |`;
  }
  return `| \`${entry.id}\` | ${entry.category} |`;
}

/**
 * registry を実装状況別に分類して mutation / crossover prompt 用テーブルを生成する。
 *
 * 戻り値は markdown 形式の文字列で、`{{INDICATOR_METADATA_TABLE}}` macro として
 * loader.expandMacros 経由で展開される想定。
 *
 * PR ④F: TS surrogate も analysis-engine `/v1/indicator-series` 経由で indicator
 * を取得するようになり、`pythonSeries=true` の 20 indicator は **すべて
 * mutation で利用可能**。旧「Python BT のみ対応」セクションは消滅する。
 * 完全未対応 (`pythonSeries=false`) のみ別セクションで「出力禁止」と明示。
 */
export function formatIndicatorMetadataTable(): string {
  const supported = INDICATOR_REGISTRY.filter((e) => e.support.pythonSeries);
  const unsupported = INDICATOR_REGISTRY.filter((e) => !e.support.pythonSeries);

  const lines: string[] = [];

  // PR #117e Copilot review #2: prompt md 側で `### 動的パラメータ付き indicator`
  // 見出しの下に macro を埋め込んでいるため、macro 自身も `###` だと同階層が
  // 入れ子になって Markdown 構造が崩れる。`####` に下げて挿入先と整合する形にする。
  lines.push('#### 実装済 (mutation 推奨、surrogate + 本格 BT 両対応)');
  lines.push('');
  lines.push('| feature | category | デフォルト params |');
  lines.push('|---|---|---|');
  for (const e of supported) {
    lines.push(formatRow(e, 3));
  }
  lines.push('');
  lines.push('上記 feature は `params` 付き condition / `compareTarget` 比較の両方で利用可能。');
  lines.push('例: `{ "lens": "ohlcv", "feature": "ema", "op": ">", "value": 1.05, "params": { "period": 20 } }`');
  lines.push('例: `{ "lens": "ohlcv", "feature": "close", "op": ">", "compareTarget": { "lens": "ohlcv", "feature": "ema", "params": { "period": 20 } } }`');
  lines.push('');

  if (unsupported.length > 0) {
    lines.push('#### 完全未対応 (出力禁止)');
    lines.push('');
    lines.push('| feature | category |');
    lines.push('|---|---|');
    for (const e of unsupported) {
      lines.push(formatRow(e, 2));
    }
    lines.push('');
    lines.push('Python 側評価器が未実装のため、出すと `unsupportedConditions` に積まれ leaf は false 評価される。');
    lines.push('');
  }

  return lines.join('\n');
}
