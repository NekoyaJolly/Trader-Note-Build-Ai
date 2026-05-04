#!/usr/bin/env node
/**
 * package.json の `prepare` script から呼ばれる git hook 登録スクリプト。
 *
 * 目的:
 * - `.git` が存在する開発マシンでは simple-git-hooks を呼んで pre-commit を登録
 * - `.git` が無い CI 環境 (= shallow clone / docker COPY のみ等) では skip
 * - simple-git-hooks 自体が失敗した場合は **エラーを表面化させる**
 *   (= `|| true` で黙殺せず、本当のセットアップ失敗に気付ける)
 *
 * これにより:
 * - 開発マシンでは確実に hook が入る (失敗時は即気付ける)
 * - CI では skip するので余計な依存を引かない
 *
 * cross-platform 対応のため shell ではなく Node で書く (Windows/macOS/Linux 共通)。
 */
'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

if (!fs.existsSync('.git')) {
  console.log('[install-git-hooks] .git が見つからないため skip (CI / shallow clone 想定)');
  process.exit(0);
}

const result = spawnSync('npx', ['simple-git-hooks'], {
  stdio: 'inherit',
  shell: process.platform === 'win32', // Windows では shell 経由でないと npx が見えない
});

if (result.status !== 0) {
  console.error(
    '[install-git-hooks] simple-git-hooks の登録に失敗しました。' +
      ' 権限 / .git 構成を確認してください。',
  );
  process.exit(result.status ?? 1);
}
