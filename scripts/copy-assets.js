#!/usr/bin/env node
/**
 * ビルド時に非 .ts アセット(.md プロンプトファイル)を dist/ にコピーする。
 *
 * 背景:
 *   `loadPrompt()` は `src/side-b/prompts/*.md` を実行時にファイル読み込みするが、
 *   tsc は .ts ファイルしか dist に出力しない。本番(Cloud Run)で
 *   "Prompt file not found: hypothesis_generator" エラーが発生していた。
 *
 * コピー対象:
 *   src/side-b/prompts/**\/*.md → dist/side-b/prompts/**\/*.md
 *
 * 特徴:
 *   - Node.js 標準 API のみでクロスプラットフォーム(macOS/Linux/Windows)
 *   - 冪等(既存ファイルは上書き)
 *   - ディレクトリ構造を保持(specialists/*.md もそのまま)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

/** コピー対象のルール定義。追加したい場合はここに足す。 */
const COPY_RULES = [
  {
    sourceDir: path.join(SRC, 'side-b', 'prompts'),
    targetDir: path.join(DIST, 'side-b', 'prompts'),
    extensions: ['.md'],
  },
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function walk(dir, callback) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, callback);
    } else if (entry.isFile()) {
      callback(full);
    }
  }
}

let total = 0;

for (const rule of COPY_RULES) {
  if (!fs.existsSync(rule.sourceDir)) {
    console.warn(`[copy-assets] skip: source directory not found ${rule.sourceDir}`);
    continue;
  }
  walk(rule.sourceDir, (sourcePath) => {
    const ext = path.extname(sourcePath);
    if (!rule.extensions.includes(ext)) return;
    const relative = path.relative(rule.sourceDir, sourcePath);
    const targetPath = path.join(rule.targetDir, relative);
    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);
    total++;
  });
}

console.log(`[copy-assets] copied ${total} files to dist/`);
