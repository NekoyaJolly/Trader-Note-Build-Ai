/**
 * オンボーディング〜CSVインポート〜Draftノート表示の検証スクリプト
 * - バックエンド起動（別プロセス前提）
 * - /health の確認
 * - sample_trades.csv を読み取り、/api/trades/import/upload-text にPOST
 * - 返却された noteIds の先頭で /api/trades/notes/:id を取得して表示
 */

import fs from 'fs';
import path from 'path';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3100';

async function main() {
  console.log('=== 検証開始 ===');

  // 1. ヘルスチェック
  {
    const resp = await fetch(`${API_BASE}/health`);
    const json = await resp.json();
    console.log('\n[health]', json);
  }

  // 2. CSV テキスト読み込み
  const csvPath = path.join(process.cwd(), 'data', 'trades', 'sample_trades.csv');
  const csvText = fs.readFileSync(csvPath, 'utf-8');

  // 3. アップロード→取り込み→Draft ノート生成
  const uploadResp = await fetch(`${API_BASE}/api/trades/import/upload-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'sample_trades.csv', csvText }),
  });
  if (!uploadResp.ok) {
    const errText = await uploadResp.text();
    throw new Error(`アップロード失敗: ${uploadResp.status} ${uploadResp.statusText} - ${errText}`);
  }
  const uploadJson: any = await uploadResp.json();
  console.log('\n[upload-text]', uploadJson);

  const noteIds: string[] = uploadJson?.noteIds || [];
  if (noteIds.length === 0) {
    console.warn('ノートIDが返却されませんでした。CSVの内容を確認してください。');
    return;
  }

  // 4. ノート詳細取得
  const noteId = noteIds[0];
  const noteResp = await fetch(`${API_BASE}/api/trades/notes/${noteId}`);
  if (!noteResp.ok) {
    const errText = await noteResp.text();
    throw new Error(`ノート詳細取得失敗: ${noteResp.status} ${noteResp.statusText} - ${errText}`);
  }
  const noteJson: any = await noteResp.json();
  console.log('\n[note-detail]', { id: noteJson.id, symbol: noteJson.symbol, side: noteJson.side, aiSummary: (noteJson.aiSummary || '').slice(0, 100) + '...' });

  console.log('\n=== 検証完了 ===');
}

main().catch((e) => {
  console.error('検証中にエラー:', e);
  process.exit(1);
});
