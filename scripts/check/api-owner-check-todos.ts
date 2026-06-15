/**
 * docs/API.md の owner check TODO 棚卸し。
 *
 * 目的:
 * - `owner check required` に `TODO: confirm` が残っている API 行を一覧化する
 * - 実装済みなのに docs が stale な行と、本当に未実装の行をレビューしやすくする
 *
 * 実行:
 *   npx tsx scripts/check/api-owner-check-todos.ts [--fail-on-todo]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

interface CliOptions {
  failOnTodo: boolean;
}

interface TodoRow {
  line: number;
  endpoint: string;
  method: string;
  ownerCheckRequired: string;
  notes: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { failOnTodo: false };
  for (const arg of argv) {
    if (arg === '--fail-on-todo') {
      options.failOnTodo = true;
    } else {
      throw new Error(`未知の引数です: ${arg}`);
    }
  }
  return options;
}

function parseMarkdownRow(line: string, lineNumber: number): TodoRow | null {
  if (!line.includes('TODO: confirm')) return null;
  if (!line.trim().startsWith('|')) return null;

  const cells = line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
  if (cells.length < 10) return null;

  return {
    line: lineNumber,
    endpoint: cells[0].replace(/`/g, ''),
    method: cells[1],
    ownerCheckRequired: cells[8],
    notes: cells[9],
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const apiPath = path.join(process.cwd(), 'docs', 'API.md');
  const lines = fs.readFileSync(apiPath, 'utf-8').split('\n');
  const rows = lines
    .map((line, index) => parseMarkdownRow(line, index + 1))
    .filter((row): row is TodoRow => row !== null);

  console.log(`[api-owner-check-todos] TODO: confirm 行数=${rows.length}`);
  for (const row of rows) {
    console.log(
      `${row.line}: ${row.method} ${row.endpoint} owner=${row.ownerCheckRequired} notes=${row.notes}`
    );
  }

  if (options.failOnTodo && rows.length > 0) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[api-owner-check-todos] 失敗: ${message}`);
  process.exitCode = 1;
}
