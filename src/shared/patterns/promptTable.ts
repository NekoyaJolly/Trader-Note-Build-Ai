/**
 * mutation / crossover prompt 用の pattern metadata テーブル整形 (PR ②-2)。
 *
 * `data/patternRegistry.json` (canonical) から動的に整形して
 * `{{PATTERN_METADATA_TABLE}}` macro として LLM に渡す。registry を更新するだけで
 * mutation / crossover の出力が「現在 evaluator が動く 12 種」に追従する
 * (= drift 防止)。さらに LLM に **pattern の意味 / 用法** を教えて、
 * 「ピンバー反転」「engulfing 転換」のような戦略アーキタイプを生成可能にする。
 *
 * セクション分けの方針:
 *   - **reversal (反転)**: 値動きの拒絶 / 転換シグナル群。pinbar / hammer /
 *     shooting_star / engulfing 系
 *   - **continuation (継続)**: トレンド継続シグナル群。thrust 系
 *   - **indecision (迷い)**: 売買拮抗シグナル群。doji
 */

import { PATTERN_REGISTRY, type PatternRegistryEntry } from './registry';

function formatExamples(examples: readonly string[]): string {
  // markdown table 内では改行できないので `<br>` を使う。
  // 各例文は JSON 側で既に backtick を埋め込んでいる前提なので、
  // formatter 側では再度 backtick で包まずそのまま結合する
  // (= 二重 backtick で markdown のインラインコードが壊れるのを防ぐ)。
  return examples.join('<br>');
}

function formatRow(entry: PatternRegistryEntry): string {
  return [
    `| \`${entry.id}\``,
    entry.displayName,
    entry.shape,
    entry.tradeContext,
    formatExamples(entry.usageExamples),
  ].join(' | ') + ' |';
}

/**
 * pattern registry を category 別に分類して mutation / crossover prompt 用の
 * テーブルを生成する。markdown 形式で `{{PATTERN_METADATA_TABLE}}` macro として
 * loader.expandMacros 経由で展開される。
 */
export function formatPatternMetadataTable(): string {
  const reversal = PATTERN_REGISTRY.filter((e) => e.category === 'reversal');
  const continuation = PATTERN_REGISTRY.filter((e) => e.category === 'continuation');
  const indecision = PATTERN_REGISTRY.filter((e) => e.category === 'indecision');

  const lines: string[] = [];

  lines.push('#### reversal (反転シグナル) — トレンド転換 / 値動き拒絶を捉える');
  lines.push('');
  lines.push('| feature | 名称 | 形状 | トレード文脈 | 使い方の例 |');
  lines.push('|---|---|---|---|---|');
  for (const e of reversal) lines.push(formatRow(e));
  lines.push('');

  lines.push('#### continuation (継続シグナル) — トレンド継続 / ブレイク確認に使う');
  lines.push('');
  lines.push('| feature | 名称 | 形状 | トレード文脈 | 使い方の例 |');
  lines.push('|---|---|---|---|---|');
  for (const e of continuation) lines.push(formatRow(e));
  lines.push('');

  lines.push('#### indecision (迷いシグナル) — 単独で entry には使わない、フィルタ用');
  lines.push('');
  lines.push('| feature | 名称 | 形状 | トレード文脈 | 使い方の例 |');
  lines.push('|---|---|---|---|---|');
  for (const e of indecision) lines.push(formatRow(e));
  lines.push('');

  lines.push('上記 pattern は `lens="pattern"` + `feature=<patternId>` + `op="is_true"` (または `"is_false"`) で評価する。RHS は不要 (= 左辺の Boolean 評価のみ)。例:');
  lines.push('');
  lines.push('```json');
  lines.push('{ "lens": "pattern", "feature": "engulfing_bull", "op": "is_true" }');
  lines.push('```');
  lines.push('');
  lines.push('AND 条件で indicator と組み合わせると戦略の信頼度が上がる。例:');
  lines.push('');
  lines.push('```json');
  lines.push('{');
  lines.push('  "logic": "AND",');
  lines.push('  "conditions": [');
  lines.push('    { "lens": "ohlcv", "feature": "rsi", "op": "<", "value": 30 },');
  lines.push('    { "lens": "pattern", "feature": "pinbar_bull", "op": "is_true" }');
  lines.push('  ]');
  lines.push('}');
  lines.push('```');

  return lines.join('\n');
}
