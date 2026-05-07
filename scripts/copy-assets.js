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

/**
 * コピー対象のルール定義。追加したい場合はここに足す。
 *
 * `minCount`:
 *   このルールが必須アセットかを示す最小コピー件数。満たないと
 *   非 0 終了してビルドを失敗させる(サイレント欠落で本番障害になるのを防ぐ)。
 *   オプショナルアセットなら 0 を指定する。
 */
const COPY_RULES = [
  {
    sourceDir: path.join(SRC, 'side-b', 'prompts'),
    targetDir: path.join(DIST, 'side-b', 'prompts'),
    extensions: ['.md'],
    minCount: 1,
  },
  // PR #115 で導入した共通 indicator registry の JSON canonical。
  // `src/shared/indicators/registry.ts` が起動時に `fs.readFileSync(__dirname/data/registry.json)`
  // で読むため dist 側にも配置必須。コピー漏れがあると本番起動時に ENOENT で
  // Cloud Run のコンテナがポート listen 前に死ぬ (= 2026-05-07 の本番障害の原因)。
  {
    sourceDir: path.join(SRC, 'shared', 'indicators', 'data'),
    targetDir: path.join(DIST, 'shared', 'indicators', 'data'),
    extensions: ['.json'],
    minCount: 1,
  },
  // PR ②-2 で導入した共通 pattern registry の JSON canonical。
  // `src/shared/patterns/registry.ts` が起動時に
  // `fs.readFileSync(__dirname/data/patternRegistry.json)` で読むため dist 側にも配置必須。
  // indicator registry と同じ流儀で COPY_RULES に登録 (= dist 欠落で本番 ENOENT 防止)。
  {
    sourceDir: path.join(SRC, 'shared', 'patterns', 'data'),
    targetDir: path.join(DIST, 'shared', 'patterns', 'data'),
    extensions: ['.json'],
    minCount: 1,
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
const errors = [];

for (const rule of COPY_RULES) {
  let ruleCount = 0;

  if (!fs.existsSync(rule.sourceDir)) {
    const msg = `source directory not found: ${rule.sourceDir}`;
    if ((rule.minCount ?? 0) > 0) {
      errors.push(`[required] ${msg}`);
    } else {
      console.warn(`[copy-assets] skip: ${msg}`);
    }
    continue;
  }

  walk(rule.sourceDir, (sourcePath) => {
    const ext = path.extname(sourcePath);
    if (!rule.extensions.includes(ext)) return;
    const relative = path.relative(rule.sourceDir, sourcePath);
    const targetPath = path.join(rule.targetDir, relative);
    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);
    ruleCount++;
    total++;
  });

  if (ruleCount < (rule.minCount ?? 0)) {
    errors.push(
      `[required] rule ${rule.sourceDir} copied only ${ruleCount} files (minCount=${rule.minCount})`,
    );
  } else {
    console.log(
      `[copy-assets] rule ${path.relative(ROOT, rule.sourceDir)}: copied ${ruleCount} files`,
    );
  }
}

// 必須アセットが不足していればビルドを失敗させる(本番のサイレント欠落防止)
if (errors.length > 0) {
  console.error('[copy-assets] FAILED: required assets missing');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`[copy-assets] done. total ${total} files copied to dist/`);
