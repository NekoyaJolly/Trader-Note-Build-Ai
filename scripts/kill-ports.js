#!/usr/bin/env node

/**
 * クロスプラットフォーム対応のポートキルスクリプト
 * Windows/Mac/Linux すべてで動作
 */

const { execSync } = require('child_process');

const ports = process.argv.slice(2).map(Number).filter(p => !isNaN(p));

if (ports.length === 0) {
  console.log('Usage: node kill-ports.js <port1> [port2] ...');
  process.exit(0);
}

console.log(`ポートを解放中: ${ports.join(', ')}`);

for (const port of ports) {
  try {
    // kill-port はクロスプラットフォーム対応
    execSync(`npx kill-port ${port}`, { stdio: 'ignore' });
  } catch (error) {
    // エラーを無視（ポートが使用されていない場合など）
  }
}

console.log('ポート解放完了');

