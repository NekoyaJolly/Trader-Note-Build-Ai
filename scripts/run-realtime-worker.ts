/**
 * Realtime Worker - リアルタイム類似度監視ワーカー
 * 
 * 目的: cTrader WebSocket でリアルタイムデータを受信し、類似度チェックを実行
 * 
 * 起動方法:
 *   npx ts-node scripts/run-realtime-worker.ts
 * 
 * 環境変数:
 *   - CTRADER_ACCOUNT_ID: cTrader アカウントID
 *   - SIMILARITY_THRESHOLD: 類似度閾値（デフォルト: 0.85）
 *   - WINDOW_SECONDS: 時間窓（デフォルト: 60）
 *   - WATCH_SYMBOLS: 監視シンボル（カンマ区切り、デフォルト: XAUUSD）
 * 
 * 参照: docs/realtime_similarity_notification_architecture.md
 */

import { PrismaClient } from '@prisma/client';
import { CTraderAuthService } from '../src/backend/services/ctrader/ctraderAuthService';
import { CTraderProvider } from '../src/infrastructure/market/CTraderProvider';
import { RollingWindowService } from '../src/services/realtime/rollingWindowService';
import { RealtimeSimilarityService, NoteForSimilarity } from '../src/services/realtime/realtimeSimilarityService';
import { sendSimilarityNotification } from '../src/services/notification/notificationTriggerService';

// ========================================
// 設定
// ========================================

const CONFIG = {
  // cTrader アカウントID（環境変数またはDB から取得）
  accountId: process.env.CTRADER_ACCOUNT_ID || '',
  
  // 類似度閾値
  similarityThreshold: parseFloat(process.env.SIMILARITY_THRESHOLD || '0.85'),
  
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
  console.log('  Realtime Worker 起動');
  console.log('═══════════════════════════════════════');
  console.log(`  閾値: ${CONFIG.similarityThreshold}`);
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

    // 2. 比較対象のノートを読み込み
    const notes = await loadNotesForSimilarity(prisma);
    if (notes.length === 0) {
      console.warn('⚠️ 比較対象のノートがありません');
      console.warn('   ノートを作成してから再実行してください');
    } else {
      console.log(`✓ ノート読み込み: ${notes.length}件`);
    }

    // 3. サービス初期化
    const rollingWindow = new RollingWindowService({
      windowSeconds: CONFIG.windowSeconds,
      autoFlush: true,
    });

    const similarityService = new RealtimeSimilarityService(rollingWindow, {
      similarityThreshold: CONFIG.similarityThreshold,
      debug: CONFIG.debug,
    });
    similarityService.setNotes(notes);

    // 4. 通知コールバック設定
    similarityService.onSimilarityAlert(async (result) => {
      console.log('🔔 類似度アラート:', {
        noteTitle: result.noteTitle,
        symbol: result.symbol,
        similarity: `${(result.similarity * 100).toFixed(1)}%`,
      });

      try {
        // Push 通知を送信
        await sendSimilarityNotification({
          noteId: result.noteId,
          noteTitle: result.noteTitle,
          symbol: result.symbol,
          similarity: result.similarity,
        });
        console.log('✓ 通知送信完了');
      } catch (error) {
        console.error('通知送信エラー:', error);
      }
    });

    // 5. cTrader Provider 初期化
    const provider = new CTraderProvider(authService, accountId);

    // 接続状態変更を監視
    provider.onConnectionStateChange((state) => {
      console.log(`[Worker] cTrader 接続状態: ${state}`);
    });

    // 6. WebSocket 接続
    console.log('cTrader WebSocket 接続中...');
    await provider.connect();

    // 7. 類似度監視開始
    similarityService.start();

    // 8. Tick データ購読
    await provider.subscribeTicks(CONFIG.watchSymbols, (tick) => {
      // Tick を RollingWindow に追加
      rollingWindow.addTick(tick);
      
      if (CONFIG.debug) {
        console.log(`[Tick] ${tick.symbol}: ${tick.price} @ ${tick.timestamp.toISOString()}`);
      }
    });

    console.log('═══════════════════════════════════════');
    console.log('  ✓ リアルタイム監視開始');
    console.log('  Ctrl+C で終了');
    console.log('═══════════════════════════════════════');

    // 9. シグナルハンドラ
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

    // 10. 定期的にノートを再読み込み（10分ごと）
    setInterval(async () => {
      try {
        const refreshedNotes = await loadNotesForSimilarity(prisma);
        similarityService.setNotes(refreshedNotes);
        console.log(`[Worker] ノート更新: ${refreshedNotes.length}件`);
      } catch (error) {
        console.error('[Worker] ノート更新エラー:', error);
      }
    }, 10 * 60 * 1000);

    // 11. 定期的に統計を表示（5分ごと）
    setInterval(() => {
      const stats = similarityService.getStats();
      const windowStats = rollingWindow.getStats();
      console.log(`[Stats] ノート: ${stats.noteCount}件, シンボル: ${windowStats.symbols.join(',')}`, 
                  `pending: ${windowStats.pendingCount}`);
    }, 5 * 60 * 1000);

  } catch (error) {
    console.error('ワーカーエラー:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

// ========================================
// ヘルパー関数
// ========================================

/**
 * 類似度チェック用のノートを読み込み
 */
async function loadNotesForSimilarity(prisma: PrismaClient): Promise<NoteForSimilarity[]> {
  // StrategyNote から特徴ベクトルを持つノートを取得
  const strategyNotes = await prisma.strategyNote.findMany({
    where: {
      featureVector: {
        not: null,
      },
    },
    select: {
      id: true,
      symbol: true,
      featureVector: true,
      strategy: {
        select: {
          name: true,
        },
      },
    },
  });

  return strategyNotes
    .filter(note => note.featureVector && Array.isArray(note.featureVector))
    .map(note => ({
      id: note.id,
      title: `${note.strategy.name} - ${note.symbol}`,
      symbol: note.symbol,
      featureVector: note.featureVector as number[],
    }));
}

// ========================================
// 実行
// ========================================

main().catch((error) => {
  console.error('致命的エラー:', error);
  process.exit(1);
});
