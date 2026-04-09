#!/usr/bin/env tsx
/**
 * UI→API→DB 統合検証スクリプト
 *
 * エージェントがdev/本番環境に対して実行し、
 * 主要なUI導線が正しくDBと連携しているかを確認する。
 *
 * 使い方:
 *   tsx scripts/verify-ui-api-db.ts [--base-url http://localhost:3100] [--cookie "auth_token=..."]
 *
 * 認証が必要なエンドポイントは --cookie で JWT トークンを渡す。
 * 省略時は認証不要エンドポイントのみ検証。
 */

// ========================================
// 引数解析
// ========================================

const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const BASE_URL = getArg('--base-url', 'http://localhost:3100');
const COOKIE = getArg('--cookie', '');

// ========================================
// ヘルパー
// ========================================

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
  durationMs: number;
}

const results: TestResult[] = [];

async function runTest(
  name: string,
  fn: () => Promise<string>
): Promise<void> {
  const start = Date.now();
  try {
    const detail = await fn();
    results.push({ name, passed: true, detail, durationMs: Date.now() - start });
    console.log(`  ✅ ${name} (${Date.now() - start}ms)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, detail: message, durationMs: Date.now() - start });
    console.log(`  ❌ ${name}: ${message}`);
  }
}

async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (COOKIE) {
    headers['Cookie'] = COOKIE;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

// ========================================
// テストケース
// ========================================

// 1. ヘルスチェック（DB不要 — サーバー起動確認）
async function testHealth(): Promise<string> {
  const { status, body } = await apiFetch('/health');
  if (status !== 200) throw new Error(`HTTP ${status}`);
  if (body.status !== 'ok') throw new Error(`status = ${body.status}`);
  return `status=ok, timestamp=${body.timestamp}`;
}

// 2. 認証確認（DB: User, CTraderToken）
async function testAuthMe(): Promise<string> {
  if (!COOKIE) return 'SKIPPED（--cookie 未指定）';
  const { status, body } = await apiFetch('/api/auth/me');
  if (status === 401) throw new Error('認証失敗（トークン無効/期限切れ）');
  if (status !== 200) throw new Error(`HTTP ${status}`);
  const data = body.data as Record<string, unknown> | undefined;
  if (!data?.userId) throw new Error('userId が取得できません');
  return `userId=${data.userId}, displayName=${data.displayName ?? 'N/A'}`;
}

// 3. ノート一覧（DB: TradeNote, Trade）
async function testNotesList(): Promise<string> {
  if (!COOKIE) return 'SKIPPED（--cookie 未指定）';
  const { status, body } = await apiFetch('/api/trades/notes?limit=3');
  if (status !== 200) throw new Error(`HTTP ${status}`);
  const notes = (body.notes ?? body.data) as unknown[];
  if (!Array.isArray(notes)) throw new Error('notes が配列ではありません');
  return `取得件数: ${notes.length}件`;
}

// 4. 通知一覧 + 未読数（DB: Notification）
async function testNotifications(): Promise<string> {
  if (!COOKIE) return 'SKIPPED（--cookie 未指定）';
  const { status: listStatus } = await apiFetch('/api/notifications?limit=3');
  if (listStatus !== 200) throw new Error(`一覧 HTTP ${listStatus}`);
  const { status: countStatus, body: countBody } = await apiFetch('/api/notifications/unread-count');
  if (countStatus !== 200) throw new Error(`未読数 HTTP ${countStatus}`);
  return `未読数: ${countBody.count ?? countBody.unreadCount ?? 'N/A'}`;
}

// 5. ストラテジー一覧（DB: Strategy）
async function testStrategies(): Promise<string> {
  const { status, body } = await apiFetch('/api/strategies?limit=3');
  if (status !== 200) throw new Error(`HTTP ${status}`);
  const wrapper = body.data as Record<string, unknown> | undefined;
  const list = wrapper?.strategies ?? body.strategies ?? body.data;
  if (!Array.isArray(list)) throw new Error('strategies が配列ではありません');
  return `取得件数: ${list.length}件`;
}

// 6. OHLCVプリセット一覧（DB: DataPreset）
async function testOhlcvPresets(): Promise<string> {
  const { status, body } = await apiFetch('/api/ohlcv/presets');
  if (status !== 200) throw new Error(`HTTP ${status}`);
  const presets = (body.data ?? body.presets) as unknown[];
  if (!Array.isArray(presets)) throw new Error('presets が配列ではありません');
  return `取得件数: ${presets.length}件`;
}

// 7. チャート描画同期 — 書き込み→読み取り往復（DB: ChartDrawing）
async function testChartDrawingSync(): Promise<string> {
  if (!COOKIE) return 'SKIPPED（--cookie 未指定）';
  const testSymbol = '__VERIFY_TEST__';
  const testTimeframe = '60';
  const testLine = {
    id: `verify-${Date.now()}`,
    type: 'horizontal' as const,
    price: 1234.56,
    startTime: Date.now() - 3600000,
    endTime: Date.now(),
    color: '#ff0000',
    lineWidth: 2,
  };

  // 書き込み
  const { status: syncStatus } = await apiFetch('/api/chart-drawings/sync', {
    method: 'PUT',
    body: JSON.stringify({
      symbol: testSymbol,
      timeframe: testTimeframe,
      lines: [testLine],
    }),
  });
  if (syncStatus !== 200) throw new Error(`sync PUT HTTP ${syncStatus}`);

  // 読み取り
  const { status: getStatus, body: getBody } = await apiFetch(
    `/api/chart-drawings?symbol=${encodeURIComponent(testSymbol)}&timeframe=${testTimeframe}`
  );
  if (getStatus !== 200) throw new Error(`GET HTTP ${getStatus}`);
  const data = getBody.data as Record<string, unknown> | undefined;
  const lines = data?.lines as unknown[];
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('書き込んだラインが読み取れません');
  }

  // クリーンアップ（空配列で上書き）
  await apiFetch('/api/chart-drawings/sync', {
    method: 'PUT',
    body: JSON.stringify({
      symbol: testSymbol,
      timeframe: testTimeframe,
      lines: [],
    }),
  });

  return `往復OK — 書き込み1件 → 読み取り${lines.length}件 → クリーンアップ済`;
}

// 8. インジケーター設定（DB/ファイル系）
async function testIndicatorSettings(): Promise<string> {
  const { status, body } = await apiFetch('/api/indicators/settings');
  if (status !== 200) throw new Error(`HTTP ${status}`);
  return `設定取得OK`;
}

// 9. ウォッチリスト（DB: Watchlist）
async function testWatchlist(): Promise<string> {
  if (!COOKIE) return 'SKIPPED（--cookie 未指定）';
  const { status, body } = await apiFetch('/api/watchlist');
  if (status !== 200) throw new Error(`HTTP ${status}`);
  const data = (body.data ?? body.watchlists) as unknown[];
  if (!Array.isArray(data)) throw new Error('watchlists が配列ではありません');
  return `取得件数: ${data.length}件`;
}

// 10. トレーディング口座（DB: CTraderToken → cTrader API）
async function testTradingAccount(): Promise<string> {
  if (!COOKIE) return 'SKIPPED（--cookie 未指定）';
  const { status, body } = await apiFetch('/api/trading/account');
  if (status !== 200) throw new Error(`HTTP ${status}`);
  const data = body.data as Record<string, unknown> | undefined;
  if (!data?.accountId) throw new Error('accountId が取得できません');
  return `accountId=${data.accountId}, balance=${data.balance}`;
}

// ========================================
// メイン実行
// ========================================

async function main(): Promise<void> {
  console.log('========================================');
  console.log('  UI→API→DB 統合検証');
  console.log(`  対象: ${BASE_URL}`);
  console.log(`  認証: ${COOKIE ? 'あり' : 'なし（認証系はスキップ）'}`);
  console.log('========================================\n');

  await runTest('1. ヘルスチェック', testHealth);
  await runTest('2. 認証（/api/auth/me）', testAuthMe);
  await runTest('3. ノート一覧', testNotesList);
  await runTest('4. 通知一覧 + 未読数', testNotifications);
  await runTest('5. ストラテジー一覧', testStrategies);
  await runTest('6. OHLCVプリセット一覧', testOhlcvPresets);
  await runTest('7. チャート描画同期（往復）', testChartDrawingSync);
  await runTest('8. インジケーター設定', testIndicatorSettings);
  await runTest('9. ウォッチリスト', testWatchlist);
  await runTest('10. トレーディング口座', testTradingAccount);

  // サマリー
  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed && !r.detail.startsWith('SKIPPED'));
  const skipped = results.filter((r) => r.detail.startsWith('SKIPPED'));

  console.log('\n========================================');
  console.log('  結果サマリー');
  console.log('========================================');
  console.log(`  ✅ パス: ${passed.length}`);
  console.log(`  ❌ 失敗: ${failed.length}`);
  console.log(`  ⏭️  スキップ: ${skipped.length}`);
  console.log(`  合計: ${results.length}`);

  if (failed.length > 0) {
    console.log('\n  --- 失敗詳細 ---');
    for (const f of failed) {
      console.log(`  ❌ ${f.name}: ${f.detail}`);
    }
  }

  console.log('========================================\n');
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('スクリプト実行エラー:', error);
  process.exit(2);
});
