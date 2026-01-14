/**
 * Express 5 型エラー一括修正スクリプト
 * req.params.xxx と req.query.xxx を getStringParam() でラップ
 */

import * as fs from 'fs';
import * as path from 'path';

// 修正対象ファイルリスト
const targetFiles = [
  'src/backend/api/ohlcvRoutes.ts',
  'src/backend/api/patternAnalysisRoutes.ts',
  'src/backend/api/realtimeRoutes.ts',
  'src/backend/api/strategyComparisonRoutes.ts',
  'src/backend/api/strategyRoutes.ts',
  'src/controllers/backtestController.ts',
  'src/controllers/barLocatorController.ts',
  'src/controllers/notificationController.ts',
  'src/controllers/orderController.ts',
  'src/controllers/tradeController.ts',
  'src/routes/backtestRoutes.ts',
  'src/routes/marketAnalysisRoutes.ts',
  'src/routes/profileRoutes.ts',
  'src/routes/watchlistRoutes.ts',
  'src/side-b/controllers/sideBController.ts',
];

function addImportIfNeeded(content: string): string {
  // すでに import がある場合はスキップ
  if (content.includes('requestHelpers')) {
    return content;
  }

  // import文を追加する位置を見つける
  const importRegex = /import .+ from ['"]express['"]/;
  const match = content.match(importRegex);
  
  if (match) {
    const insertPos = content.indexOf(match[0]) + match[0].length;
    const helperPath = content.includes('src/backend') || content.includes('src/controllers') || content.includes('src/routes')
      ? '../utils/requestHelpers'
      : content.includes('src/side-b')
      ? '../../utils/requestHelpers'
      : './utils/requestHelpers';
    
    const importStatement = `\nimport { getStringParam, getOptionalStringParam, getNumberParam } from '${helperPath}';`;
    return content.slice(0, insertPos) + importStatement + content.slice(insertPos);
  }
  
  return content;
}

function fixParamsUsage(content: string): string {
  let fixed = content;

  // パターン1: const { id } = req.params; ... someFunction(id)
  // → getStringParam(id) に置換
  
  // パターン2: req.params.id を直接使用
  fixed = fixed.replace(/(\w+)\(req\.params\.(\w+)\)/g, '$1(getStringParam(req.params.$2))');
  fixed = fixed.replace(/(\w+)\(req\.query\.(\w+)\)/g, '$1(getOptionalStringParam(req.query.$2))');

  // パターン3: 分割代入後の使用（より複雑）
  // const { id } = req.params; のパターンを検出して、その id の使用箇所を修正
  const paramsDestructPattern = /const\s+\{\s*([^}]+)\s*\}\s*=\s*req\.params/g;
  const queryDestructPattern = /const\s+\{\s*([^}]+)\s*\}\s*=\s*req\.query/g;

  let match;
  const paramsVars = new Set<string>();
  const queryVars = new Set<string>();

  while ((match = paramsDestructPattern.exec(content)) !== null) {
    const vars = match[1].split(',').map(v => v.trim());
    vars.forEach(v => paramsVars.add(v));
  }

  while ((match = queryDestructPattern.exec(content)) !== null) {
    const vars = match[1].split(',').map(v => v.trim());
    vars.forEach(v => queryVars.add(v));
  }

  // 各変数の使用箇所を修正
  paramsVars.forEach(varName => {
    // 関数引数として使用されている箇所
    const funcCallRegex = new RegExp(`(\\w+)\\(${varName}\\)`, 'g');
    fixed = fixed.replace(funcCallRegex, `$1(getStringParam(${varName}))`);
    
    // parseInt などで使用されている箇所
    const parseIntRegex = new RegExp(`parseInt\\(${varName}`, 'g');
    fixed = fixed.replace(parseIntRegex, `parseInt(getStringParam(${varName})`);
  });

  queryVars.forEach(varName => {
    const funcCallRegex = new RegExp(`(\\w+)\\(${varName}\\)`, 'g');
    fixed = fixed.replace(funcCallRegex, `$1(getOptionalStringParam(${varName}))`);
  });

  return fixed;
}

function processFile(filePath: string): void {
  try {
    const fullPath = path.join(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.log(`⚠️  ファイルが見つかりません: ${filePath}`);
      return;
    }

    let content = fs.readFileSync(fullPath, 'utf-8');
    
    // Import 追加
    content = addImportIfNeeded(content);
    
    // パラメータ使用箇所を修正
    content = fixParamsUsage(content);
    
    // ファイルに書き戻し
    fs.writeFileSync(fullPath, content, 'utf-8');
    console.log(`✅ 修正完了: ${filePath}`);
    
  } catch (error) {
    console.error(`❌ エラー (${filePath}):`, error);
  }
}

// メイン処理
console.log('Express 5 型エラー一括修正を開始します...\n');

targetFiles.forEach(processFile);

console.log('\n修正完了！npx tsc で確認してください。');
