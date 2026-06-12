/**
 * Realtime Worker - リアルタイム類似度監視ワーカー (Phase δ-1: レンズエンジン統一)
 *
 * 目的: cTrader WebSocket でリアルタイムデータを受信し、バー確定ごとに
 *       正規マッチングパイプライン (レンズ類似度) をシンボルスコープで起動する。
 *
 * 設計 (NOTE_SIMILARITY_FOUNDATION.md §13):
 * - 評価・永続化・通知は全て RealtimeSimilarityService → MatchingService.runMatchingPipeline
 *   が行う (cron と同一コード)。本ワーカーはノート管理も通知も持たない薄い殻。
 * - **未本番化** (deploy.yml に worker サービスなし)。常駐ワーカー本番化 (δ-5) は
 *   15 分 cron 維持の決定 (2026-06-13) により当面見送り。
 * - ⚠️ δ-5 本番化時の必須作業: データ源を cTrader → EODHD WS に差し替える
 *   (cTrader 複数接続競合バグ回避、§13.4 注意書き / memory: project_ctrader_multi_connection_bug)。
 *   本スクリプトは現状 cTrader のままだが、本番常駐させる前に EODHD へ移行すること。
 *
 * 起動方法:
 *   npx ts-node scripts/run-realtime-worker.ts
 *
 * 環境変数:
 *   - CTRADER_ACCOUNT_ID: cTrader アカウントID
 *   - MIN_EVAL_INTERVAL_SECONDS: 同一シンボルの最小評価間隔（デフォルト: 60）
 *   - WINDOW_SECONDS: Tick→バー集約の時間窓（デフォルト: 60）
 *   - WATCH_SYMBOLS: 監視シンボル（カンマ区切り、デフォルト: XAUUSD）
 *   - DEBUG: 'true' で詳細ログ
 */

import { PrismaClient } from '@prisma/client';
import { CTraderAuthService } from '../src/backend/services/ctrader/ctraderAuthService';
import { CTraderProvider } from '../src/infrastructure/market/CTraderProvider';
import { RollingWindowService } from '../src/services/realtime/rollingWindowService';
import { RealtimeSimilarityService } from '../src/services/realtime/realtimeSimilarityService';

// ========================================
// 設定
// ========================================

const CONFIG = {
  // cTrader アカウントID（環境変数またはDB から取得）
  accountId: process.env.CTRADER_ACCOUNT_ID || '',

  // 同一シンボルの最小評価間隔（秒）
  minEvalIntervalSeconds: parseInt(process.env.MIN_EVAL_INTERVAL_SECONDS || '60', 10),

  // 時間窓（秒）
  windowSeconds: parseInt(process.env.WINDOW_SECONDS || '60', 10),

  // 監視シンボル
  watchSymbols: (process.env.WATCH_SYMBOLS || 'XAUUSD').split(',').map(s => s.trim()),

  // ログレベル
  debug: process.env.DEBUG === 'true',
};

// ========================================
// メイン処理
// ========================================

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════');
  console.log('  Realtime Worker 起動 (レンズエンジン統一)');
  console.log('═══════════════════════════════════════');
  console.log(`  最小評価間隔: ${CONFIG.minEvalIntervalSeconds}秒`);
  console.log(`  時間窓: ${CONFIG.windowSeconds}秒`);
  console.log(`  監視シンボル: ${CONFIG.watchSymbols.join(', ')}`);
  console.log('═══════════════════════════════════════');

  const prisma = new PrismaClient();

  try {
    // 1. cTrader 接続確認
    const authService = new CTraderAuthService(prisma);

    // アカウントID を取得（環境変数 または DB から最初のトークン）
    let accountId = CONFIG.accountId;
    if (!accountId) {
      const status = await authService.getConnectionStatus();
      if (status.accounts.length === 0) {
        console.error('❌ cTrader 連携が設定されていません');
        console.error('   設定画面から cTrader 連携を行ってください');
        process.exit(1);
      }
      accountId = status.accounts[0].accountId;
    }

    console.log(`✓ cTrader アカウント: ${accountId}`);

    // 2. サービス初期化 (ノートのロード・通知・永続化はパイプライン側が行う)
    const rollingWindow = new RollingWindowService({
      windowSeconds: CONFIG.windowSeconds,
      autoFlush: true,
    });

    const similarityService = new RealtimeSimilarityService(rollingWindow, {
      minEvaluationIntervalSeconds: CONFIG.minEvalIntervalSeconds,
      debug: CONFIG.debug,
    });

    // 3. 評価完了の観測ログ (永続化・通知はパイプラインの責務)
    similarityService.onEvaluation((result) => {
      if (result.totalMatches > 0 || result.notified > 0) {
        console.log(
          `🔔 [${result.symbol}] matches=${result.totalMatches} notified=${result.notified}` +
            (result.errors.length > 0 ? ` errors=${result.errors.length}` : '')
        );
      }
    });

    // 4. cTrader Provider 初期化
    const provider = new CTraderProvider(authService, accountId);

    provider.onConnectionStateChange((state) => {
      console.log(`[Worker] cTrader 接続状態: ${state}`);
    });

    // 5. WebSocket 接続
    console.log('cTrader WebSocket 接続中...');
    await provider.connect();

    // 6. 類似度監視開始 (バー確定ごとにパイプラインが自動起動)
    similarityService.start();

    // 7. Tick データ購読
    await provider.subscribeTicks(CONFIG.watchSymbols, (tick) => {
      rollingWindow.addTick(tick);
      if (CONFIG.debug) {
        console.log(`[Tick] ${tick.symbol}: ${tick.price} @ ${tick.timestamp.toISOString()}`);
      }
    });

    console.log('═══════════════════════════════════════');
    console.log('  ✓ リアルタイム監視開始');
    console.log('  Ctrl+C で終了');
    console.log('═══════════════════════════════════════');

    // 8. シグナルハンドラ
    const shutdown = async () => {
      console.log('\nシャットダウン中...');
      similarityService.stop();
      rollingWindow.stop();
      await provider.disconnect();
      await prisma.$disconnect();
      console.log('シャットダウン完了');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // 9. 定期的に統計を表示（5分ごと）
    setInterval(() => {
      const stats = similarityService.getStats();
      const windowStats = rollingWindow.getStats();
      console.log(
        `[Stats] 評価済みシンボル: ${stats.symbolCount}, 走行中: ${stats.inFlightCount}, ` +
          `窓シンボル: ${windowStats.symbols.join(',')}, pending: ${windowStats.pendingCount}`
      );
    }, 5 * 60 * 1000);

  } catch (error) {
    console.error('ワーカーエラー:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

// ========================================
// 実行
// ========================================

main().catch((error) => {
  console.error('致命的エラー:', error);
  process.exit(1);
});
